import { Body, Controller, Get, Header, HttpCode, Inject, Post, Req } from "@nestjs/common";
import type { AccountRepository, ResumeStatus } from "@serendipity/db";
import { PAUSE_REASONS } from "@serendipity/identity";
import type { PauseReason, PauseRefusal, ResumeNeed } from "@serendipity/identity";
import type { FastifyRequest } from "fastify";

import type { Callers } from "./callers.js";
import { ApiError } from "./errors.js";
import { ACCOUNT, CALLERS, CLOCK } from "./tokens.js";
import { traceOf } from "./tracing.js";

export interface PauseBody {
  readonly status: "paused";
  readonly reason: PauseReason;
}

export interface ResumeBody {
  readonly status: string;
  readonly paused_reason: PauseReason | null;
  /** What has to happen before matching can resume, besides confirming. */
  readonly needs: readonly ResumeNeed[];
  /** The person's own approved hard rules, to look over before confirming. */
  readonly key_preferences: Readonly<Record<string, unknown>> | null;
}

const REFUSED: Readonly<Record<PauseRefusal, string>> = {
  suspended: "This account cannot be paused right now.",
  deleted: "This account no longer exists.",
  deletion_requested: "This account is being deleted.",
};

const resumeBody = (status: ResumeStatus): ResumeBody => ({
  status: status.status,
  paused_reason: status.pausedReason,
  needs: status.needs,
  key_preferences: status.keyPreferences,
});

function field(body: unknown, name: string): unknown {
  return typeof body === "object" && body !== null
    ? (body as Record<string, unknown>)[name]
    : undefined;
}

/**
 * Pausing and resuming matching (PRD-001 §7, PLAN-001 P05-04). Pausing is
 * always one tap. Resuming shows the person their key preferences and what
 * else is needed, then waits for them to confirm (`{"confirmed": true}`).
 */
@Controller("v1/me")
export class AccountController {
  constructor(
    @Inject(ACCOUNT) private readonly accounts: AccountRepository,
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

  @Post("pause")
  @HttpCode(200)
  @Header("cache-control", "no-store")
  async pause(@Req() request: FastifyRequest, @Body() body: unknown): Promise<PauseBody> {
    const caller = await this.caller(request);
    const reason = field(body, "reason");
    if (!PAUSE_REASONS.some((known) => known === reason)) {
      throw new ApiError("invalid_request", 'reason must be "break" or "relationship".');
    }
    const outcome = await this.accounts.pause(
      caller,
      reason as PauseReason,
      this.clock(),
      this.context(request),
    );
    if (outcome.kind === "paused") return { status: "paused", reason: outcome.reason };
    if (outcome.kind === "refused") throw new ApiError("conflict", REFUSED[outcome.refusal]);
    throw new ApiError("not_found");
  }

  @Get("resume")
  @Header("cache-control", "no-store")
  async resumeStatus(@Req() request: FastifyRequest): Promise<ResumeBody> {
    const caller = await this.caller(request);
    const status = await this.accounts.resumeStatus(caller, this.clock());
    if (status === null) throw new ApiError("not_found");
    return resumeBody(status);
  }

  @Post("resume")
  @HttpCode(200)
  @Header("cache-control", "no-store")
  async resume(@Req() request: FastifyRequest, @Body() body: unknown): Promise<ResumeBody> {
    const caller = await this.caller(request);
    if (field(body, "confirmed") !== true) {
      throw new ApiError("invalid_request", 'Confirm with {"confirmed": true} to resume.');
    }
    const now = this.clock();
    const outcome = await this.accounts.resume(caller, true, now, this.context(request));
    switch (outcome.kind) {
      case "not_found":
        throw new ApiError("not_found");
      case "not_paused":
        throw new ApiError("conflict", "Matching is not paused.");
      case "needs":
        throw new ApiError(
          "conflict",
          "Some things need your attention first; see GET /v1/me/resume.",
        );
      case "resumed": {
        const status = await this.accounts.resumeStatus(caller, now);
        if (status === null) throw new ApiError("not_found");
        return resumeBody(status);
      }
    }
  }
}
