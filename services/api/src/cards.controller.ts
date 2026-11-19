import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Req,
} from "@nestjs/common";
import type { RevealRepository, RevealView } from "@serendipity/db";
import { isCategory } from "@serendipity/relationships";
import type { Card, Category, FlipRefusal } from "@serendipity/relationships";
import type { FastifyRequest } from "fastify";

import type { Callers } from "./callers.js";
import { isUuid } from "./callers.js";
import { ApiError } from "./errors.js";
import { CALLERS, CLOCK, REVEAL } from "./tokens.js";
import { traceOf } from "./tracing.js";

const REFUSED: Readonly<Record<FlipRefusal, () => ApiError>> = {
  closed: () => new ApiError("gone", "This chat has closed."),
  no_consent: () => new ApiError("forbidden", "Cards need both of you to turn them on."),
  daily_limit: () => new ApiError("rate_limited", "One card a day: come back tomorrow."),
  wait_for_them: () => new ApiError("conflict", "Wait for them to turn over a card of yours."),
  category_empty: () => new ApiError("conflict", "No cards left in that category."),
};

const viewBody = (view: RevealView) => ({
  status: view.status,
  face_down: view.faceDown,
  seen: view.seen,
  can_flip: view.refusal === null,
});

function categoryList(body: unknown, name: string): Category[] {
  const raw =
    typeof body === "object" && body !== null ? (body as Record<string, unknown>)[name] : undefined;
  if (raw === undefined) return [];
  if (
    !Array.isArray(raw) ||
    !raw.every((item): item is string => typeof item === "string" && isCategory(item))
  ) {
    throw new ApiError("invalid_request", `${name} must list card categories.`);
  }
  return raw as Category[];
}

/** One card a day after a mutual yes (ADR-0021). */
@Controller("v1")
export class CardsController {
  constructor(
    @Inject(REVEAL) private readonly reveal: RevealRepository,
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

  @Get("relationships/:id/cards")
  @Header("cache-control", "no-store")
  async view(@Req() request: FastifyRequest, @Param("id") id: string) {
    const caller = await this.caller(request);
    const view = isUuid(id) ? await this.reveal.view(caller, id, this.clock()) : null;
    if (view === null) throw new ApiError("not_found");
    return viewBody(view);
  }

  @Post("relationships/:id/cards")
  @HttpCode(200)
  @Header("cache-control", "no-store")
  async flip(
    @Req() request: FastifyRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<Card> {
    const caller = await this.caller(request);
    if (!isUuid(id)) throw new ApiError("not_found");
    const category =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>)["category"]
        : undefined;
    if (typeof category !== "string" || !isCategory(category)) {
      throw new ApiError("invalid_request", "Choose a card category to turn over.");
    }
    const outcome = await this.reveal.flip(
      caller,
      id,
      category,
      this.clock(),
      undefined,
      this.context(request),
    );
    if (outcome.kind === "flipped") return outcome.card;
    if (outcome.kind === "refused") throw REFUSED[outcome.refusal]();
    throw new ApiError("not_found");
  }

  @Get("me/deck")
  @Header("cache-control", "no-store")
  async deck(@Req() request: FastifyRequest) {
    return this.reveal.settings(await this.caller(request));
  }

  @Put("me/deck")
  @Header("cache-control", "no-store")
  async setDeck(@Req() request: FastifyRequest, @Body() body: unknown) {
    const caller = await this.caller(request);
    const settings = {
      excluded: categoryList(body, "excluded"),
      included: categoryList(body, "included"),
    };
    await this.reveal.setSettings(caller, settings, this.context(request));
    return this.reveal.settings(caller);
  }
}
