// Sign in with Apple and Google over HTTP (ADR-0026): the real service over
// an in-memory repository, with ID tokens signed by a key made here.
import { generateKeyPairSync, sign } from "node:crypto";
import type { JsonWebKey } from "node:crypto";

import {
  MIN_SECRET_BYTES,
  createAuthService,
  createFakeSms,
  createHasher,
  sha256Hex,
} from "@serendipity/auth";
import type { AuthRepository } from "@serendipity/auth";
import { afterEach, describe, expect, it } from "vitest";

import { READY, fixedReadiness, testApi } from "./test-support.js";

const NOW = new Date("2026-11-21T18:00:00Z");
const NOW_S = Math.floor(NOW.getTime() / 1000);
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "k1" } as JsonWebKey;
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

function appleToken(nonce: string, claims: Record<string, unknown> = {}): string {
  const head = b64({ alg: "RS256", kid: "k1" });
  const body = b64({
    iss: "https://appleid.apple.com",
    aud: "com.serendip.app",
    sub: "001234.abcdef",
    iat: NOW_S,
    exp: NOW_S + 600,
    nonce: sha256Hex(nonce),
    ...claims,
  });
  const signature = sign("RSA-SHA256", Buffer.from(`${head}.${body}`), pair.privateKey);
  return `${head}.${body}.${signature.toString("base64url")}`;
}

function memoryRepository(): AuthRepository {
  const nonces = new Set<string>();
  const accounts = new Map<string, string>();
  return {
    requestCode: () => Promise.resolve({ ok: true }),
    verify: () => Promise.resolve({ ok: false, refusal: "no_code" }),
    refresh: () => Promise.resolve({ ok: false, refusal: "unknown" }),
    logout: () => Promise.resolve(),
    callerFor: () => Promise.resolve(null),
    issueNonce({ nonceHash }) {
      nonces.add(nonceHash);
      return Promise.resolve({ ok: true });
    },
    socialSignIn({ provider, subjectHash, nonceHash }) {
      if (!nonces.delete(nonceHash)) return Promise.resolve({ ok: false, refusal: "bad_nonce" });
      const key = `${provider}:${subjectHash}`;
      const existing = accounts.get(key);
      const userId =
        existing ?? `00000000-0000-4000-8000-${String(accounts.size + 1).padStart(12, "0")}`;
      accounts.set(key, userId);
      return Promise.resolve({ ok: true, userId, created: existing === undefined });
    },
  };
}

let running: Awaited<ReturnType<typeof testApi>> | undefined;

async function start(withApple = true) {
  const auth = createAuthService({
    repository: memoryRepository(),
    sms: createFakeSms(),
    hasher: createHasher("h".repeat(MIN_SECRET_BYTES)),
    clock: () => NOW,
    social: {
      audiences: withApple ? { apple: ["com.serendip.app"] } : {},
      keys: { apple: (kid) => Promise.resolve(kid === "k1" ? jwk : null) },
    },
  });
  running = await testApi(fixedReadiness(READY), "test", undefined, auth);
  return running.app;
}

afterEach(async () => {
  await running?.app.close();
  running = undefined;
});

async function nonceFrom(app: Awaited<ReturnType<typeof start>>): Promise<string> {
  const response = await app.inject({ method: "POST", url: "/v1/auth/nonce" });
  expect(response.statusCode).toBe(201);
  return response.json<{ nonce: string }>().nonce;
}

describe("Sign in with Apple and Google", () => {
  it("issues a nonce and says which providers are offered", async () => {
    const app = await start();
    const response = await app.inject({ method: "POST", url: "/v1/auth/nonce" });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({ providers: ["apple"] });
  });

  it("signs in and returns a session, creating the account only once", async () => {
    const app = await start();
    const first = await app.inject({
      method: "POST",
      url: "/v1/auth/apple",
      payload: { id_token: appleToken(await nonceFrom(app)), nonce: await nonceFrom(app) },
    });
    // The token carries the first nonce, the request the second: refused.
    expect(first.statusCode).toBe(401);

    const nonce = await nonceFrom(app);
    const ok = await app.inject({
      method: "POST",
      url: "/v1/auth/apple",
      payload: { id_token: appleToken(nonce), nonce },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ new_account: true });
    expect(ok.json<{ access_token: string }>().access_token).toMatch(/^sa_/);

    const again = await nonceFrom(app);
    const second = await app.inject({
      method: "POST",
      url: "/v1/auth/apple",
      payload: { id_token: appleToken(again), nonce: again },
    });
    expect(second.json()).toMatchObject({
      new_account: false,
      user_id: ok.json<{ user_id: string }>().user_id,
    });
  });

  it("answers the same 401 for every token that will not do, and says nothing more", async () => {
    const app = await start();
    const bodies = [];
    for (const claims of [{ aud: "com.other.app" }, { exp: NOW_S - 600 }, { iss: "x" }]) {
      const nonce = await nonceFrom(app);
      const response = await app.inject({
        method: "POST",
        url: "/v1/auth/apple",
        payload: { id_token: appleToken(nonce, claims), nonce },
      });
      expect(response.statusCode).toBe(401);
      bodies.push(response.json<{ detail: string }>().detail);
    }
    expect(new Set(bodies).size).toBe(1);
  });

  it("answers 503 for a provider without client IDs, and 404 for an unknown one", async () => {
    const app = await start();
    const nonce = await nonceFrom(app);
    const google = await app.inject({
      method: "POST",
      url: "/v1/auth/google",
      payload: { id_token: appleToken(nonce), nonce },
    });
    expect(google.statusCode).toBe(503);
    const unknown = await app.inject({
      method: "POST",
      url: "/v1/auth/facebook",
      payload: { id_token: "x", nonce },
    });
    expect(unknown.statusCode).toBe(404);
  });

  it("refuses to issue nonces when no provider is configured", async () => {
    const app = await start(false);
    const response = await app.inject({ method: "POST", url: "/v1/auth/nonce" });
    expect(response.statusCode).toBe(503);
  });

  it("still routes refresh and logout, not as providers", async () => {
    const app = await start();
    const refresh = await app.inject({
      method: "POST",
      url: "/v1/auth/refresh",
      payload: { refresh_token: "nope" },
    });
    expect(refresh.statusCode).toBe(401);
    const logout = await app.inject({ method: "POST", url: "/v1/auth/logout" });
    expect(logout.statusCode).toBe(204);
  });
});
