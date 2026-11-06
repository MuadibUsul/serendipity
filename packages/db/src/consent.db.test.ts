import { createAuthorizer } from "@serendipity/consent";
import type { AccessRequest } from "@serendipity/consent";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { pgAuditSink, pgGrantSource } from "./consent.js";
import { migrate } from "./migrations.js";
import { createLoginRole, createTestDatabase, urlFor } from "./test-db.js";
import type { TestDatabase } from "./test-db.js";

// The authorizer runs as a member of serendipity_app, the role services use,
// so the test also proves that role can read grants and write the audit log.
let db: TestDatabase;
let role: Awaited<ReturnType<typeof createLoginRole>>;
let pool: pg.Pool;
let alice: string;
let bob: string;

beforeAll(async () => {
  db = await createTestDatabase();
  await migrate(db.url, "up");
  role = await createLoginRole("serendipity_app");
  pool = new pg.Pool({ connectionString: urlFor(db.name, role) });
  const users = await pool.query<{ id: string }>(
    `INSERT INTO app.users (status) VALUES ('active'), ('active') RETURNING id`,
  );
  [alice, bob] = users.rows.map((row) => row.id) as [string, string];
});

afterAll(async () => {
  await pool.end();
  await db.drop();
  await role.drop();
});

const authorizer = () =>
  createAuthorizer({ grants: pgGrantSource(pool), audit: pgAuditSink(pool) });

const matchingRequest = (): AccessRequest => ({
  subject: alice,
  resource: "profile_facts",
  purpose: "matching",
  recipient: { kind: "matching_service" },
});

async function auditTrail(subject: string) {
  const { rows } = await pool.query<{ allowed: boolean; reason: string }>(
    `SELECT (metadata_redacted->>'allowed')::boolean AS allowed, metadata_redacted->>'reason' AS reason
     FROM app.audit_events WHERE object_type = 'user' AND object_id = $1 ORDER BY at, id`,
    [subject],
  );
  return rows.map((row) => [row.allowed, row.reason]);
}

describe("consent against the real schema", () => {
  it("denies by default, allows after a grant, denies again after revocation, and audits each call", async () => {
    expect(await authorizer().authorize(matchingRequest())).toMatchObject({
      allowed: false,
      reason: "no_grant",
    });

    const granted = await pool.query<{ id: string }>(
      `INSERT INTO app.consent_grants (user_id, scope, recipient_class, purpose, version)
       VALUES ($1, 'profile_matching', 'matching_service', 'matching', 1) RETURNING id`,
      [alice],
    );
    expect(await authorizer().authorize(matchingRequest())).toMatchObject({
      allowed: true,
      grantId: granted.rows[0]?.id,
    });

    await pool.query(`UPDATE app.consent_grants SET revoked_at = now() WHERE id = $1`, [
      granted.rows[0]?.id,
    ]);
    expect(await authorizer().authorize(matchingRequest())).toMatchObject({
      allowed: false,
      reason: "grant_revoked",
    });

    expect(await auditTrail(alice)).toEqual([
      [false, "no_grant"],
      [true, "grant"],
      [false, "grant_revoked"],
    ]);
  });

  it("never lets Bob's grants open Alice's data to Bob's agent", async () => {
    await pool.query(
      `INSERT INTO app.consent_grants (user_id, scope, recipient_class, purpose, version)
       VALUES ($1, 'counterpart_disclosure', 'counterpart_agent', 'negotiation', 1)`,
      [bob],
    );
    const decision = await authorizer().authorize({
      subject: alice,
      resource: "compatibility_signals",
      purpose: "negotiation",
      recipient: { kind: "counterpart_agent", actingFor: bob },
    });
    expect(decision).toMatchObject({ allowed: false, reason: "no_grant" });
  });
});
