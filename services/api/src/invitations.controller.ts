import { Controller, Get, Header, HttpCode, Inject, Param, Post, Req } from "@nestjs/common";
import type { AnswerOutcome, InvitationRepository } from "@serendipity/db";
import { invitationView } from "@serendipity/invitations";
import type { Answer, AnswerRefusal, InvitationView } from "@serendipity/invitations";
import type { FastifyRequest } from "fastify";

import type { Callers } from "./callers.js";
import { isUuid } from "./callers.js";
import { ApiError } from "./errors.js";
import { CALLERS, CLOCK, INVITATIONS } from "./tokens.js";
import { traceOf } from "./tracing.js";

/** How a refused answer is told to the client: the reason is the person's own business. */
const REFUSALS: Readonly<Record<AnswerRefusal, () => ApiError>> = {
  expired: () => new ApiError("gone", "The invitation has expired."),
  closed: () => new ApiError("conflict", "The invitation is closed."),
  already_declined: () => new ApiError("conflict", "You declined this invitation."),
};

/**
 * Anonymous date invitations (ARCH-001 §11.1, PRD-001 §5.3, §6.1). Every
 * response is an `InvitationView`: the caller's own invitation, the time and
 * the venue, never anything about the other person (ADR-006). A date that is
 * not the caller's answers 404, like one that does not exist.
 */
@Controller("v1/dates")
export class InvitationsController {
  constructor(
    @Inject(INVITATIONS) private readonly invitations: InvitationRepository,
    @Inject(CALLERS) private readonly callers: Callers,
    @Inject(CLOCK) private readonly clock: () => Date,
  ) {}

  private async caller(request: FastifyRequest): Promise<string> {
    const caller = await this.callers.callerOf(request.headers);
    if (caller === null) throw new ApiError("unauthenticated");
    return caller;
  }

  /** The caller's invitations up to the reveal, newest first. */
  @Get("upcoming")
  @Header("cache-control", "no-store")
  async upcoming(@Req() request: FastifyRequest): Promise<{ invitations: InvitationView[] }> {
    const caller = await this.caller(request);
    const now = this.clock();
    const records = await this.invitations.forUser(caller);
    return { invitations: records.map((record) => invitationView(record, now)) };
  }

  @Get(":id")
  @Header("cache-control", "no-store")
  async one(@Req() request: FastifyRequest, @Param("id") id: string): Promise<InvitationView> {
    const caller = await this.caller(request);
    const record = isUuid(id) ? await this.invitations.forUserDate(caller, id) : null;
    if (record === null) throw new ApiError("not_found");
    return invitationView(record, this.clock());
  }

  @Post(":id/accept")
  @HttpCode(200)
  @Header("cache-control", "no-store")
  accept(@Req() request: FastifyRequest, @Param("id") id: string): Promise<InvitationView> {
    return this.answer(request, id, "accept");
  }

  @Post(":id/decline")
  @HttpCode(200)
  @Header("cache-control", "no-store")
  decline(@Req() request: FastifyRequest, @Param("id") id: string): Promise<InvitationView> {
    return this.answer(request, id, "decline");
  }

  private async answer(
    request: FastifyRequest,
    id: string,
    answer: Answer,
  ): Promise<InvitationView> {
    const caller = await this.caller(request);
    if (!isUuid(id)) throw new ApiError("not_found");
    const now = this.clock();
    const trace = traceOf(request);
    const outcome: AnswerOutcome = await this.invitations.answer(caller, id, answer, now, {
      ...(trace === undefined ? {} : { traceId: trace.traceId }),
    });
    switch (outcome.kind) {
      case "answered":
        return invitationView(outcome.record, now);
      case "refused":
        throw REFUSALS[outcome.refusal]();
      case "not_found":
        throw new ApiError("not_found");
      default:
        return assertNever(outcome);
    }
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected answer outcome: ${JSON.stringify(value)}`);
}
