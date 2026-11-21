import { Body, Controller, Delete, Header, HttpCode, Inject, Put, Req } from "@nestjs/common";
import type { PushDeviceRepository } from "@serendipity/db";
import { PLATFORMS, isPushToken } from "@serendipity/notify";
import type { Platform } from "@serendipity/notify";
import type { FastifyRequest } from "fastify";

import type { Callers } from "./callers.js";
import { ApiError } from "./errors.js";
import { CALLERS, PUSH } from "./tokens.js";
import { traceOf } from "./tracing.js";

function field(body: unknown, name: string): unknown {
  return typeof body === "object" && body !== null
    ? (body as Record<string, unknown>)[name]
    : undefined;
}

/**
 * The phones that receive this person's notifications (ADR-0030). The app
 * sends its Expo push token after the person allows notifications, and
 * removes it when they sign out on that phone.
 */
@Controller("v1/me/push-device")
export class PushController {
  constructor(
    @Inject(PUSH) private readonly devices: PushDeviceRepository,
    @Inject(CALLERS) private readonly callers: Callers,
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

  @Put()
  @HttpCode(204)
  @Header("cache-control", "no-store")
  async register(@Req() request: FastifyRequest, @Body() body: unknown): Promise<void> {
    const caller = await this.caller(request);
    const token = field(body, "token");
    const platform = field(body, "platform");
    if (!isPushToken(token) || !PLATFORMS.some((known) => known === platform)) {
      throw new ApiError(
        "invalid_request",
        'Send {"token": "<Expo push token>", "platform": "ios" | "android"}.',
      );
    }
    await this.devices.register(caller, token, platform as Platform, this.context(request));
  }

  @Delete()
  @HttpCode(204)
  @Header("cache-control", "no-store")
  async remove(@Req() request: FastifyRequest, @Body() body: unknown): Promise<void> {
    const caller = await this.caller(request);
    const token = field(body, "token");
    if (!isPushToken(token)) throw new ApiError("invalid_request", 'Send {"token": "..."}.');
    await this.devices.unregister(caller, token, this.context(request));
  }
}
