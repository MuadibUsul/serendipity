import { Body, Controller, Get, Header, HttpCode, Inject, Param, Post, Req } from "@nestjs/common";
import type { SafetyRepository } from "@serendipity/db";
import { parseReport } from "@serendipity/safety";
import type { FastifyRequest } from "fastify";

import type { Callers } from "./callers.js";
import { isUuid } from "./callers.js";
import { ApiError } from "./errors.js";
import { CALLERS, CLOCK, SAFETY } from "./tokens.js";
import { traceOf } from "./tracing.js";

const field = (body: unknown, name: string): unknown =>
  typeof body === "object" && body !== null ? (body as Record<string, unknown>)[name] : undefined;

/**
 * Reporting someone you had a date with (PRD-001 §8.1, ADR-0022). The
 * reporter is told only that the report was received, then handled. Staff
 * decisions and appeals have no public endpoint: they wait for staff
 * accounts (an owner decision) and run from the safety runbook meanwhile.
 */
@Controller("v1")
export class SafetyController {
  constructor(
    @Inject(SAFETY) private readonly safety: SafetyRepository,
    @Inject(CALLERS) private readonly callers: Callers,
    @Inject(CLOCK) private readonly clock: () => Date,
  ) {}

  private async caller(request: FastifyRequest): Promise<string> {
    const caller = await this.callers.callerOf(request.headers);
    if (caller === null) throw new ApiError("unauthenticated");
    return caller;
  }

  @Post("dates/:id/report")
  @HttpCode(202)
  @Header("cache-control", "no-store")
  async report(@Req() request: FastifyRequest, @Param("id") id: string, @Body() body: unknown) {
    const caller = await this.caller(request);
    if (!isUuid(id)) throw new ApiError("not_found");
    const parsed = parseReport(field(body, "category"), field(body, "details"));
    if (!parsed.ok)
      throw new ApiError("invalid_request", "Choose what happened; details are optional.");
    const trace = traceOf(request);
    const outcome = await this.safety.report(
      caller,
      id,
      parsed.category,
      parsed.details,
      this.clock(),
      {
        ...(trace === undefined ? {} : { traceId: trace.traceId }),
      },
    );
    if (outcome.kind === "not_found") throw new ApiError("not_found");
    return { status: "received" };
  }

  @Get("me/reports")
  @Header("cache-control", "no-store")
  async mine(@Req() request: FastifyRequest) {
    const reports = await this.safety.ownReports(await this.caller(request));
    return {
      reports: reports.map((r) => ({
        id: r.id,
        category: r.category,
        created_at: r.createdAt.toISOString(),
        status: r.status,
      })),
    };
  }
}
