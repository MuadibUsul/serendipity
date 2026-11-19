import { Body, Controller, Get, Header, HttpCode, Inject, Param, Post, Req } from "@nestjs/common";
import type { FeedbackRepository } from "@serendipity/db";
import { parseFeedback } from "@serendipity/feedback";
import type { FeedbackView, SubmitRefusal } from "@serendipity/feedback";
import type { FastifyRequest } from "fastify";

import type { Callers } from "./callers.js";
import { isUuid } from "./callers.js";
import { ApiError } from "./errors.js";
import { CALLERS, CLOCK, FEEDBACK } from "./tokens.js";
import { traceOf } from "./tracing.js";

const REFUSED: Readonly<Record<SubmitRefusal, () => ApiError>> = {
  not_open: () => new ApiError("conflict", "Feedback opens after the date."),
  closed: () => new ApiError("gone", "Feedback for this date has closed."),
  already_answered: () => new ApiError("conflict", "You already answered."),
};

/**
 * Private feedback after a date (PRD-001 §7, PLAN-001 P05-01). The caller
 * sees only their own view: "mutual" when both said yes, and nothing else
 * about the other person's answer (ADR-0019).
 */
@Controller("v1/dates")
export class FeedbackController {
  constructor(
    @Inject(FEEDBACK) private readonly feedback: FeedbackRepository,
    @Inject(CALLERS) private readonly callers: Callers,
    @Inject(CLOCK) private readonly clock: () => Date,
  ) {}

  private async caller(request: FastifyRequest): Promise<string> {
    const caller = await this.callers.callerOf(request.headers);
    if (caller === null) throw new ApiError("unauthenticated");
    return caller;
  }

  @Get(":id/feedback")
  @Header("cache-control", "no-store")
  async view(@Req() request: FastifyRequest, @Param("id") id: string): Promise<FeedbackView> {
    const caller = await this.caller(request);
    const view = isUuid(id) ? await this.feedback.view(caller, id, this.clock()) : null;
    if (view === null) throw new ApiError("not_found");
    return view;
  }

  @Post(":id/feedback")
  @HttpCode(200)
  @Header("cache-control", "no-store")
  async submit(
    @Req() request: FastifyRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<FeedbackView> {
    const caller = await this.caller(request);
    if (!isUuid(id)) throw new ApiError("not_found");
    const parsed = parseFeedback(body);
    if (!parsed.ok) {
      throw new ApiError(
        "invalid_request",
        "Send felt_safe (true or false), comfort (1 to 5) and wants_to_continue (true or false).",
      );
    }
    const trace = traceOf(request);
    const outcome = await this.feedback.submit(caller, id, parsed.answer, this.clock(), {
      ...(trace === undefined ? {} : { traceId: trace.traceId }),
    });
    if (outcome.kind === "answered") return outcome.view;
    if (outcome.kind === "refused") throw REFUSED[outcome.refusal]();
    throw new ApiError("not_found");
  }
}
