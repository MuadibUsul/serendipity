// Identity attestations against the real schema, as serendipity_app:
// idempotent on (provider, provider_ref), later verdicts replace earlier
// ones, every callback audited, nothing but the verdict stored; and the
// identity service end to end, failing closed when the database is down.
import {
  FAKE_PROVIDER,
  createFakeIdentityProvider,
  createIdentityService,
} from "@serendipity/identity";
import type { Attestation } from "@serendipity/identity";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { pgAttestationStore } from "./identity.js";
import { migrate } from "./migrations.js";
import { createLoginRole, createTestDatabase, urlFor } from "./test-db.js";
import type { TestDatabase } from "./test-db.js";

const NOW = new Date("2026-11-11T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

let db: TestDatabase;
let role: Awaited<ReturnType<typeof createLoginRole>>;
let pool: pg.Pool;

beforeAll(async () => {
  db = await createTestDatabase();
  await migrate(db.url, "up");
  role = await createLoginRole("serendipity_app");
  pool = new pg.Pool({ connectionString: urlFor(db.name, role) });
});

afterAll(async () => {
  await pool.end();
  await db.drop();
  await role.drop();
});

async function newUser(): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO app.users (status) VALUES ('active') RETURNING id`,
  );
  return rows[0]?.id ?? "";
}

const verdict = (overrides: Partial<Attestation> = {}): Attestation => ({
  provider: "vendor",
  providerRef: "ref_000000001",
  ageVerified: true,
  realPersonVerified: true,
  verifiedAt: new Date(NOW.getTime() - DAY),
  expiresAt: new Date(NOW.getTime() + 300 * DAY),
  ...overrides,
});

async function auditActions(userId: string): Promise<string[]> {
  const { rows } = await pool.query<{ action: string }>(
    `SELECT action FROM app.audit_events WHERE object_id = $1 ORDER BY at, id`,
    [userId],
  );
  return rows.map((row) => row.action);
}

describe("pgAttestationStore", () => {
  it("records a verdict once, audits every attempt, and stores nothing but the verdict", async () => {
    const user = await newUser();
    const store = pgAttestationStore(pool);
    const ref = `ref_${user.slice(0, 8)}a`;
    expect(await store.record(user, verdict({ providerRef: ref }), {})).toBe("recorded");
    expect(await store.record(user, verdict({ providerRef: ref }), {})).toBe("unchanged");
    expect(await store.attestationsFor(user)).toEqual([verdict({ providerRef: ref })]);
    expect(await auditActions(user)).toEqual([
      "identity.attestation.recorded",
      "identity.attestation.unchanged",
    ]);
    const { rows } = await pool.query<Record<string, unknown>>(
      `SELECT * FROM app.identity_attestations WHERE user_id = $1`,
      [user],
    );
    expect(Object.keys(rows[0] ?? {}).sort()).toEqual([
      "age_verified",
      "created_at",
      "expires_at",
      "id",
      "provider",
      "provider_ref",
      "real_person_verified",
      "user_id",
      "verified_at",
    ]);
  });

  it("lets a later verdict for the same check replace an earlier one, never an older one", async () => {
    const user = await newUser();
    const store = pgAttestationStore(pool);
    const ref = `ref_${user.slice(0, 8)}b`;
    await store.record(user, verdict({ providerRef: ref }), {});
    const revoked = verdict({ providerRef: ref, ageVerified: false, verifiedAt: NOW });
    expect(await store.record(user, revoked, {})).toBe("updated");
    const stale = verdict({ providerRef: ref, verifiedAt: new Date(NOW.getTime() - 2 * DAY) });
    expect(await store.record(user, stale, {})).toBe("unchanged");
    expect(await store.attestationsFor(user)).toEqual([revoked]);
  });

  it("never moves a check to another person", async () => {
    const alice = await newUser();
    const mallory = await newUser();
    const store = pgAttestationStore(pool);
    const ref = `ref_${alice.slice(0, 8)}c`;
    await store.record(alice, verdict({ providerRef: ref }), {});
    expect(await store.record(mallory, verdict({ providerRef: ref, verifiedAt: NOW }), {})).toBe(
      "unchanged",
    );
    expect(await store.attestationsFor(mallory)).toEqual([]);
    expect(await store.attestationsFor(alice)).toHaveLength(1);
  });
});

describe("the identity service against the database", () => {
  it("makes a person eligible from a signed callback, once", async () => {
    const user = await newUser();
    const provider = createFakeIdentityProvider({ env: "test", secret: "s3cret-for-tests" });
    const service = createIdentityService({
      provider,
      store: pgAttestationStore(pool),
      now: () => NOW,
    });
    expect((await service.eligible(user)).eligible).toBe(false);
    const session = await service.startVerification(user);
    const callback = provider.complete(session.providerRef, NOW);
    expect(await service.handleCallback(callback.headers, callback.body)).toBe("recorded");
    expect(await service.handleCallback(callback.headers, callback.body)).toBe("unchanged");
    expect(await service.eligible(user)).toMatchObject({ eligible: true });
    expect((await pgAttestationStore(pool).attestationsFor(user))[0]?.provider).toBe(FAKE_PROVIDER);
  });

  it("answers not eligible when the database cannot be reached", async () => {
    const url = new URL(urlFor(db.name, role));
    url.port = "1";
    const down = new pg.Pool({ connectionString: url.toString(), connectionTimeoutMillis: 1_000 });
    try {
      const provider = createFakeIdentityProvider({ env: "test", secret: "s3cret-for-tests" });
      const service = createIdentityService({ provider, store: pgAttestationStore(down) });
      expect(await service.eligible(await newUser())).toEqual({
        eligible: false,
        reason: "unavailable",
      });
    } finally {
      await down.end();
    }
  });
});
