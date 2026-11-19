// Sign-in end to end against the real schema, as serendipity_app: the
// @serendipity/auth service over pgAuthRepository, with the fake SMS.
import {
  AUTH_POLICY,
  MIN_SECRET_BYTES,
  createAuthService,
  createFakeSms,
  createHasher,
} from "@serendipity/auth";
import type { AuthService, FakeSms, IssuedTokens } from "@serendipity/auth";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { pgAuthRepository } from "./auth.js";
import { migrate } from "./migrations.js";
import { createLoginRole, createTestDatabase, urlFor } from "./test-db.js";
import type { TestDatabase } from "./test-db.js";

const START = new Date("2026-11-19T04:00:00Z").getTime();
const IP = "203.0.113.7";
const hasher = createHasher("t".repeat(MIN_SECRET_BYTES));

let db: TestDatabase;
let role: Awaited<ReturnType<typeof createLoginRole>>;
let admin: pg.Pool;
let pool: pg.Pool;
let clock = START;
let sms: FakeSms;
let auth: AuthService;
let phones = 0;

/** A fresh mainland number for each test, so their limits never meet. */
const nextPhone = () => {
  phones += 1;
  return `139${String(phones).padStart(8, "0")}`;
};
const e164 = (phone: string) => `+86${phone}`;
const advance = (seconds: number) => {
  clock += seconds * 1000;
};

beforeAll(async () => {
  db = await createTestDatabase();
  await migrate(db.url, "up");
  role = await createLoginRole("serendipity_app");
  admin = new pg.Pool({ connectionString: db.url });
  pool = new pg.Pool({ connectionString: urlFor(db.name, role) });
});

beforeEach(() => {
  sms = createFakeSms();
  auth = createAuthService({
    repository: pgAuthRepository(pool),
    sms,
    hasher,
    clock: () => new Date(clock),
  });
});

afterAll(async () => {
  await pool.end();
  await admin.end();
  await db.drop();
  await role.drop();
});

async function signIn(
  phone: string,
  ip = IP,
): Promise<{ userId: string; tokens: IssuedTokens; created: boolean }> {
  expect(await auth.requestCode(phone, ip)).toMatchObject({ ok: true });
  const result = await auth.signIn(phone, sms.lastCodeFor(e164(phone)) ?? "");
  if (!result.ok) throw new Error(`sign-in refused: ${result.problem}`);
  return result;
}

describe("signing in", () => {
  it("creates the account on the first sign-in and finds it on the next", async () => {
    const phone = nextPhone();
    const first = await signIn(phone);
    expect(first.created).toBe(true);
    expect(await auth.callerFor(first.tokens.accessToken)).toBe(first.userId);
    advance(AUTH_POLICY.resendAfterS + 1);
    const second = await signIn(phone);
    expect(second).toMatchObject({ userId: first.userId, created: false });
  });

  it("keeps no phone number, code or token in the clear, anywhere", async () => {
    advance(10);
    const phone = nextPhone();
    const { tokens } = await signIn(phone);
    const code = sms.lastCodeFor(e164(phone)) ?? "";
    const { rows } = await admin.query<{ dump: string }>(
      `SELECT concat_ws(' ',
         (SELECT string_agg(t::text, ' ') FROM app.auth_challenges t),
         (SELECT string_agg(t::text, ' ') FROM app.auth_sessions t),
         (SELECT string_agg(t::text, ' ') FROM app.auth_phone_accounts t),
         (SELECT string_agg(t::text, ' ') FROM app.audit_events t)) AS dump`,
    );
    const dump = rows[0]?.dump ?? "";
    for (const secret of [phone, IP, code, tokens.accessToken, tokens.refreshToken]) {
      expect(dump).not.toContain(secret);
    }
  });
});

describe("codes", () => {
  it("refuses a wrong code, and locks the code after the last allowed try", async () => {
    const phone = nextPhone();
    await auth.requestCode(phone, IP);
    const right = sms.lastCodeFor(e164(phone)) ?? "";
    const wrong = right === "111111" ? "222222" : "111111";
    for (let i = 1; i < AUTH_POLICY.maxAttempts; i += 1) {
      expect(await auth.signIn(phone, wrong)).toEqual({ ok: false, problem: "invalid_code" });
    }
    expect(await auth.signIn(phone, wrong)).toEqual({ ok: false, problem: "invalid_code" });
    // Locked: even the right code no longer works.
    expect(await auth.signIn(phone, right)).toEqual({ ok: false, problem: "invalid_code" });
    const { rows } = await admin.query<{ status: string }>(
      "SELECT status FROM app.auth_challenges WHERE phone_hash = $1",
      [hasher.hash("phone", e164(phone))],
    );
    expect(rows[0]?.status).toBe("locked");
  });

  it("expires a code after five minutes", async () => {
    const phone = nextPhone();
    await auth.requestCode(phone, IP);
    const code = sms.lastCodeFor(e164(phone)) ?? "";
    advance(AUTH_POLICY.codeTtlS);
    expect(await auth.signIn(phone, code)).toEqual({ ok: false, problem: "invalid_code" });
  });

  it("replaces the earlier code with a new one, and a used code is spent", async () => {
    const phone = nextPhone();
    await auth.requestCode(phone, IP);
    const old = sms.lastCodeFor(e164(phone)) ?? "";
    advance(AUTH_POLICY.resendAfterS);
    await auth.requestCode(phone, IP);
    const current = sms.lastCodeFor(e164(phone)) ?? "";
    if (old !== current) {
      expect(await auth.signIn(phone, old)).toEqual({ ok: false, problem: "invalid_code" });
    }
    expect(await auth.signIn(phone, current)).toMatchObject({ ok: true });
    expect(await auth.signIn(phone, current)).toEqual({ ok: false, problem: "invalid_code" });
  });

  it("waits a minute between codes for a number, and allows five an hour", async () => {
    const phone = nextPhone();
    expect(await auth.requestCode(phone, IP)).toMatchObject({ ok: true });
    advance(10);
    expect(await auth.requestCode(phone, IP)).toEqual({
      ok: false,
      problem: "rate_limited",
      retryAfterS: AUTH_POLICY.resendAfterS - 10,
    });
    for (let i = 1; i < AUTH_POLICY.codesPerPhonePerHour; i += 1) {
      advance(AUTH_POLICY.resendAfterS);
      expect(await auth.requestCode(phone, IP)).toMatchObject({ ok: true });
    }
    advance(AUTH_POLICY.resendAfterS);
    const limited = await auth.requestCode(phone, IP);
    expect(limited).toMatchObject({ ok: false, problem: "rate_limited" });
    expect(sms.sent.filter((m) => m.phone === e164(phone))).toHaveLength(
      AUTH_POLICY.codesPerPhonePerHour,
    );
  });

  it("allows twenty codes an hour from one address", async () => {
    advance(3600);
    const address = "198.51.100.9";
    for (let i = 0; i < AUTH_POLICY.codesPerIpPerHour; i += 1) {
      expect(await auth.requestCode(nextPhone(), address)).toMatchObject({ ok: true });
    }
    expect(await auth.requestCode(nextPhone(), address)).toMatchObject({
      ok: false,
      problem: "rate_limited",
    });
  });

  it("lets only one of two simultaneous requests for a number through", async () => {
    const phone = nextPhone();
    const results = await Promise.all([auth.requestCode(phone, IP), auth.requestCode(phone, IP)]);
    expect(results.map((r) => r.ok).sort()).toEqual([false, true]);
  });
});

describe("sessions", () => {
  it("rotates on refresh: the old pair stops working, the new one works", async () => {
    advance(3600);
    const { userId, tokens } = await signIn(nextPhone());
    const refreshed = await auth.refresh(tokens.refreshToken);
    if (!refreshed.ok) throw new Error("refresh refused");
    expect(await auth.callerFor(tokens.accessToken)).toBeNull();
    expect(await auth.callerFor(refreshed.tokens.accessToken)).toBe(userId);
  });

  it("revokes the whole sign-in when a spent refresh token comes back", async () => {
    const { tokens } = await signIn(nextPhone());
    const refreshed = await auth.refresh(tokens.refreshToken);
    if (!refreshed.ok) throw new Error("refresh refused");
    expect(await auth.refresh(tokens.refreshToken)).toEqual({ ok: false });
    expect(await auth.callerFor(refreshed.tokens.accessToken)).toBeNull();
    expect(await auth.refresh(refreshed.tokens.refreshToken)).toEqual({ ok: false });
  });

  it("expires the access token after an hour", async () => {
    const { tokens } = await signIn(nextPhone());
    advance(AUTH_POLICY.accessTtlS);
    expect(await auth.callerFor(tokens.accessToken)).toBeNull();
  });

  it("ends the session on logout", async () => {
    const { tokens } = await signIn(nextPhone());
    await auth.logout(tokens.accessToken);
    expect(await auth.callerFor(tokens.accessToken)).toBeNull();
    expect(await auth.refresh(tokens.refreshToken)).toEqual({ ok: false });
  });

  it("shuts out a suspended account: no caller, no refresh, no new sign-in", async () => {
    const phone = nextPhone();
    const { userId, tokens } = await signIn(phone);
    await admin.query("UPDATE app.users SET status = 'suspended' WHERE id = $1", [userId]);
    expect(await auth.callerFor(tokens.accessToken)).toBeNull();
    expect(await auth.refresh(tokens.refreshToken)).toEqual({ ok: false });
    advance(AUTH_POLICY.resendAfterS);
    await auth.requestCode(phone, IP);
    expect(await auth.signIn(phone, sms.lastCodeFor(e164(phone)) ?? "")).toEqual({
      ok: false,
      problem: "invalid_code",
    });
  });

  it("audits sign-ins, refusals and refreshes", async () => {
    const { rows } = await admin.query<{ action: string }>(
      "SELECT DISTINCT action FROM app.audit_events WHERE action LIKE 'auth.%' ORDER BY action",
    );
    expect(rows.map((r) => r.action)).toEqual([
      "auth.code.limited",
      "auth.code.requested",
      "auth.logout",
      "auth.refresh",
      "auth.refresh.refused",
      "auth.signin",
      "auth.signin.refused",
    ]);
  });
});
