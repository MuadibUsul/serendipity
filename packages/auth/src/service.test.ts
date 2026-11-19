// The service's own rules, over a recording repository. What the database
// does with a code or a session (limits, tries, rotation) is tested against
// PostgreSQL in @serendipity/db.
import { describe, expect, it } from "vitest";

import { AUTH_POLICY } from "./policy.js";
import { MIN_SECRET_BYTES, createHasher } from "./secrets.js";
import { createAuthService } from "./service.js";
import type { AuthRepository } from "./service.js";
import { createFakeSms } from "./sms.js";

const NOW = new Date("2026-11-19T04:00:00Z");
const hasher = createHasher("s".repeat(MIN_SECRET_BYTES));

function setup(overrides: Partial<AuthRepository> = {}) {
  const calls: { method: string; input: unknown }[] = [];
  const record =
    <T>(method: string, result: T) =>
    (input: unknown) => {
      calls.push({ method, input });
      return Promise.resolve(result);
    };
  const repository: AuthRepository = {
    requestCode: record("requestCode", { ok: true }),
    verify: record("verify", { ok: true, userId: "u-1", created: true }),
    refresh: record("refresh", { ok: true, userId: "u-1" }),
    logout: record("logout", undefined),
    callerFor: record("callerFor", "u-1"),
    ...overrides,
  };
  const sms = createFakeSms();
  const service = createAuthService({
    repository,
    sms,
    hasher,
    clock: () => NOW,
    codes: () => "123456",
  });
  return { service, sms, calls };
}

describe("requestCode", () => {
  it("sends the code to the normalised number and stores only hashes", async () => {
    const { service, sms, calls } = setup();
    expect(await service.requestCode("138 0000 0000", "203.0.113.7")).toEqual({
      ok: true,
      resendAfterS: AUTH_POLICY.resendAfterS,
    });
    expect(sms.sent).toEqual([{ phone: "+8613800000000", code: "123456" }]);
    const stored = JSON.stringify(calls);
    for (const secret of ["13800000000", "203.0.113.7", "123456"])
      expect(stored).not.toContain(secret);
    expect(calls[0]?.input).toMatchObject({
      expiresAt: new Date(NOW.getTime() + AUTH_POLICY.codeTtlS * 1000),
    });
  });

  it("refuses a bad number without touching storage or SMS", async () => {
    const { service, sms, calls } = setup();
    expect(await service.requestCode("12345", "203.0.113.7")).toEqual({
      ok: false,
      problem: "invalid_phone",
    });
    expect(calls).toEqual([]);
    expect(sms.sent).toEqual([]);
  });

  it("sends nothing when a limit is reached", async () => {
    const { service, sms } = setup({
      requestCode: () => Promise.resolve({ ok: false, retryAfterS: 42 }),
    });
    expect(await service.requestCode("13800000000", "203.0.113.7")).toEqual({
      ok: false,
      problem: "rate_limited",
      retryAfterS: 42,
    });
    expect(sms.sent).toEqual([]);
  });
});

describe("signIn", () => {
  it("returns fresh tokens and stores only their hashes", async () => {
    const { service, calls } = setup();
    const result = await service.signIn("13800000000", "123456");
    if (!result.ok) throw new Error("expected a sign-in");
    expect(result).toMatchObject({ userId: "u-1", created: true });
    expect(result.tokens.accessToken).toMatch(/^sa_/);
    expect(result.tokens.refreshToken).toMatch(/^sr_/);
    const stored = JSON.stringify(calls);
    expect(stored).not.toContain(result.tokens.accessToken);
    expect(stored).not.toContain(result.tokens.refreshToken);
    expect(stored).not.toContain("123456");
  });

  it("refuses a malformed code without a lookup, and every refusal the same way", async () => {
    const { service, calls } = setup({
      verify: () => Promise.resolve({ ok: false, refusal: "locked" }),
    });
    for (const code of ["", "12345", "1234567", "12345a"]) {
      expect(await service.signIn("13800000000", code)).toEqual({
        ok: false,
        problem: "invalid_code",
      });
    }
    expect(calls).toEqual([]);
    expect(await service.signIn("13800000000", "123456")).toEqual({
      ok: false,
      problem: "invalid_code",
    });
  });
});

describe("tokens", () => {
  it("never looks up something that is not a token", async () => {
    const { service, calls } = setup();
    expect(await service.callerFor("not-a-token")).toBeNull();
    expect(await service.refresh("sa_wrongkind")).toEqual({ ok: false });
    await service.logout("x");
    expect(calls).toEqual([]);
  });

  it("refreshes into a new pair", async () => {
    const { service } = setup();
    const signedIn = await service.signIn("13800000000", "123456");
    if (!signedIn.ok) throw new Error("expected a sign-in");
    const refreshed = await service.refresh(signedIn.tokens.refreshToken);
    if (!refreshed.ok) throw new Error("expected a refresh");
    expect(refreshed.tokens.refreshToken).not.toBe(signedIn.tokens.refreshToken);
  });
});
