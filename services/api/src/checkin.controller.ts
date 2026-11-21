import { Body, Controller, Get, Header, HttpCode, Inject, Param, Post, Req } from "@nestjs/common";
import { DEVICE_KEY, checkinOpen, codeFor, deviceKeyHash, readCode } from "@serendipity/checkin";
import type { CheckinRepository } from "@serendipity/db";
import type { FastifyRequest } from "fastify";

import type { Callers } from "./callers.js";
import { bearerOf, isUuid } from "./callers.js";
import { ApiError } from "./errors.js";
import { CALLERS, CHECKIN, CLOCK } from "./tokens.js";
import { traceOf } from "./tracing.js";

/** What check-in needs (ADR-0028). */
export interface CheckinDeps {
  readonly repository: CheckinRepository;
  /** Keys the codes and device key hashes; derived from the server's secret. */
  readonly secret: string;
}

/**
 * Checking in at the venue (ADR-0028). The person's app shows a code that
 * changes every minute; the venue's registered device scans it, and, once
 * both are there, reveals the date. A device sends its key as a bearer
 * token and acts only on dates at its own venue.
 */
@Controller("v1")
export class CheckinController {
  constructor(
    @Inject(CHECKIN) private readonly checkin: CheckinDeps,
    @Inject(CALLERS) private readonly callers: Callers,
    @Inject(CLOCK) private readonly clock: () => Date,
  ) {}

  private context(request: FastifyRequest): { traceId?: string } {
    const trace = traceOf(request);
    return trace === undefined ? {} : { traceId: trace.traceId };
  }

  private async venueOf(request: FastifyRequest): Promise<string> {
    const key = bearerOf(request.headers);
    const venueId =
      key !== null && DEVICE_KEY.test(key)
        ? await this.checkin.repository.deviceVenue(deviceKeyHash(this.checkin.secret, key))
        : null;
    if (venueId === null) throw new ApiError("unauthenticated");
    return venueId;
  }

  /** The person's code for their own date, while check-in is open. */
  @Get("dates/:id/checkin-code")
  @Header("cache-control", "no-store")
  async code(
    @Req() request: FastifyRequest,
    @Param("id") id: string,
  ): Promise<{ code: string; refresh_in_s: number } | { checked_in: true }> {
    const caller = await this.callers.callerOf(request.headers);
    if (caller === null) throw new ApiError("unauthenticated");
    const own = isUuid(id) ? await this.checkin.repository.ownCheckin(caller, id) : null;
    if (own === null) throw new ApiError("not_found");
    if (own.checkedIn) return { checked_in: true };
    if (!own.showing) throw new ApiError("conflict", "This date isn't on right now.");
    const now = this.clock();
    if (!checkinOpen(own.startAt, own.endAt, now)) {
      throw new ApiError("conflict", "Check-in opens 30 minutes before your date.");
    }
    const { code, refreshInS } = codeFor(this.checkin.secret, id, own.party, now);
    return { code, refresh_in_s: refreshInS };
  }

  /** A venue device scans a code. */
  @Post("venue/checkins")
  @HttpCode(200)
  @Header("cache-control", "no-store")
  async scan(
    @Req() request: FastifyRequest,
    @Body() body: unknown,
  ): Promise<{ checked_in: true; both_here: boolean; date_id: string }> {
    const venueId = await this.venueOf(request);
    const scanned =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>)["code"]
        : undefined;
    if (typeof scanned !== "string" || scanned.length > 200) {
      throw new ApiError("invalid_request", 'Send the scanned code as {"code": "..."}.');
    }
    const now = this.clock();
    const read = readCode(this.checkin.secret, scanned, now);
    if (!read.ok) {
      throw new ApiError("invalid_request", "That code didn't work. Ask them to refresh it.");
    }
    const outcome = await this.checkin.repository.checkIn(
      venueId,
      read.dateId,
      read.party,
      now,
      checkinOpen,
      this.context(request),
    );
    switch (outcome.kind) {
      case "checked_in":
        return { checked_in: true, both_here: outcome.both, date_id: read.dateId };
      case "not_found":
        throw new ApiError("not_found", "This date isn't at your venue.");
      case "closed":
        throw new ApiError("conflict", "Check-in for this date isn't open.");
      case "refused":
        throw new ApiError("conflict", "This date can't be checked in right now.");
    }
  }

  /** Once both are at the table, the venue reveals the date. */
  @Post("venue/dates/:id/reveal")
  @HttpCode(200)
  @Header("cache-control", "no-store")
  async reveal(
    @Req() request: FastifyRequest,
    @Param("id") id: string,
  ): Promise<{ revealed: true }> {
    const venueId = await this.venueOf(request);
    if (!isUuid(id)) throw new ApiError("not_found");
    const outcome = await this.checkin.repository.reveal(venueId, id, this.context(request));
    if (outcome.kind === "revealed") return { revealed: true };
    if (outcome.kind === "waiting") throw new ApiError("conflict", "Both need to check in first.");
    throw new ApiError("not_found");
  }
}
