import { describe, expect, it } from "vitest";

import { createExpoPushSender, isPushToken } from "./push.js";
import type { PushMessage } from "./push.js";

const message = (token: string): PushMessage => ({
  token,
  title: "Your date is tomorrow",
  body: "7:00 PM at Foreign Cinema.",
  data: { date_id: "d1" },
});

describe("isPushToken", () => {
  it.each([
    ["ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]", true],
    ["ExpoPushToken[abcDEF123_-xyz]", true],
    ["ExponentPushToken[]", false],
    ["apns:abcdef", false],
    ["ExponentPushToken[abc def ghij]", false],
    [42, false],
  ])("%s → %s", (value, ok) => {
    expect(isPushToken(value)).toBe(ok);
  });
});

describe("createExpoPushSender", () => {
  function server(reply: (body: unknown[]) => unknown, ok = true) {
    const calls: { headers: Record<string, string>; body: unknown[] }[] = [];
    return {
      calls,
      fetch: (_url: string, init: { headers: Record<string, string>; body: string }) => {
        const body = JSON.parse(init.body) as unknown[];
        calls.push({ headers: init.headers, body });
        return Promise.resolve({ ok, json: () => Promise.resolve(reply(body)) });
      },
    };
  }

  it("maps Expo's tickets: ok, a device that is gone, anything else", async () => {
    const expo = server(() => ({
      data: [
        { status: "ok", id: "t1" },
        { status: "error", message: "gone", details: { error: "DeviceNotRegistered" } },
        { status: "error", message: "too big", details: { error: "MessageTooBig" } },
      ],
    }));
    const sender = createExpoPushSender({ fetch: expo.fetch });
    expect(await sender.send([message("a"), message("b"), message("c")])).toEqual([
      { status: "sent" },
      { status: "unregistered" },
      { status: "failed" },
    ]);
    expect(expo.calls[0]?.body[0]).toEqual({
      to: "a",
      title: "Your date is tomorrow",
      body: "7:00 PM at Foreign Cinema.",
      data: { date_id: "d1" },
      sound: "default",
    });
  });

  it("sends at most 100 a request", async () => {
    const expo = server((body) => ({ data: body.map(() => ({ status: "ok" })) }));
    const sender = createExpoPushSender({ fetch: expo.fetch });
    const results = await sender.send(Array.from({ length: 250 }, (_, i) => message(String(i))));
    expect(results).toHaveLength(250);
    expect(expo.calls.map((call) => call.body.length)).toEqual([100, 100, 50]);
  });

  it("treats an error, a bad reply or an unreachable service as a failure to retry", async () => {
    for (const fetch of [
      server(() => ({}), false).fetch,
      server(() => ({ data: [] })).fetch,
      () => Promise.reject(new Error("offline")),
    ]) {
      const sender = createExpoPushSender({ fetch });
      expect(await sender.send([message("a")])).toEqual([{ status: "failed" }]);
    }
  });

  it("sends the access token only when there is one", async () => {
    const plain = server(() => ({ data: [{ status: "ok" }] }));
    await createExpoPushSender({ fetch: plain.fetch }).send([message("a")]);
    expect(plain.calls[0]?.headers["authorization"]).toBeUndefined();
    const secured = server(() => ({ data: [{ status: "ok" }] }));
    await createExpoPushSender({ fetch: secured.fetch, accessToken: "k" }).send([message("a")]);
    expect(secured.calls[0]?.headers["authorization"]).toBe("Bearer k");
  });
});
