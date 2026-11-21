// The service's own rules, over a recording repository. What the database
// does with a code or a session (limits, tries, rotation) is tested against
// PostgreSQL in @serendipity/db.
import { generateKeyPairSync, sign } from "node:crypto";
import type { JsonWebKey } from "node:crypto";

import { describe, expect, it } from "vitest";

import { sha256Hex } from "./oidc.js";
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
    issueNonce: record("issueNonce", { ok: true }),
    socialSignIn: record("socialSignIn", { ok: true, userId: "u-1", created: true }),
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
    expect(await service.requestCode("415 555 0123", "203.0.113.7")).toEqual({
      ok: true,
      resendAfterS: AUTH_POLICY.resendAfterS,
    });
    expect(sms.sent).toEqual([{ phone: "+14155550123", code: "123456" }]);
    const stored = JSON.stringify(calls);
    for (const secret of ["4155550123", "203.0.113.7", "123456"])
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
    expect(await service.requestCode("4155550123", "203.0.113.7")).toEqual({
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
    const result = await service.signIn("4155550123", "123456");
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
      expect(await service.signIn("4155550123", code)).toEqual({
        ok: false,
        problem: "invalid_code",
      });
    }
    expect(calls).toEqual([]);
    expect(await service.signIn("4155550123", "123456")).toEqual({
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
    const signedIn = await service.signIn("4155550123", "123456");
    if (!signedIn.ok) throw new Error("expected a sign-in");
    const refreshed = await service.refresh(signedIn.tokens.refreshToken);
    if (!refreshed.ok) throw new Error("expected a refresh");
    expect(refreshed.tokens.refreshToken).not.toBe(signedIn.tokens.refreshToken);
  });
});

describe("Sign in with Apple and Google", () => {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "k1" } as JsonWebKey;
  const NOW_S = Math.floor(NOW.getTime() / 1000);
  const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

  function appleToken(nonce: string, sub = "001234.abcdef"): string {
    const head = b64({ alg: "RS256", kid: "k1" });
    const body = b64({
      iss: "https://appleid.apple.com",
      aud: "com.serendip.app",
      sub,
      iat: NOW_S,
      exp: NOW_S + 600,
      nonce: sha256Hex(nonce),
    });
    const signature = sign("RSA-SHA256", Buffer.from(`${head}.${body}`), pair.privateKey);
    return `${head}.${body}.${signature.toString("base64url")}`;
  }

  function socialSetup(overrides: Partial<AuthRepository> = {}) {
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
      issueNonce: record("issueNonce", { ok: true }),
      socialSignIn: record("socialSignIn", { ok: true, userId: "u-2", created: true }),
      ...overrides,
    };
    const service = createAuthService({
      repository,
      sms: createFakeSms(),
      hasher,
      clock: () => NOW,
      social: {
        audiences: { apple: ["com.serendip.app"] },
        keys: { apple: (kid) => Promise.resolve(kid === "k1" ? jwk : null) },
      },
    });
    return { service, calls };
  }

  it("offers only the providers it has client IDs and keys for", () => {
    expect(socialSetup().service.socialProviders).toEqual(["apple"]);
    expect(setup().service.socialProviders).toEqual([]);
  });

  it("signs in with a verified token, storing only hashes of the subject and nonce", async () => {
    const { service, calls } = socialSetup();
    const issued = await service.issueNonce("203.0.113.7");
    if (!issued.ok) throw new Error("expected a nonce");
    expect(issued.expiresAt).toEqual(new Date(NOW.getTime() + AUTH_POLICY.nonceTtlS * 1000));
    const signedIn = await service.signInWith("apple", appleToken(issued.nonce), issued.nonce);
    expect(signedIn).toMatchObject({ ok: true, userId: "u-2", created: true });
    const stored = JSON.stringify(calls);
    for (const secret of [issued.nonce, "001234.abcdef", "203.0.113.7"]) {
      expect(stored).not.toContain(secret);
    }
    expect(calls.map((call) => call.method)).toEqual(["issueNonce", "socialSignIn"]);
  });

  it("keys the account by provider and subject: Google's id is not Apple's", async () => {
    const { service, calls } = socialSetup();
    const nonce = `sn_${"a".repeat(43)}`;
    await service.signInWith("apple", appleToken(nonce, "same-sub"), nonce);
    const appleHash = (calls[0]?.input as { subjectHash: string }).subjectHash;
    expect(appleHash).toBe(hasher.hash("subject", "apple:same-sub"));
    expect(appleHash).not.toBe(hasher.hash("subject", "google:same-sub"));
  });

  it("refuses a provider it is not configured for without looking anything up", async () => {
    const { service, calls } = socialSetup();
    const nonce = `sn_${"a".repeat(43)}`;
    expect(await service.signInWith("google", appleToken(nonce), nonce)).toEqual({
      ok: false,
      problem: "unavailable",
    });
    expect(calls).toEqual([]);
  });

  it("refuses a bad token, or one for another nonce, before storage", async () => {
    const { service, calls } = socialSetup();
    const nonce = `sn_${"a".repeat(43)}`;
    for (const [token, given] of [
      ["x.y.z", nonce],
      [appleToken(`sn_${"b".repeat(43)}`), nonce],
      // Signed for a nonce this server could never have issued.
      [appleToken("not-a-nonce"), "not-a-nonce"],
    ] as const) {
      expect(await service.signInWith("apple", token, given)).toEqual({
        ok: false,
        problem: "rejected",
      });
    }
    expect(calls).toEqual([]);
  });

  it("reads a spent nonce and a closed account alike", async () => {
    const nonce = `sn_${"a".repeat(43)}`;
    for (const refusal of ["bad_nonce", "account_closed"] as const) {
      const { service } = socialSetup({
        socialSignIn: () => Promise.resolve({ ok: false, refusal }),
      });
      expect(await service.signInWith("apple", appleToken(nonce), nonce)).toEqual({
        ok: false,
        problem: "rejected",
      });
    }
  });

  it("rate-limits nonces per address", async () => {
    const { service } = socialSetup({
      issueNonce: () => Promise.resolve({ ok: false, retryAfterS: 120 }),
    });
    expect(await service.issueNonce("203.0.113.7")).toEqual({
      ok: false,
      problem: "rate_limited",
      retryAfterS: 120,
    });
  });
});
