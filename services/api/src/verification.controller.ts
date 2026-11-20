import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Inject,
  Post,
  Put,
  Req,
} from "@nestjs/common";
import { SCOPES } from "@serendipity/consent";
import type { VerificationRepository } from "@serendipity/db";
import { CallbackRejected, levelFor, startRefusal } from "@serendipity/identity";
import type { IdentityService, Level, StartRefusal } from "@serendipity/identity";
import type { FastifyRequest } from "fastify";

import type { Callers } from "./callers.js";
import { ApiError } from "./errors.js";
import { CALLERS, CLOCK, VERIFICATION } from "./tokens.js";
import { traceOf } from "./tracing.js";

/** What the verification endpoints need (ADR-0025). */
export interface VerificationDeps {
  readonly repository: VerificationRepository;
  readonly identity: IdentityService;
}

export interface VerificationStatusBody {
  /** Matching and messaging are open. */
  readonly verified: boolean;
  /** The check to take next, when one is needed. */
  readonly next_check: Level | null;
  readonly consent: {
    readonly held: boolean;
    /** Shown in full before the person agrees: purpose, who holds what, and deletion. */
    readonly text: string;
    readonly version: number;
  };
  /** Why a check cannot start now, or `null`. */
  readonly blocked_by: StartRefusal | null;
}

const REFUSED: Readonly<Record<StartRefusal, () => ApiError>> = {
  account_closed: () => new ApiError("conflict", "This account cannot be verified right now."),
  no_birth_date: () => new ApiError("conflict", "Add your date of birth first."),
  no_consent: () =>
    new ApiError("forbidden", "Agree to the verification terms before taking a selfie."),
  already_verified: () => new ApiError("conflict", "You're already verified."),
  daily_limit: () => new ApiError("rate_limited", "That's enough tries for today. Try tomorrow."),
};

/**
 * Age and real-person checks (ADR-0024, ADR-0025). The person reads and
 * agrees to the biometric terms on their own, then starts a check and
 * finishes it on the vendor's page; the vendor's signed callback records the
 * verdict. Withdrawing the agreement asks the vendor to delete what it holds.
 */
@Controller("v1")
export class VerificationController {
  constructor(
    @Inject(VERIFICATION) private readonly verification: VerificationDeps,
    @Inject(CALLERS) private readonly callers: Callers,
    @Inject(CLOCK) private readonly clock: () => Date,
  ) {}

  private async caller(request: FastifyRequest): Promise<string> {
    const caller = await this.callers.callerOf(request.headers);
    if (caller === null) throw new ApiError("unauthenticated");
    return caller;
  }

  private context(request: FastifyRequest): { traceId?: string } {
    const trace = traceOf(request);
    return trace === undefined ? {} : { traceId: trace.traceId };
  }

  @Get("me/verification")
  @Header("cache-control", "no-store")
  async status(@Req() request: FastifyRequest): Promise<VerificationStatusBody> {
    const caller = await this.caller(request);
    const facts = await this.verification.repository.facts(caller, this.clock());
    if (facts === null) throw new ApiError("not_found");
    const eligibility = await this.verification.identity.eligible(caller);
    const refusal = startRefusal({ ...facts, eligibility });
    return {
      verified: eligibility.eligible,
      // Why an ID is asked for (a report, say) is not told: only that it is.
      next_check: eligibility.eligible ? null : levelFor(eligibility),
      consent: {
        held: facts.biometricConsent,
        text: SCOPES.biometric_verification.description,
        version: SCOPES.biometric_verification.version,
      },
      blocked_by: refusal,
    };
  }

  @Put("me/verification/consent")
  @HttpCode(200)
  @Header("cache-control", "no-store")
  async agree(@Req() request: FastifyRequest, @Body() body: unknown): Promise<{ held: true }> {
    const caller = await this.caller(request);
    const agreed =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>)["agreed"]
        : undefined;
    const version =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>)["version"]
        : undefined;
    // The person agrees to the text they were shown: a stale screen is refused.
    if (agreed !== true || version !== SCOPES.biometric_verification.version) {
      throw new ApiError(
        "invalid_request",
        'Agree with {"agreed": true, "version": <the version shown>}.',
      );
    }
    const outcome = await this.verification.repository.grantConsent(caller, this.context(request));
    if (outcome === "not_found") throw new ApiError("not_found");
    return { held: true };
  }

  @Delete("me/verification/consent")
  @HttpCode(200)
  @Header("cache-control", "no-store")
  async withdraw(@Req() request: FastifyRequest): Promise<{ held: false }> {
    const caller = await this.caller(request);
    const outcome = await this.verification.repository.withdrawConsent(
      caller,
      this.context(request),
    );
    if (outcome.kind === "not_found") throw new ApiError("not_found");
    return { held: false };
  }

  @Post("me/verification")
  @HttpCode(201)
  @Header("cache-control", "no-store")
  async start(
    @Req() request: FastifyRequest,
  ): Promise<{ url: string; expires_at: string; check: Level }> {
    const caller = await this.caller(request);
    const facts = await this.verification.repository.facts(caller, this.clock());
    if (facts === null) throw new ApiError("not_found");
    const eligibility = await this.verification.identity.eligible(caller);
    if (!eligibility.eligible && eligibility.reason === "unavailable") {
      throw new ApiError("unavailable");
    }
    const refusal = startRefusal({ ...facts, eligibility });
    if (refusal !== null) throw REFUSED[refusal]();
    const level = levelFor(eligibility);
    let session;
    try {
      session = await this.verification.identity.startVerification(caller, level);
    } catch (error) {
      throw new ApiError("unavailable", undefined, { cause: error });
    }
    await this.verification.repository.recordStart(
      caller,
      this.verification.identity.provider,
      session.providerRef,
      level,
      this.context(request),
    );
    return { url: session.url, expires_at: session.expiresAt.toISOString(), check: level };
  }

  /**
   * The vendor's callback: authenticated by its signature over the raw body,
   * not by a session. Answers 204 for a verdict recorded, repeated or still
   * pending, so the vendor stops retrying; 401 for anything not signed.
   */
  @Post("identity/callback")
  @HttpCode(204)
  async callback(@Req() request: FastifyRequest & { rawBody?: Buffer }): Promise<void> {
    const raw = request.rawBody;
    if (raw === undefined) throw new ApiError("invalid_request");
    const headers: Record<string, string | undefined> = {};
    for (const [name, value] of Object.entries(request.headers)) {
      headers[name] = Array.isArray(value) ? value[0] : value;
    }
    try {
      await this.verification.identity.handleCallback(
        headers,
        raw.toString("utf8"),
        this.context(request),
      );
    } catch (error) {
      if (error instanceof CallbackRejected) {
        throw new ApiError(
          error.reason === "malformed" ? "invalid_request" : "unauthenticated",
          undefined,
          { cause: error },
        );
      }
      throw error;
    }
  }
}
