import { describe, expect, it } from "vitest";

import { createHttpAuth } from "./http";

/** A fetch that answers with `status` and `body`, and records what it was asked. */
function fakeFetch(status: number, body: unknown, broken = false) {
  const calls: { url: string; body: unknown }[] = [];
  const impl = (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return Promise.resolve({
      status,
      json: () => (broken ? Promise.reject(new Error("not json")) : Promise.resolve(body)),
    });
  };
  return { impl, calls };
}

describe("createHttpAuth", () => {
  it("asks for a code at the API, trimming a trailing slash", async () => {
    const { impl, calls } = fakeFetch(202, { resend_after_s: 60 });
    expect(await createHttpAuth("http://api.test/", impl).requestCode("13800000000")).toEqual({
      ok: true,
    });
    expect(calls).toEqual([
      { url: "http://api.test/v1/auth/code", body: { phone: "13800000000" } },
    ]);
  });

  it.each([
    [400, { code: "invalid_request" }, "invalid_phone"],
    [429, { code: "rate_limited" }, "rate_limited"],
    [503, { code: "unavailable" }, "unavailable"],
    [500, {}, "unavailable"],
  ])("maps %i on a code request to %s", async (status, body, problem) => {
    const { impl } = fakeFetch(status, body);
    expect(await createHttpAuth("http://api.test", impl).requestCode("1")).toEqual({
      ok: false,
      problem,
    });
  });

  it("signs in and keeps the session's tokens", async () => {
    const { impl, calls } = fakeFetch(200, {
      user_id: "u-1",
      new_account: true,
      access_token: "sa_x",
      refresh_token: "sr_y",
    });
    expect(await createHttpAuth("http://api.test", impl).signIn("13800000000", "000000")).toEqual({
      ok: true,
      session: { userId: "u-1", tokens: { accessToken: "sa_x", refreshToken: "sr_y" } },
    });
    expect(calls[0]?.body).toEqual({ phone: "13800000000", code: "000000" });
  });

  it.each([
    [400, { code: "invalid_code" }, "invalid_code"],
    [400, { code: "invalid_request" }, "invalid_phone"],
    [429, {}, "rate_limited"],
    [200, { user_id: "u-1" }, "unavailable"],
  ])("maps %i %j on sign-in to %s", async (status, body, problem) => {
    const { impl } = fakeFetch(status, body);
    expect(await createHttpAuth("http://api.test", impl).signIn("1", "2")).toEqual({
      ok: false,
      problem,
    });
  });

  it("treats a body that is not JSON as unavailable", async () => {
    const { impl } = fakeFetch(502, null, true);
    expect(await createHttpAuth("http://api.test", impl).requestCode("1")).toEqual({
      ok: false,
      problem: "unavailable",
    });
  });
});
