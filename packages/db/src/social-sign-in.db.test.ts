// Sign in with Apple and Google against the real schema (ADR-0026), as
// serendipity_app: the @serendipity/auth service over pgAuthRepository, with
// ID tokens signed by a key made here.
import { generateKeyPairSync, sign } from "node:crypto";
import type { JsonWebKey } from "node:crypto";

import {
  AUTH_POLICY,
  MIN_SECRET_BYTES,
  createAuthService,
  createFakeSms,
  createHasher,
  sha256Hex,
} from "@serendipity/auth";
import type { AuthService, SocialProvider } from "@serendipity/auth";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { pgAuthRepository } from "./auth.js";
import { migrate } from "./migrations.js";
import { pgPrivacyRepository } from "./privacy.js";
import { createLoginRole, createTestDatabase, urlFor } from "./test-db.js";
import type { TestDatabase } from "./test-db.js";

const START = new Date("2026-11-21T04:00:00Z").getTime();
const hasher = createHasher("t".repeat(MIN_SECRET_BYTES));
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "k1" } as JsonWebKey;
const ISSUER: Record<SocialProvider, string> = {
  apple: "https://appleid.apple.com",
  google: "https://accounts.google.com",
};
const CLIENT: Record<SocialProvider, string> = {
  apple: "com.serendip.app",
  google: "serendip-ios.apps.googleusercontent.com",
};

let db: TestDatabase;
let role: Awaited<ReturnType<typeof createLoginRole>>;
let admin: pg.Pool;
let pool: pg.Pool;
let clock = START;
let auth: AuthService;
let ips = 0;

beforeAll(async () => {
  db = await createTestDatabase();
  await migrate(db.url, "up");
  role = await createLoginRole("serendipity_app");
  admin = new pg.Pool({ connectionString: db.url });
  pool = new pg.Pool({ connectionString: urlFor(db.name, role) });
});

beforeEach(() => {
  const keys = (kid: string) => Promise.resolve(kid === "k1" ? jwk : null);
  auth = createAuthService({
    repository: pgAuthRepository(pool),
    sms: createFakeSms(),
    hasher,
    clock: () => new Date(clock),
    social: {
      audiences: { apple: [CLIENT.apple], google: [CLIENT.google] },
      keys: { apple: keys, google: keys },
    },
  });
});

afterAll(async () => {
  await pool.end();
  await admin.end();
  await db.drop();
  await role.drop();
});

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

function idToken(provider: SocialProvider, sub: string, nonce: string): string {
  const nowS = Math.floor(clock / 1000);
  const head = b64({ alg: "RS256", kid: "k1" });
  const body = b64({
    iss: ISSUER[provider],
    aud: CLIENT[provider],
    sub,
    iat: nowS,
    exp: nowS + 600,
    nonce: provider === "apple" ? sha256Hex(nonce) : nonce,
  });
  const signature = sign("RSA-SHA256", Buffer.from(`${head}.${body}`), pair.privateKey);
  return `${head}.${body}.${signature.toString("base64url")}`;
}

/** A fresh address per call, so nonce limits never meet unless a test wants them to. */
async function nonce(ip = `198.51.100.${String((ips += 1) % 250)}`): Promise<string> {
  const issued = await auth.issueNonce(ip);
  if (!issued.ok) throw new Error("nonce refused");
  return issued.nonce;
}

async function signIn(provider: SocialProvider, sub: string) {
  const given = await nonce();
  return auth.signInWith(provider, idToken(provider, sub, given), given);
}

describe("Sign in with Apple and Google", () => {
  it("creates the account on the first sign-in and finds it on the next", async () => {
    const first = await signIn("apple", "apple-sub-1");
    const second = await signIn("apple", "apple-sub-1");
    expect(first).toMatchObject({ ok: true, created: true });
    expect(second).toMatchObject({ ok: true, created: false });
    if (!first.ok || !second.ok) throw new Error("expected sign-ins");
    expect(second.userId).toBe(first.userId);
    expect(await auth.callerFor(second.tokens.accessToken)).toBe(first.userId);
  });

  it("keeps Apple and Google accounts apart, even with the same subject", async () => {
    const apple = await signIn("apple", "shared-sub");
    const google = await signIn("google", "shared-sub");
    if (!apple.ok || !google.ok) throw new Error("expected sign-ins");
    expect(google.userId).not.toBe(apple.userId);
  });

  it("stores neither the subject nor the nonce in the clear", async () => {
    const given = await nonce();
    await auth.signInWith("google", idToken("google", "google-sub-secret", given), given);
    const dump = await admin.query(
      `SELECT row_to_json(a)::text AS row FROM app.auth_social_accounts a
       UNION ALL SELECT row_to_json(n)::text FROM app.auth_nonces n
       UNION ALL SELECT metadata_redacted::text FROM app.audit_events`,
    );
    const text = dump.rows.map((row: { row: string }) => row.row).join("\n");
    expect(text).not.toContain("google-sub-secret");
    expect(text).not.toContain(given);
  });

  it("spends the nonce: the same token never signs in twice", async () => {
    const given = await nonce();
    const token = idToken("apple", "apple-replay", given);
    expect(await auth.signInWith("apple", token, given)).toMatchObject({ ok: true });
    expect(await auth.signInWith("apple", token, given)).toEqual({
      ok: false,
      problem: "rejected",
    });
  });

  it("refuses an expired nonce", async () => {
    const given = await nonce();
    clock += (AUTH_POLICY.nonceTtlS + 1) * 1000;
    expect(await auth.signInWith("apple", idToken("apple", "late", given), given)).toEqual({
      ok: false,
      problem: "rejected",
    });
  });

  it(`gives one address at most ${String(AUTH_POLICY.noncesPerIpPerHour)} nonces an hour`, async () => {
    const ip = "192.0.2.99";
    for (let n = 0; n < AUTH_POLICY.noncesPerIpPerHour; n += 1) await nonce(ip);
    expect(await auth.issueNonce(ip)).toMatchObject({ ok: false, problem: "rate_limited" });
  });

  it("does not let a suspended person start over after deleting the account", async () => {
    const first = await signIn("apple", "banned-sub");
    if (!first.ok) throw new Error("expected a sign-in");
    await admin.query("UPDATE app.users SET status = 'suspended' WHERE id = $1", [first.userId]);
    expect(await signIn("apple", "banned-sub")).toEqual({ ok: false, problem: "rejected" });
    const privacy = pgPrivacyRepository(pool);
    await privacy.requestDeletion(first.userId);
    expect(await privacy.claimDeletion(first.userId)).toBe(true);
    await privacy.finalizeDeletion(first.userId);
    expect(await signIn("apple", "banned-sub")).toEqual({ ok: false, problem: "rejected" });
  });

  it("lets anyone else who deleted their account start over as a new person", async () => {
    const first = await signIn("google", "leaving-sub");
    if (!first.ok) throw new Error("expected a sign-in");
    const privacy = pgPrivacyRepository(pool);
    await privacy.requestDeletion(first.userId);
    await privacy.claimDeletion(first.userId);
    await privacy.finalizeDeletion(first.userId);
    const again = await signIn("google", "leaving-sub");
    expect(again).toMatchObject({ ok: true, created: true });
    if (!again.ok) throw new Error("expected a sign-in");
    expect(again.userId).not.toBe(first.userId);
  });
});
