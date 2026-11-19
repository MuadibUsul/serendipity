// Cards over HTTP, against an in-memory repository.
import type { FlipOutcome, InvitationRepository, RevealRepository } from "@serendipity/db";
import { afterEach, describe, expect, it } from "vitest";

import { DEV_CALLER_HEADER, devHeaderCallers } from "./callers.js";
import { READY, fixedReadiness, testApi } from "./test-support.js";

const NOW = new Date("2026-11-22T02:00:00Z");
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

async function start(
  outcome: FlipOutcome = {
    kind: "flipped",
    card: { category: "date.cuisines", item: "cantonese" },
  },
) {
  const calls: unknown[][] = [];
  const reveal: RevealRepository = {
    view: (userId, id) =>
      Promise.resolve(
        userId === ME && id === REL
          ? {
              status: "open",
              faceDown: [{ category: "self.interests", remaining: 2 }],
              seen: [],
              refusal: null,
            }
          : null,
      ),
    flip: (...args) => {
      calls.push(["flip", ...args.slice(0, 4)]);
      return Promise.resolve(outcome);
    },
    settings: () => Promise.resolve({ excluded: [], included: [] }),
    setSettings: (...args) => {
      calls.push(["settings", ...args.slice(0, 2)]);
      return Promise.resolve();
    },
  };
  running = await testApi(fixedReadiness(READY), "test", {
    repository: NO_INVITATIONS,
    reveal,
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
const url = `/v1/relationships/${REL}/cards`;

describe("card endpoints", () => {
  it("answer 401 without a caller", async () => {
    const { app } = await start();
    expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url, payload: {} })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/me/deck" })).statusCode).toBe(401);
  });

  it("shows face-down categories, and turns over a card of a known category", async () => {
    const { app, calls } = await start();
    expect((await app.inject({ method: "GET", url, headers: as })).json()).toEqual({
      status: "open",
      face_down: [{ category: "self.interests", remaining: 2 }],
      seen: [],
      can_flip: true,
    });
    const bad = await app.inject({
      method: "POST",
      url,
      headers: as,
      payload: { category: "self.home_area" },
    });
    expect(bad.statusCode).toBe(400);
    expect(calls).toEqual([]);
    const flipped = await app.inject({
      method: "POST",
      url,
      headers: as,
      payload: { category: "date.cuisines" },
    });
    expect(flipped.json()).toEqual({ category: "date.cuisines", item: "cantonese" });
    expect(calls[0]).toEqual(["flip", ME, REL, "date.cuisines", NOW]);
  });

  it("tells the daily limit as 429", async () => {
    const { app } = await start({ kind: "refused", refusal: "daily_limit" });
    const response = await app.inject({
      method: "POST",
      url,
      headers: as,
      payload: { category: "date.cuisines" },
    });
    expect(response.statusCode).toBe(429);
  });

  it("updates the caller's own deck, accepting only card categories", async () => {
    const { app, calls } = await start();
    const bad = await app.inject({
      method: "PUT",
      url: "/v1/me/deck",
      headers: as,
      payload: { included: ["self.home_area"] },
    });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({
      method: "PUT",
      url: "/v1/me/deck",
      headers: as,
      payload: { excluded: ["self.lifestyle"], included: ["date.dietary_restrictions"] },
    });
    expect(ok.statusCode).toBe(200);
    expect(calls[0]).toEqual([
      "settings",
      ME,
      { excluded: ["self.lifestyle"], included: ["date.dietary_restrictions"] },
    ]);
  });
});
