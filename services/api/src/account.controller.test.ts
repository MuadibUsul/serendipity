// Pause and resume over HTTP, against an in-memory repository.
import type { AccountRepository, PauseOutcome, ResumeOutcome } from "@serendipity/db";
import type { InvitationRepository } from "@serendipity/db";
import { afterEach, describe, expect, it } from "vitest";

import { DEV_CALLER_HEADER, devHeaderCallers } from "./callers.js";
import { READY, fixedReadiness, testApi } from "./test-support.js";

const NOW = new Date("2026-11-19T09:00:00Z");
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const NO_INVITATIONS: InvitationRepository = {
  forUser: () => Promise.resolve([]),
  forUserDate: () => Promise.resolve(null),
  answer: () => Promise.resolve({ kind: "not_found" }),
  open: () => Promise.resolve(false),
  expireDue: () => Promise.resolve(0),
};

function fakeAccounts(pauseOutcome: PauseOutcome, resumeOutcome: ResumeOutcome) {
  const calls: unknown[][] = [];
  const accounts: AccountRepository = {
    setBirthDate: (...args) => {
      calls.push(["birth", ...args.slice(0, 3)]);
      const [, date] = args;
      if (date === "2010-01-01") return Promise.resolve({ kind: "refused", refusal: "under_age" });
      if (date === "1990-01-01")
        return Promise.resolve({ kind: "refused", refusal: "already_set" });
      return Promise.resolve({ kind: "recorded" });
    },
    pause: (...args) => {
      calls.push(["pause", ...args]);
      return Promise.resolve(pauseOutcome);
    },
    resumeStatus: (userId) =>
      Promise.resolve(
        userId === ME
          ? {
              status: "paused",
              pausedReason: "break",
              needs: [],
              keyPreferences: { "self.city_region": "SFB_CORE" },
            }
          : null,
      ),
    resume: (...args) => {
      calls.push(["resume", ...args]);
      return Promise.resolve(resumeOutcome);
    },
  };
  return { accounts, calls };
}

let running: Awaited<ReturnType<typeof testApi>> | undefined;

async function start(
  pauseOutcome: PauseOutcome = { kind: "paused", reason: "break" },
  resumeOutcome: ResumeOutcome = { kind: "resumed" },
) {
  const fake = fakeAccounts(pauseOutcome, resumeOutcome);
  running = await testApi(fixedReadiness(READY), "test", {
    repository: NO_INVITATIONS,
    account: fake.accounts,
    callers: devHeaderCallers("test"),
    clock: () => NOW,
  });
  return { app: running.app, calls: fake.calls };
}

afterEach(async () => {
  await running?.app.close();
  running = undefined;
});

const as = { [DEV_CALLER_HEADER]: ME };

describe("pause and resume endpoints", () => {
  it("answer 401 without a caller", async () => {
    const { app } = await start();
    for (const [method, url] of [
      ["POST", "/v1/me/pause"],
      ["GET", "/v1/me/resume"],
      ["POST", "/v1/me/resume"],
    ] as const) {
      const response = await app.inject({ method, url, payload: {} });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it("pauses for a known reason only", async () => {
    const { app, calls } = await start();
    const bad = await app.inject({
      method: "POST",
      url: "/v1/me/pause",
      headers: as,
      payload: { reason: "bored" },
    });
    expect(bad.statusCode).toBe(400);
    expect(calls).toEqual([]);
    const ok = await app.inject({
      method: "POST",
      url: "/v1/me/pause",
      headers: as,
      payload: { reason: "break" },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ status: "paused", reason: "break" });
    expect(calls[0]?.slice(0, 4)).toEqual(["pause", ME, "break", NOW]);
  });

  it("tells a refused pause as a conflict, without saying more than needed", async () => {
    const { app } = await start({ kind: "refused", refusal: "suspended" });
    const response = await app.inject({
      method: "POST",
      url: "/v1/me/pause",
      headers: as,
      payload: { reason: "break" },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "conflict" });
  });

  it("shows the person's own key preferences and what is needed", async () => {
    const { app } = await start();
    const response = await app.inject({ method: "GET", url: "/v1/me/resume", headers: as });
    expect(response.json()).toEqual({
      status: "paused",
      paused_reason: "break",
      needs: [],
      key_preferences: { "self.city_region": "SFB_CORE" },
    });
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("resumes only with an explicit confirmation", async () => {
    const { app, calls } = await start();
    const unconfirmed = await app.inject({
      method: "POST",
      url: "/v1/me/resume",
      headers: as,
      payload: { confirmed: "yes" },
    });
    expect(unconfirmed.statusCode).toBe(400);
    expect(calls).toEqual([]);
    const confirmed = await app.inject({
      method: "POST",
      url: "/v1/me/resume",
      headers: as,
      payload: { confirmed: true },
    });
    expect(confirmed.statusCode).toBe(200);
    expect(calls[0]?.slice(0, 4)).toEqual(["resume", ME, true, NOW]);
  });

  it("answers 409 while something still needs the person's attention", async () => {
    const { app } = await start(undefined, { kind: "needs", needs: ["matching_consent"] });
    const response = await app.inject({
      method: "POST",
      url: "/v1/me/resume",
      headers: as,
      payload: { confirmed: true },
    });
    expect(response.statusCode).toBe(409);
  });

  it("records a date of birth once, refusing anyone under 18", async () => {
    const { app, calls } = await start();
    const post = (birth_date: unknown) =>
      app.inject({
        method: "POST",
        url: "/v1/me/birth-date",
        headers: as,
        payload: { birth_date },
      });
    expect((await post("31/12/1990")).statusCode).toBe(400);
    expect(calls).toEqual([]);
    expect((await post("1995-06-15")).json()).toEqual({ status: "recorded" });
    // Today is the market's local date: 2026-11-19 in San Francisco at 09:00Z.
    expect(calls[0]).toEqual(["birth", ME, "1995-06-15", "2026-11-19"]);
    expect((await post("2010-01-01")).statusCode).toBe(403);
    expect((await post("1990-01-01")).statusCode).toBe(409);
  });
});
