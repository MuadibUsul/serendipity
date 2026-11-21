// Check-in over HTTP (ADR-0028): the person's code and the venue device's
// scan and reveal, against an in-memory repository.
import { codeFor, deviceKeyHash, newDeviceKey } from "@serendipity/checkin";
import type {
  CheckinOutcome,
  CheckinRepository,
  InvitationRepository,
  OwnCheckin,
} from "@serendipity/db";
import { afterEach, describe, expect, it } from "vitest";

import { DEV_CALLER_HEADER, devHeaderCallers } from "./callers.js";
import { READY, fixedReadiness, testApi } from "./test-support.js";

const SECRET = "checkin:test-secret-0123456789abcdef0123";
const NOW = new Date("2026-11-22T02:50:20Z");
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DATE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const VENUE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const KEY = newDeviceKey();
const as = { [DEV_CALLER_HEADER]: ME };
const device = { authorization: `Bearer ${KEY}` };

const NO_INVITATIONS: InvitationRepository = {
  forUser: () => Promise.resolve([]),
  forUserDate: () => Promise.resolve(null),
  answer: () => Promise.resolve({ kind: "not_found" }),
  open: () => Promise.resolve(false),
  expireDue: () => Promise.resolve(0),
};

function memory(own: Partial<OwnCheckin> | null = {}) {
  const scans: unknown[][] = [];
  let outcome: CheckinOutcome = { kind: "checked_in", both: false, repeated: false };
  const repository: CheckinRepository = {
    ownCheckin: (userId, dateId) =>
      Promise.resolve(
        own === null || userId !== ME || dateId !== DATE
          ? null
          : {
              party: "B",
              startAt: new Date("2026-11-22T03:00:00Z"),
              endAt: new Date("2026-11-22T05:00:00Z"),
              showing: true,
              checkedIn: false,
              ...own,
            },
      ),
    deviceVenue: (hash) => Promise.resolve(hash === deviceKeyHash(SECRET, KEY) ? VENUE : null),
    registerDevice: () => Promise.resolve("device-1"),
    revokeDevice: () => Promise.resolve(true),
    checkIn(venueId, dateId, party) {
      scans.push([venueId, dateId, party]);
      return Promise.resolve(outcome);
    },
    reveal: (venueId, dateId) =>
      Promise.resolve(
        venueId === VENUE && dateId === DATE
          ? { kind: "revealed", repeated: false }
          : { kind: "not_found" },
      ),
  };
  return {
    repository,
    scans,
    setOutcome: (next: CheckinOutcome) => {
      outcome = next;
    },
  };
}

let running: Awaited<ReturnType<typeof testApi>> | undefined;

async function start(own: Partial<OwnCheckin> | null = {}, at = NOW) {
  const state = memory(own);
  running = await testApi(fixedReadiness(READY), "test", {
    repository: NO_INVITATIONS,
    checkin: { repository: state.repository, secret: SECRET },
    callers: devHeaderCallers("test"),
    clock: () => at,
  });
  return { app: running.app, ...state };
}

afterEach(async () => {
  await running?.app.close();
  running = undefined;
});

describe("the person's code", () => {
  it("is shown for their own date while check-in is open, and changes every minute", async () => {
    const { app } = await start();
    const response = await app.inject({
      method: "GET",
      url: `/v1/dates/${DATE}/checkin-code`,
      headers: as,
    });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({
      code: codeFor(SECRET, DATE, "B", NOW).code,
      refresh_in_s: 40,
    });
  });

  it("is refused outside the window, for a date not on, and for someone else's date", async () => {
    const early = await start({}, new Date("2026-11-22T02:00:00Z"));
    const tooEarly = await early.app.inject({
      method: "GET",
      url: `/v1/dates/${DATE}/checkin-code`,
      headers: as,
    });
    expect(tooEarly.statusCode).toBe(409);
    await early.app.close();

    const off = await start({ showing: false });
    const notOn = await off.app.inject({
      method: "GET",
      url: `/v1/dates/${DATE}/checkin-code`,
      headers: as,
    });
    expect(notOn.statusCode).toBe(409);
    await off.app.close();

    const theirs = await start(null);
    const other = await theirs.app.inject({
      method: "GET",
      url: `/v1/dates/${DATE}/checkin-code`,
      headers: as,
    });
    expect(other.statusCode).toBe(404);
  });

  it("says so once the person is checked in, instead of a code", async () => {
    const { app } = await start({ checkedIn: true });
    const response = await app.inject({
      method: "GET",
      url: `/v1/dates/${DATE}/checkin-code`,
      headers: as,
    });
    expect(response.json()).toEqual({ checked_in: true });
  });
});

describe("the venue device", () => {
  it("must send a registered key", async () => {
    const { app, scans } = await start();
    for (const headers of [{}, { authorization: `Bearer ${newDeviceKey()}` }, as]) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/venue/checkins",
        headers,
        payload: { code: codeFor(SECRET, DATE, "A", NOW).code },
      });
      expect(response.statusCode).toBe(401);
    }
    expect(scans).toEqual([]);
  });

  it("checks in the side the code names, at its own venue", async () => {
    const { app, scans, setOutcome } = await start();
    const first = await app.inject({
      method: "POST",
      url: "/v1/venue/checkins",
      headers: device,
      payload: { code: codeFor(SECRET, DATE, "A", NOW).code },
    });
    expect(first.json()).toEqual({ checked_in: true, both_here: false, date_id: DATE });
    expect(scans).toEqual([[VENUE, DATE, "A"]]);
    setOutcome({ kind: "checked_in", both: true, repeated: false });
    const second = await app.inject({
      method: "POST",
      url: "/v1/venue/checkins",
      headers: device,
      payload: { code: codeFor(SECRET, DATE, "B", NOW).code },
    });
    expect(second.json()).toMatchObject({ both_here: true });
  });

  it("refuses a forged or old code without touching the date", async () => {
    const { app, scans } = await start();
    const old = codeFor(SECRET, DATE, "A", new Date(NOW.getTime() - 3 * 60_000)).code;
    const forged = codeFor("another-secret-0123456789abcdef", DATE, "A", NOW).code;
    for (const code of [old, forged, "hello"]) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/venue/checkins",
        headers: device,
        payload: { code },
      });
      expect(response.statusCode).toBe(400);
    }
    expect(scans).toEqual([]);
  });

  it("tells a date at another venue, a closed window and a date not on apart for staff", async () => {
    const { app, setOutcome } = await start();
    const code = codeFor(SECRET, DATE, "A", NOW).code;
    const answers: number[] = [];
    for (const outcome of [
      { kind: "not_found" },
      { kind: "closed" },
      { kind: "refused" },
    ] as const) {
      setOutcome(outcome);
      const response = await app.inject({
        method: "POST",
        url: "/v1/venue/checkins",
        headers: device,
        payload: { code },
      });
      answers.push(response.statusCode);
    }
    expect(answers).toEqual([404, 409, 409]);
  });

  it("reveals a date at its venue", async () => {
    const { app } = await start();
    const ok = await app.inject({
      method: "POST",
      url: `/v1/venue/dates/${DATE}/reveal`,
      headers: device,
    });
    expect(ok.json()).toEqual({ revealed: true });
    const elsewhere = await app.inject({
      method: "POST",
      url: "/v1/venue/dates/ffffffff-ffff-4fff-8fff-ffffffffffff/reveal",
      headers: device,
    });
    expect(elsewhere.statusCode).toBe(404);
  });
});
