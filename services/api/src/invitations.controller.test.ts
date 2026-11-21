// The invitation endpoints over HTTP, against an in-memory repository: who
// may call, what comes back, and how refusals are told.
import type { AnswerOutcome, InvitationRepository } from "@serendipity/db";
import { createDate, transition } from "@serendipity/domain";
import type { DateRecord } from "@serendipity/domain";
import type { InvitationRecord } from "@serendipity/invitations";
import { VENUE_KEYS, VIEW_KEYS } from "@serendipity/invitations";
import { afterEach, describe, expect, it } from "vitest";

import { DEV_CALLER_HEADER, devHeaderCallers } from "./callers.js";
import { READY, fixedReadiness, testApi } from "./test-support.js";

const NOW = new Date("2026-11-18T04:00:00Z");
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DATE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function invited(): DateRecord {
  let date = createDate();
  for (const [event, source] of [
    ["VERIFIER_PASSED", "verifier"],
    ["INVITES_SENT", "booking"],
  ] as const) {
    const result = transition(date, { type: event }, { kind: "system", source });
    if (!result.ok) throw new Error(result.error.message);
    date = result.date;
  }
  return date;
}

const RECORD: InvitationRecord = {
  dateId: DATE_ID,
  party: "A",
  date: invited(),
  invite: { status: "pending", expiresAt: new Date("2026-11-19T04:00:00Z"), respondedAt: null },
  startsAt: new Date("2026-11-21T07:00:00Z"),
  endsAt: new Date("2026-11-21T08:30:00Z"),
  venue: { name: "Example Cafe (fictional)", address: "1 Example St (fictional), San Francisco" },
};

function fakeRepository(
  outcome: AnswerOutcome = { kind: "answered", changed: true, record: RECORD },
  record: InvitationRecord = RECORD,
) {
  const calls: unknown[][] = [];
  const repository: InvitationRepository = {
    forUser: (userId) => Promise.resolve(userId === ME ? [record] : []),
    forUserDate: (userId, dateId) =>
      Promise.resolve(userId === ME && dateId === DATE_ID ? record : null),
    answer: (...args) => {
      calls.push(args);
      return Promise.resolve(outcome);
    },
    open: () => Promise.resolve(true),
    expireDue: () => Promise.resolve(0),
  };
  return { repository, calls };
}

let running: Awaited<ReturnType<typeof testApi>> | undefined;

async function start(
  options: { env?: "test" | "prod"; outcome?: AnswerOutcome; record?: InvitationRecord } = {},
) {
  const env = options.env ?? "test";
  const fake = fakeRepository(options.outcome, options.record);
  running = await testApi(fixedReadiness(READY), env, {
    repository: fake.repository,
    callers: devHeaderCallers(env),
    clock: () => NOW,
  });
  return { app: running.app, calls: fake.calls };
}

afterEach(async () => {
  await running?.app.close();
  running = undefined;
});

const as = (userId: string) => ({ [DEV_CALLER_HEADER]: userId });

describe("who may call", () => {
  it("answers 401 without a caller", async () => {
    const { app } = await start();
    for (const [method, url] of [
      ["GET", "/v1/dates/upcoming"],
      ["GET", `/v1/dates/${DATE_ID}`],
      ["POST", `/v1/dates/${DATE_ID}/accept`],
      ["POST", `/v1/dates/${DATE_ID}/decline`],
    ] as const) {
      const response = await app.inject({ method, url });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
      expect(response.json()).toMatchObject({ code: "unauthenticated" });
    }
  });

  it("ignores the dev caller header in prod: every request is 401", async () => {
    const { app } = await start({ env: "prod" });
    const response = await app.inject({
      method: "GET",
      url: "/v1/dates/upcoming",
      headers: as(ME),
    });
    expect(response.statusCode).toBe(401);
  });

  it("refuses a caller header that is not a user id", async () => {
    const { app } = await start();
    const response = await app.inject({
      method: "GET",
      url: "/v1/dates/upcoming",
      headers: as("4155550123"),
    });
    expect(response.statusCode).toBe(401);
  });
});

describe("reading", () => {
  it("lists the caller's invitations with allowlisted fields only", async () => {
    const { app } = await start();
    const response = await app.inject({
      method: "GET",
      url: "/v1/dates/upcoming",
      headers: as(ME),
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    const { invitations } = response.json<{ invitations: Record<string, unknown>[] }>();
    expect(invitations).toHaveLength(1);
    expect(Object.keys(invitations[0] ?? {}).sort()).toEqual([...VIEW_KEYS].sort());
    expect(Object.keys((invitations[0]?.["venue"] as object | null) ?? {}).sort()).toEqual(
      [...VENUE_KEYS].sort(),
    );
    expect(invitations[0]).toMatchObject({ date_id: DATE_ID, status: "awaiting_you" });
  });

  it("answers 404 for a date that is not the caller's, and for a malformed id", async () => {
    const { app } = await start();
    const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    for (const url of [`/v1/dates/${other}`, "/v1/dates/not-a-uuid", `/v1/dates/${DATE_ID}`]) {
      const response = await app.inject({ method: "GET", url, headers: as(other) });
      expect(response.statusCode, url).toBe(404);
    }
  });
});

describe("answering", () => {
  it("accepts, passing the request's trace id to the repository", async () => {
    const { app, calls } = await start();
    const response = await app.inject({
      method: "POST",
      url: `/v1/dates/${DATE_ID}/accept`,
      headers: as(ME),
    });
    expect(response.statusCode).toBe(200);
    expect(Object.keys(response.json<object>()).sort()).toEqual([...VIEW_KEYS].sort());
    expect(calls).toHaveLength(1);
    const [caller, dateId, answer, now, context] = calls[0] ?? [];
    expect([caller, dateId, answer, now]).toEqual([ME, DATE_ID, "accept", NOW]);
    expect((context as { traceId: string }).traceId).toBe(response.headers["x-trace-id"]);
  });

  it.each([
    ["expired", 410, "gone"],
    ["closed", 409, "conflict"],
    ["already_declined", 409, "conflict"],
  ] as const)("tells a %s refusal as %i %s", async (refusal, status, code) => {
    const { app } = await start({ outcome: { kind: "refused", refusal, record: RECORD } });
    const response = await app.inject({
      method: "POST",
      url: `/v1/dates/${DATE_ID}/decline`,
      headers: as(ME),
    });
    expect(response.statusCode).toBe(status);
    expect(response.json()).toMatchObject({ code });
  });

  it("answers 404 when the repository finds no such date for the caller", async () => {
    const { app } = await start({ outcome: { kind: "not_found" } });
    const response = await app.inject({
      method: "POST",
      url: `/v1/dates/${DATE_ID}/accept`,
      headers: as(ME),
    });
    expect(response.statusCode).toBe(404);
  });

  it("does not reach the repository for a malformed id", async () => {
    const { app, calls } = await start();
    const response = await app.inject({
      method: "POST",
      url: "/v1/dates/1;DROP/accept",
      headers: as(ME),
    });
    expect(response.statusCode).toBe(404);
    expect(calls).toHaveLength(0);
  });
});

describe("the calendar file", () => {
  const confirmed: InvitationRecord = {
    ...RECORD,
    invite: { ...RECORD.invite, status: "accepted", respondedAt: NOW },
    date: { ...RECORD.date, state: "CONFIRMED" },
  };

  it("is served for a confirmed date, with the time and venue and no one's name", async () => {
    const { app } = await start({ record: confirmed });
    const response = await app.inject({
      method: "GET",
      url: `/v1/dates/${DATE_ID}/calendar.ics`,
      headers: as(ME),
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("text/calendar; charset=utf-8");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body).toContain("DTSTART:20261121T070000Z");
    expect(response.body).toContain("Example Cafe (fictional)");
  });

  it("is not served before the date is confirmed, nor for someone else's date", async () => {
    const pending = await start();
    const early = await pending.app.inject({
      method: "GET",
      url: `/v1/dates/${DATE_ID}/calendar.ics`,
      headers: as(ME),
    });
    expect(early.statusCode).toBe(404);
    await pending.app.close();
    const { app } = await start({ record: confirmed });
    const other = await app.inject({
      method: "GET",
      url: `/v1/dates/${DATE_ID}/calendar.ics`,
      headers: as("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
    });
    expect(other.statusCode).toBe(404);
  });
});
