// Reporting over HTTP, against an in-memory repository.
import type { InvitationRepository, SafetyRepository } from "@serendipity/db";
import { afterEach, describe, expect, it } from "vitest";

import { DEV_CALLER_HEADER, devHeaderCallers } from "./callers.js";
import { READY, fixedReadiness, testApi } from "./test-support.js";

const NOW = new Date("2026-11-22T10:00:00Z");
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DATE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const NO_INVITATIONS: InvitationRepository = {
  forUser: () => Promise.resolve([]),
  forUserDate: () => Promise.resolve(null),
  answer: () => Promise.resolve({ kind: "not_found" }),
  open: () => Promise.resolve(false),
  expireDue: () => Promise.resolve(0),
};

let running: Awaited<ReturnType<typeof testApi>> | undefined;

async function start() {
  const calls: unknown[][] = [];
  const safety: SafetyRepository = {
    report: (...args) => {
      calls.push(args.slice(0, 5));
      return Promise.resolve(
        args[1] === DATE_ID ? { kind: "received", id: "r1", risk: "high" } : { kind: "not_found" },
      );
    },
    ownReports: () =>
      Promise.resolve([{ id: "r1", category: "stalking", createdAt: NOW, status: "received" }]),
    queue: () => Promise.resolve([]),
    decide: () => Promise.resolve(true),
    recordAppeal: () => Promise.resolve(null),
    decideAppeal: () => Promise.resolve(true),
  };
  running = await testApi(fixedReadiness(READY), "test", {
    repository: NO_INVITATIONS,
    safety,
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
const url = `/v1/dates/${DATE_ID}/report`;

describe("report endpoints", () => {
  it("answer 401 without a caller", async () => {
    const { app } = await start();
    expect((await app.inject({ method: "POST", url, payload: {} })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/me/reports" })).statusCode).toBe(401);
  });

  it("takes a report and says only that it was received, never the risk", async () => {
    const { app, calls } = await start();
    const response = await app.inject({
      method: "POST",
      url,
      headers: as,
      payload: { category: "stalking", details: " followed me " },
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({ status: "received" });
    expect(calls[0]).toEqual([ME, DATE_ID, "stalking", "followed me", NOW]);
  });

  it("refuses an unknown category, and 404s for a date that is not the caller's", async () => {
    const { app } = await start();
    const bad = await app.inject({
      method: "POST",
      url,
      headers: as,
      payload: { category: "rude" },
    });
    expect(bad.statusCode).toBe(400);
    const other = await app.inject({
      method: "POST",
      url: "/v1/dates/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/report",
      headers: as,
      payload: { category: "scam" },
    });
    expect(other.statusCode).toBe(404);
  });

  it("lists the caller's own reports by status only", async () => {
    const { app } = await start();
    expect(
      (await app.inject({ method: "GET", url: "/v1/me/reports", headers: as })).json(),
    ).toEqual({
      reports: [
        { id: "r1", category: "stalking", created_at: NOW.toISOString(), status: "received" },
      ],
    });
  });
});
