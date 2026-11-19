import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import type { ChatMessage, RelationshipRepository, RelationshipSummary } from "@serendipity/db";
import { parseContact, parseMessageBody } from "@serendipity/relationships";
import type { ChatRefusal, ContactView } from "@serendipity/relationships";
import type { FastifyRequest } from "fastify";

import type { Callers } from "./callers.js";
import { isUuid } from "./callers.js";
import { ApiError } from "./errors.js";
import { CALLERS, CLOCK, RELATIONSHIPS } from "./tokens.js";
import { traceOf } from "./tracing.js";

export interface MessageBody {
  readonly id: string;
  readonly mine: boolean;
  readonly body: string;
  readonly sent_at: string;
}

const messageBody = (message: ChatMessage): MessageBody => ({
  id: message.id,
  mine: message.mine,
  body: message.body,
  sent_at: message.sentAt.toISOString(),
});

/** What the sender is told: their own reasons only; the other person's state reads as "closed". */
const REFUSED: Readonly<Record<ChatRefusal, () => ApiError>> = {
  not_mutual: () => new ApiError("forbidden", "Chat opens when you both said yes."),
  left: () => new ApiError("gone", "This chat has closed."),
  blocked: () => new ApiError("gone", "This chat has closed."),
  account_inactive: () => new ApiError("conflict", "This chat is closed for now."),
  no_consent: () => new ApiError("forbidden", "Turn on chat in your privacy settings first."),
};

/**
 * Chat after a mutual yes (PRD-001 §7, PLAN-001 P05-02, ADR-0020). A
 * relationship that is not the caller's answers 404.
 */
@Controller("v1/relationships")
export class RelationshipsController {
  constructor(
    @Inject(RELATIONSHIPS) private readonly relationships: RelationshipRepository,
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

  @Get()
  @Header("cache-control", "no-store")
  async list(@Req() request: FastifyRequest): Promise<{ relationships: object[] }> {
    const caller = await this.caller(request);
    const all = await this.relationships.forUser(caller);
    return {
      relationships: all.map((r: RelationshipSummary) => ({
        id: r.id,
        chat: r.chat,
        can_send: r.canSend,
      })),
    };
  }

  @Get(":id/messages")
  @Header("cache-control", "no-store")
  async messages(
    @Req() request: FastifyRequest,
    @Param("id") id: string,
    @Query("after") after?: string,
  ): Promise<{ messages: MessageBody[] }> {
    const caller = await this.caller(request);
    let since: Date | null = null;
    if (after !== undefined) {
      since = new Date(after);
      if (Number.isNaN(since.getTime()))
        throw new ApiError("invalid_request", "after must be a time.");
    }
    const found = isUuid(id) ? await this.relationships.messages(caller, id, since) : null;
    if (found === null) throw new ApiError("not_found");
    return { messages: found.map(messageBody) };
  }

  @Post(":id/messages")
  @HttpCode(201)
  @Header("cache-control", "no-store")
  async send(
    @Req() request: FastifyRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<MessageBody> {
    const caller = await this.caller(request);
    if (!isUuid(id)) throw new ApiError("not_found");
    const raw =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>)["body"]
        : undefined;
    const parsed = parseMessageBody(raw);
    if (!parsed.ok)
      throw new ApiError("invalid_request", "Send a message of 1 to 2000 characters.");
    const outcome = await this.relationships.send(
      caller,
      id,
      parsed.body,
      this.clock(),
      this.context(request),
    );
    if (outcome.kind === "sent") return messageBody(outcome.message);
    if (outcome.kind === "refused") throw REFUSED[outcome.refusal]();
    throw new ApiError("not_found");
  }

  /** The contact swap: each card is shown only once both have offered one. */
  @Get(":id/contact")
  @Header("cache-control", "no-store")
  async contact(@Req() request: FastifyRequest, @Param("id") id: string): Promise<ContactView> {
    const caller = await this.caller(request);
    const view = isUuid(id) ? await this.relationships.contact(caller, id) : null;
    if (view === null) throw new ApiError("not_found");
    return view;
  }

  @Put(":id/contact")
  @Header("cache-control", "no-store")
  async offer(
    @Req() request: FastifyRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ): Promise<ContactView> {
    const caller = await this.caller(request);
    if (!isUuid(id)) throw new ApiError("not_found");
    const read = (name: string) =>
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>)[name]
        : undefined;
    const parsed = parseContact(read("kind"), read("value"));
    if (!parsed.ok)
      throw new ApiError("invalid_request", "Choose wechat, phone or other, and one short line.");
    const outcome = await this.relationships.offerContact(caller, id, parsed.card, this.clock());
    if (outcome === null) throw new ApiError("not_found");
    if (outcome === "closed") throw new ApiError("gone", "This chat has closed.");
    if (outcome === "swapped") throw new ApiError("conflict", "You have already swapped cards.");
    return outcome;
  }

  @Delete(":id/contact")
  @Header("cache-control", "no-store")
  async withdraw(@Req() request: FastifyRequest, @Param("id") id: string): Promise<ContactView> {
    const caller = await this.caller(request);
    const outcome = isUuid(id) ? await this.relationships.withdrawContact(caller, id) : null;
    if (outcome === null) throw new ApiError("not_found");
    if (outcome === "swapped")
      throw new ApiError("conflict", "Cards already swapped cannot be taken back.");
    return outcome;
  }

  @Post(":id/leave")
  @HttpCode(204)
  async leave(@Req() request: FastifyRequest, @Param("id") id: string): Promise<void> {
    await this.close(request, id, "leave");
  }

  @Post(":id/block")
  @HttpCode(204)
  async block(@Req() request: FastifyRequest, @Param("id") id: string): Promise<void> {
    await this.close(request, id, "block");
  }

  private async close(request: FastifyRequest, id: string, how: "leave" | "block"): Promise<void> {
    const caller = await this.caller(request);
    const closed = isUuid(id)
      ? await this.relationships.close(caller, id, how, this.clock(), this.context(request))
      : false;
    if (!closed) throw new ApiError("not_found");
  }
}
