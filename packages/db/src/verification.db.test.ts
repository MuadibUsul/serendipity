// Starting checks, the biometric consent and vendor deletion against the real
// schema (ADR-0025), as the application role, with the fake vendor.
import {
  createFakeIdentityProvider,
  createIdentityService,
  drainVendorDeletions,
} from "@serendipity/identity";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { pgAttestationStore } from "./identity.js";
import { migrate } from "./migrations.js";
import { pgPrivacyRepository } from "./privacy.js";
import { createLoginRole, createTestDatabase, urlFor } from "./test-db.js";
import type { TestDatabase } from "./test-db.js";
import { pgVendorDeletionQueue, pgVerificationRepository } from "./verification.js";

const SECRET = "s".repeat(32);

let db: TestDatabase;
let role: Awaited<ReturnType<typeof createLoginRole>>;
let admin: pg.Pool;
let pool: pg.Pool;
let provider: ReturnType<typeof createFakeIdentityProvider>;

beforeAll(async () => {
  db = await createTestDatabase();
  await migrate(db.url, "up");
  role = await createLoginRole("serendipity_app");
  admin = new pg.Pool({ connectionString: db.url });
  pool = new pg.Pool({ connectionString: urlFor(db.name, role) });
  provider = createFakeIdentityProvider({ env: "test", secret: SECRET });
});

afterAll(async () => {
  await pool.end();
  await admin.end();
  await db.drop();
  await role.drop();
});

async function person(birthDate: string | null = "1995-06-15"): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    "INSERT INTO app.users (status, birth_date) VALUES ('active', $1) RETURNING id",
    [birthDate],
  );
  return rows[0]?.id ?? "";
}

/** Starts a check at the fake vendor and records it, as the endpoint does. */
async function startCheck(userId: string, at?: Date): Promise<string> {
  const session = await provider.start(userId, "liveness");
  await pgVerificationRepository(pool).recordStart(userId, "fake", session.providerRef, "liveness");
  if (at !== undefined) {
    await admin.query(
      "UPDATE app.verification_sessions SET started_at = $2 WHERE provider_ref = $1",
      [session.providerRef, at],
    );
  }
  return session.providerRef;
}

const pendingRefs = async () =>
  (
    await admin.query<{ provider_ref: string }>(
      "SELECT provider_ref FROM app.vendor_deletion_requests WHERE completed_at IS NULL ORDER BY provider_ref",
    )
  ).rows.map((row) => row.provider_ref);

describe("the biometric consent", () => {
  it("is recorded under its own scope, once, with an audit row", async () => {
    const repository = pgVerificationRepository(pool);
    const id = await person();
    expect((await repository.facts(id, new Date()))?.biometricConsent).toBe(false);
    expect(await repository.grantConsent(id)).toBe("granted");
    expect(await repository.grantConsent(id)).toBe("unchanged");
    expect((await repository.facts(id, new Date()))?.biometricConsent).toBe(true);
    const { rows } = await admin.query(
      `SELECT scope, purpose, recipient_class FROM app.consent_grants WHERE user_id = $1`,
      [id],
    );
    expect(rows).toEqual([
      {
        scope: "biometric_verification",
        purpose: "identity_verification",
        recipient_class: "identity_provider",
      },
    ]);
    const audit = await admin.query<{ action: string }>(
      "SELECT action FROM app.audit_events WHERE object_id = $1 ORDER BY at, action",
      [id],
    );
    expect(audit.rows.map((row) => row.action)).toEqual([
      "consent.biometric.granted",
      "consent.biometric.unchanged",
    ]);
  });

  it("when withdrawn, asks every vendor that checked the person to delete its copy", async () => {
    const repository = pgVerificationRepository(pool);
    const id = await person();
    await repository.grantConsent(id);
    const first = await startCheck(id);
    const second = await startCheck(id);
    const before = await pendingRefs();
    expect(await repository.withdrawConsent(id)).toEqual({ kind: "withdrawn", deletionsQueued: 2 });
    expect(await repository.withdrawConsent(id)).toEqual({ kind: "not_held" });
    expect((await pendingRefs()).filter((ref) => !before.includes(ref)).sort()).toEqual(
      [first, second].sort(),
    );
    expect((await repository.facts(id, new Date()))?.biometricConsent).toBe(false);
  });
});

describe("facts", () => {
  it("counts the checks started today in Pacific time, not the earlier ones", async () => {
    const repository = pgVerificationRepository(pool);
    const id = await person();
    const now = new Date("2026-11-20T20:00:00Z"); // noon in San Francisco
    await startCheck(id, new Date("2026-11-20T07:59:00Z")); // 11:59 PM the day before
    await startCheck(id, new Date("2026-11-20T08:00:00Z")); // midnight
    await startCheck(id, new Date("2026-11-20T19:00:00Z"));
    expect(await repository.facts(id, now)).toMatchObject({ startsToday: 2, accountOpen: true });
  });

  it("knows whether a date of birth was given, and closes for a deletion request", async () => {
    const repository = pgVerificationRepository(pool);
    const id = await person(null);
    expect(await repository.facts(id, new Date())).toMatchObject({ hasBirthDate: false });
    await pgPrivacyRepository(pool).requestDeletion(id);
    expect(await repository.facts(id, new Date())).toMatchObject({ accountOpen: false });
    expect(await repository.facts("00000000-0000-4000-8000-000000000000", new Date())).toBeNull();
  });
});

describe("account deletion", () => {
  it("queues a vendor deletion for every check and verdict, and forgets the date of birth", async () => {
    const id = await person();
    const started = await startCheck(id);
    const identity = createIdentityService({ provider, store: pgAttestationStore(pool) });
    const callback = provider.complete(started, new Date());
    await identity.handleCallback(callback.headers, callback.body);

    const privacy = pgPrivacyRepository(pool);
    // Before deletion, the person's export shows what we hold: the date of
    // birth, each check started and each verdict, never any media.
    const exported = await privacy.exportForUser(id);
    expect(exported?.account.birthDate).toBe("1995-06-15");
    expect(exported?.verificationChecks).toEqual([
      expect.objectContaining({ provider: "fake", level: "liveness" }),
    ]);
    expect(exported?.identity).toEqual([
      expect.objectContaining({ provider: "fake", level: "liveness", faceMatch: null }),
    ]);

    await privacy.requestDeletion(id);
    expect(await privacy.claimDeletion(id)).toBe(true);
    await privacy.finalizeDeletion(id);

    expect(await pendingRefs()).toContain(started);
    const left = await admin.query(
      `SELECT (SELECT birth_date FROM app.users WHERE id = $1) AS birth_date,
         (SELECT count(*)::int FROM app.verification_sessions WHERE user_id = $1) AS sessions,
         (SELECT count(*)::int FROM app.identity_attestations WHERE user_id = $1) AS verdicts`,
      [id],
    );
    expect(left.rows[0]).toEqual({ birth_date: null, sessions: 0, verdicts: 0 });
  });

  it("does not keep a verdict that arrives after the account is gone", async () => {
    const id = await person();
    const started = await startCheck(id);
    const privacy = pgPrivacyRepository(pool);
    await privacy.requestDeletion(id);
    await privacy.claimDeletion(id);
    await privacy.finalizeDeletion(id);
    await admin.query(
      "UPDATE app.vendor_deletion_requests SET completed_at = now() WHERE provider_ref = $1",
      [started],
    );

    const identity = createIdentityService({ provider, store: pgAttestationStore(pool) });
    const late = provider.complete(started, new Date());
    expect(await identity.handleCallback(late.headers, late.body)).toBe("unchanged");
    const verdicts = await admin.query(
      "SELECT 1 FROM app.identity_attestations WHERE user_id = $1",
      [id],
    );
    expect(verdicts.rowCount).toBe(0);
  });
});

describe("the vendor deletion queue", () => {
  it("closes a request only once the vendor accepted it, and keeps retrying otherwise", async () => {
    const id = await person();
    const ref = await startCheck(id);
    const repository = pgVerificationRepository(pool);
    await repository.grantConsent(id);
    await repository.withdrawConsent(id);
    const queue = pgVendorDeletionQueue(pool);

    const down = { name: "fake", deleteData: () => Promise.reject(new Error("timeout")) };
    await drainVendorDeletions(queue, [down]);
    expect(await pendingRefs()).toContain(ref);
    const attempts = await admin.query<{ attempts: number }>(
      "SELECT attempts FROM app.vendor_deletion_requests WHERE provider_ref = $1",
      [ref],
    );
    expect(attempts.rows[0]?.attempts).toBeGreaterThanOrEqual(1);

    await drainVendorDeletions(queue, [provider]);
    expect(await pendingRefs()).not.toContain(ref);
    expect(provider.wasDeleted(ref)).toBe(true);
    const next = await queue.pending(1000);
    expect(next.map((deletion) => deletion.providerRef)).not.toContain(ref);
  });
});
