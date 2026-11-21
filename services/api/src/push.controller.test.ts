// Registering phones for push over HTTP (ADR-0030), against an in-memory repository.
import type { InvitationRepository, PushDeviceRepository } from "@serendipity/db";
import { afterEach, describe, expect, it } from "vitest";

import { DEV_CALLER_HEADER, devHeaderCallers } from "./callers.js";
import { READY, fixedReadiness, testApi } from "./test-support.js";

const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TOKEN = "ExponentPushToken[abcdefghijklmnop]";
const as = { [DEV_CALLER_HEADER]: ME };

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
  const push: PushDeviceRepository = {
    register: (...args) => {
      calls.push(["register", ...args.slice(0, 3)]);
      return Promise.resolve();
    },
    unregister: (...args) => {
      calls.push(["unregister", ...args.slice(0, 2)]);
      return Promise.resolve(true);
    },
  };
  running = await testApi(fixedReadiness(READY), "test", {
    repository: NO_INVITATIONS,
    push,
    callers: devHeaderCallers("test"),
  });
  return { app: running.app, calls };
}

afterEach(async () => {
  await running?.app.close();
  running = undefined;
});

describe("push device endpoints", () => {
  it("need a signed-in person", async () => {
    const { app, calls } = await start();
    for (const method of ["PUT", "DELETE"] as const) {
      const response = await app.inject({
        method,
        url: "/v1/me/push-device",
        payload: { token: TOKEN, platform: "ios" },
      });
      expect(response.statusCode).toBe(401);
    }
    expect(calls).toEqual([]);
  });

  it("register an Expo token for the caller's phone, and remove it", async () => {
    const { app, calls } = await start();
    const put = await app.inject({
      method: "PUT",
      url: "/v1/me/push-device",
      headers: as,
      payload: { token: TOKEN, platform: "ios" },
    });
    expect(put.statusCode).toBe(204);
    const del = await app.inject({
      method: "DELETE",
      url: "/v1/me/push-device",
      headers: as,
      payload: { token: TOKEN },
    });
    expect(del.statusCode).toBe(204);
    expect(calls).toEqual([
      ["register", ME, TOKEN, "ios"],
      ["unregister", ME, TOKEN],
    ]);
  });

  it("refuse anything that is not an Expo token on a known platform", async () => {
    const { app, calls } = await start();
    for (const payload of [
      { token: "not-a-token", platform: "ios" },
      { token: TOKEN, platform: "windows" },
      { token: TOKEN },
    ]) {
      const response = await app.inject({
        method: "PUT",
        url: "/v1/me/push-device",
        headers: as,
        payload,
      });
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
    }
    expect(calls).toEqual([]);
  });
});
