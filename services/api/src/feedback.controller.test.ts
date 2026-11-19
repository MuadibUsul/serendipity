// Feedback over HTTP, against an in-memory repository.
import type { FeedbackOutcome, FeedbackRepository, InvitationRepository } from "@serendipity/db";
import { afterEach, describe, expect, it } from "vitest";

import { DEV_CALLER_HEADER, devHeaderCallers } from "./callers.js";
import { READY, fixedReadiness, testApi } from "./test-support.js";

const NOW = new Date("2026-11-21T10:00:00Z");
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DATE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ANSWER = { felt_safe: true, comfort: 4, wants_to_continue: true };

const NO_INVITATIONS: InvitationRepository = {
  forUser: () => Promise.resolve([]),
  forUserDate: () => Promise.resolve(null),
  answer: () => Promise.resolve({ kind: "not_found" }),
  open: () => Promise.resolve(false),
  expireDue: () => Promise.resolve(0),
};

let running: Awaited<ReturnType<typeof testApi>> | undefined;

async function start(outcome: FeedbackOutcome = { kind: "answered", view: { status: "thanks" } }) {
  const calls: unknown[][] = [];
  const feedback: FeedbackRepository = {
    view: (userId, dateId) =>
      Promise.resolve(userId === ME && dateId === DATE_ID ? { status: "thanks" } : null),
    submit: (...args) => {
      calls.push(args);
      return Promise.resolve(outcome);
    },
  };
  running = await testApi(fixedReadiness(READY), "test", {
    repository: NO_INVITATIONS,
    feedback,
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
const url = `/v1/dates/${DATE_ID}/feedback`;

describe("feedback endpoints", () => {
  it("answer 401 without a caller", async () => {
    const { app } = await start();
    expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url, payload: ANSWER })).statusCode).toBe(401);
  });

  it("shows the caller only their own view, and 404 for a date that is not theirs", async () => {
    const { app } = await start();
    const mine = await app.inject({ method: "GET", url, headers: as });
    expect(mine.json()).toEqual({ status: "thanks" });
    const other = await app.inject({
      method: "GET",
      url: "/v1/dates/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/feedback",
      headers: as,
    });
    expect(other.statusCode).toBe(404);
  });

  it("accepts the three answers, and refuses free text", async () => {
    const { app, calls } = await start();
    const note = await app.inject({
      method: "POST",
      url,
      headers: as,
      payload: { ...ANSWER, note: "x" },
    });
    expect(note.statusCode).toBe(400);
    expect(calls).toEqual([]);
    const ok = await app.inject({ method: "POST", url, headers: as, payload: ANSWER });
    expect(ok.statusCode).toBe(200);
    expect(calls[0]?.slice(0, 4)).toEqual([
      ME,
      DATE_ID,
      { feltSafe: true, comfort: 4, wantsToContinue: true },
      NOW,
    ]);
  });

  it("tells a second answer as a conflict and a closed window as gone", async () => {
    const twice = await start({ kind: "refused", refusal: "already_answered" });
    expect(
      (await twice.app.inject({ method: "POST", url, headers: as, payload: ANSWER })).statusCode,
    ).toBe(409);
    await running?.app.close();
    const late = await start({ kind: "refused", refusal: "closed" });
    expect(
      (await late.app.inject({ method: "POST", url, headers: as, payload: ANSWER })).statusCode,
    ).toBe(410);
  });
});
