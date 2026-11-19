// Chat over HTTP, against an in-memory repository.
import type { InvitationRepository, RelationshipRepository, SendOutcome } from "@serendipity/db";
import { afterEach, describe, expect, it } from "vitest";

import { DEV_CALLER_HEADER, devHeaderCallers } from "./callers.js";
import { READY, fixedReadiness, testApi } from "./test-support.js";

const NOW = new Date("2026-11-22T10:00:00Z");
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REL = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const NO_INVITATIONS: InvitationRepository = {
  forUser: () => Promise.resolve([]),
  forUserDate: () => Promise.resolve(null),
  answer: () => Promise.resolve({ kind: "not_found" }),
  open: () => Promise.resolve(false),
  expireDue: () => Promise.resolve(0),
};

let running: Awaited<ReturnType<typeof testApi>> | undefined;

async function start(outcome?: SendOutcome) {
  const calls: unknown[][] = [];
  const relationships: RelationshipRepository = {
    forUser: () => Promise.resolve([{ id: REL, chat: "open", canSend: true }]),
    messages: (userId, id) =>
      Promise.resolve(
        userId === ME && id === REL ? [{ id: "m1", mine: false, body: "你好", sentAt: NOW }] : null,
      ),
    send: (...args) => {
      calls.push(["send", ...args]);
      return Promise.resolve(
        outcome ?? { kind: "sent", message: { id: "m2", mine: true, body: args[2], sentAt: NOW } },
      );
    },
    close: (...args) => {
      calls.push(["close", ...args]);
      return Promise.resolve(args[1] === REL);
    },
  };
  running = await testApi(fixedReadiness(READY), "test", {
    repository: NO_INVITATIONS,
    relationships,
    callers: devHeaderCallers("test"),
    clock: () => NOW,
  });
  return { app: running.app, calls };
}

afterEach(async () => {
  await running?.app.close();
  running = undefined;
});

const as = { [DEV_CALLER_HEADER]: ME };

describe("chat endpoints", () => {
  it("answer 401 without a caller", async () => {
    const { app } = await start();
    for (const [method, url] of [
      ["GET", "/v1/relationships"],
      ["GET", `/v1/relationships/${REL}/messages`],
      ["POST", `/v1/relationships/${REL}/messages`],
      ["POST", `/v1/relationships/${REL}/leave`],
      ["POST", `/v1/relationships/${REL}/block`],
    ] as const) {
      expect((await app.inject({ method, url, payload: {} })).statusCode, `${method} ${url}`).toBe(
        401,
      );
    }
  });

  it("lists the caller's relationships and their messages", async () => {
    const { app } = await start();
    expect(
      (await app.inject({ method: "GET", url: "/v1/relationships", headers: as })).json(),
    ).toEqual({
      relationships: [{ id: REL, chat: "open", can_send: true }],
    });
    const messages = await app.inject({
      method: "GET",
      url: `/v1/relationships/${REL}/messages`,
      headers: as,
    });
    expect(messages.json()).toEqual({
      messages: [{ id: "m1", mine: false, body: "你好", sent_at: NOW.toISOString() }],
    });
    const bad = await app.inject({
      method: "GET",
      url: `/v1/relationships/${REL}/messages?after=soon`,
      headers: as,
    });
    expect(bad.statusCode).toBe(400);
  });

  it("sends a trimmed message and refuses an empty one", async () => {
    const { app, calls } = await start();
    const empty = await app.inject({
      method: "POST",
      url: `/v1/relationships/${REL}/messages`,
      headers: as,
      payload: { body: "  " },
    });
    expect(empty.statusCode).toBe(400);
    expect(calls).toEqual([]);
    const sent = await app.inject({
      method: "POST",
      url: `/v1/relationships/${REL}/messages`,
      headers: as,
      payload: { body: " 明天见 " },
    });
    expect(sent.statusCode).toBe(201);
    expect(calls[0]?.slice(0, 5)).toEqual(["send", ME, REL, "明天见", NOW]);
  });

  it("tells a closed chat as gone, saying no more than that", async () => {
    const { app } = await start({ kind: "refused", refusal: "blocked" });
    const response = await app.inject({
      method: "POST",
      url: `/v1/relationships/${REL}/messages`,
      headers: as,
      payload: { body: "hi" },
    });
    expect(response.statusCode).toBe(410);
    expect(response.json<{ detail: string }>().detail).toBe("This chat has closed.");
  });

  it("leaves and blocks, and 404s for a relationship that is not the caller's", async () => {
    const { app } = await start();
    expect(
      (await app.inject({ method: "POST", url: `/v1/relationships/${REL}/leave`, headers: as }))
        .statusCode,
    ).toBe(204);
    expect(
      (await app.inject({ method: "POST", url: `/v1/relationships/${REL}/block`, headers: as }))
        .statusCode,
    ).toBe(204);
    const other = await app.inject({
      method: "POST",
      url: "/v1/relationships/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/block",
      headers: as,
    });
    expect(other.statusCode).toBe(404);
  });
});
