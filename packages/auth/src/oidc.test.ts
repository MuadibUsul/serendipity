// Checking Apple's and Google's ID tokens against keys made here: the same
// RS256 JWTs and JWKS the providers publish, signed locally.
import { generateKeyPairSync, sign } from "node:crypto";
import type { JsonWebKey } from "node:crypto";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { PROVIDER_ENDPOINTS, publishedKeys, sha256Hex, verifyIdToken } from "./oidc.js";

const NOW = new Date("2026-11-20T18:00:00Z");
const NOW_S = Math.floor(NOW.getTime() / 1000);
const NONCE = `sn_${"n".repeat(43)}`;
const BUNDLE = "com.serendip.app";

const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
const JWK = { ...pair.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

function token(
  claims: Record<string, unknown> = {},
  header: Record<string, unknown> = {},
  key = pair.privateKey,
): string {
  const head = b64({ alg: "RS256", kid: "k1", ...header });
  const body = b64({
    iss: "https://appleid.apple.com",
    aud: BUNDLE,
    sub: "001234.abcdef",
    iat: NOW_S - 10,
    exp: NOW_S + 600,
    nonce: sha256Hex(NONCE),
    email: "someone@privaterelay.appleid.com",
    ...claims,
  });
  const signature = sign("RSA-SHA256", Buffer.from(`${head}.${body}`), key).toString("base64url");
  return `${head}.${body}.${signature}`;
}

const keys = (kid: string) => Promise.resolve(kid === "k1" ? (JWK as JsonWebKey) : null);

const check = (jwt: string, nonce = NONCE) =>
  verifyIdToken(jwt, {
    endpoints: PROVIDER_ENDPOINTS.apple,
    audiences: [BUNDLE],
    keys,
    now: NOW,
    nonce,
  });

describe("verifyIdToken", () => {
  it("accepts a current token from Apple for our app, and gives only the subject", async () => {
    expect(await check(token())).toEqual({ ok: true, subject: "001234.abcdef" });
  });

  it("accepts the nonce raw (Google) or as its SHA-256 hex (Apple)", async () => {
    expect(await check(token({ nonce: NONCE }))).toMatchObject({ ok: true });
    expect(await check(token({ nonce: sha256Hex(NONCE) }))).toMatchObject({ ok: true });
  });

  it.each([
    ["another key", token({}, {}, other.privateKey), "bad_signature"],
    ["an unknown kid", token({}, { kid: "k9" }), "unknown_key"],
    ["alg none", token({}, { alg: "none" }), "unsupported_algorithm"],
    ["alg HS256", token({}, { alg: "HS256" }), "unsupported_algorithm"],
    ["another issuer", token({ iss: "https://evil.example" }), "wrong_issuer"],
    ["another app", token({ aud: "com.other.app" }), "wrong_audience"],
    ["an expired token", token({ exp: NOW_S - 61 }), "expired"],
    ["a token from the future", token({ iat: NOW_S + 61 }), "not_yet_valid"],
    ["another nonce", token({ nonce: sha256Hex("sn_other") }), "nonce_mismatch"],
    ["no nonce", token({ nonce: undefined }), "nonce_mismatch"],
    ["no subject", token({ sub: "" }), "no_subject"],
    ["garbage", "not.a.jwt!", "malformed"],
  ])("refuses %s", async (_, jwt, refusal) => {
    expect(await check(jwt)).toEqual({ ok: false, refusal });
  });

  it("accepts an audience list that names our app", async () => {
    expect(await check(token({ aud: ["other", BUNDLE] }))).toMatchObject({ ok: true });
  });

  it("refuses a valid token whose claims were changed after signing", async () => {
    const [head, , signature] = token().split(".");
    const forged = `${head ?? ""}.${b64({ iss: "https://appleid.apple.com", aud: BUNDLE, sub: "victim", iat: NOW_S, exp: NOW_S + 600, nonce: sha256Hex(NONCE) })}.${signature ?? ""}`;
    expect(await check(forged)).toEqual({ ok: false, refusal: "bad_signature" });
  });

  it("never accepts an empty nonce", async () => {
    expect(await check(token({ nonce: "" }), "")).toEqual({
      ok: false,
      refusal: "nonce_mismatch",
    });
  });

  it("accepts nothing but what it signed: any string is refused or yields a subject", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 200 }), async (raw) => {
        expect((await check(raw)).ok).toBe(false);
      }),
    );
  });
});

describe("publishedKeys", () => {
  function server() {
    let calls = 0;
    let body: unknown = { keys: [JWK] };
    return {
      fetch: () => {
        calls += 1;
        return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
      },
      calls: () => calls,
      rotate: (next: unknown) => {
        body = next;
      },
    };
  }

  it("fetches once and serves from the cache", async () => {
    const remote = server();
    let clock = 0;
    const lookup = publishedKeys("https://keys", { fetch: remote.fetch, now: () => clock });
    expect(await lookup("k1")).toMatchObject({ kid: "k1" });
    clock += 1000;
    expect(await lookup("k1")).toMatchObject({ kid: "k1" });
    expect(remote.calls()).toBe(1);
  });

  it("refetches for a new kid after a rotation, at most once a minute", async () => {
    const remote = server();
    let clock = 0;
    const lookup = publishedKeys("https://keys", { fetch: remote.fetch, now: () => clock });
    await lookup("k1");
    remote.rotate({ keys: [{ ...JWK, kid: "k2" }] });
    clock += 1000;
    expect(await lookup("k2")).toBeNull();
    expect(await lookup("made-up")).toBeNull();
    expect(remote.calls()).toBe(1);
    clock += 61_000;
    expect(await lookup("k2")).toMatchObject({ kid: "k2" });
    expect(remote.calls()).toBe(2);
  });

  it("keeps the keys it had when the provider cannot be reached", async () => {
    const remote = server();
    let clock = 0;
    let down = false;
    const lookup = publishedKeys("https://keys", {
      fetch: () => (down ? Promise.reject(new Error("down")) : remote.fetch()),
      now: () => clock,
    });
    await lookup("k1");
    down = true;
    clock += 2 * 60 * 60 * 1000;
    expect(await lookup("k1")).toMatchObject({ kid: "k1" });
  });
});
