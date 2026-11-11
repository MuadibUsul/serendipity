// The audit writer against the real schema, as serendipity_app (the role
// services use): audited writes commit with their audit rows or not at all,
// rows stay append-only, and stored metadata is redacted.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { inAuditedTransaction, recordAudit } from "./audit.js";
import type { AuditEvent } from "./audit.js";
import { pgAuditSink } from "./consent.js";
import { migrate } from "./migrations.js";
import { createLoginRole, createTestDatabase, urlFor } from "./test-db.js";
import type { TestDatabase } from "./test-db.js";

const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";

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

const suspend = (userId: string): AuditEvent => ({
  actorType: "staff",
  actorId: null,
  action: "safety.user.suspended",
  objectType: "user",
  objectId: userId,
  metadata: { reason: "report", reporter_email: "alice@example.com", note: "called 13800138000" },
});

async function newUser(): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO app.users (status) VALUES ('active') RETURNING id`,
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("no user");
  return id;
}

async function statusOf(userId: string): Promise<string | undefined> {
  const { rows } = await pool.query<{ status: string }>(
    `SELECT status FROM app.users WHERE id = $1`,
    [userId],
  );
  return rows[0]?.status;
}

async function auditRowsFor(userId: string) {
  const { rows } = await pool.query<{ action: string; metadata: Record<string, unknown> }>(
    `SELECT action, metadata_redacted AS metadata FROM app.audit_events
     WHERE object_type = 'user' AND object_id = $1 ORDER BY at, id`,
    [userId],
  );
  return rows;
}

describe("inAuditedTransaction", () => {
  it("commits the write and its audit row together, with the trace id and redacted metadata", async () => {
    const user = await newUser();
    await inAuditedTransaction(
      pool,
      async (tx) => {
        await tx.db.query(`UPDATE app.users SET status = 'suspended' WHERE id = $1`, [user]);
        await tx.audit(suspend(user));
      },
      { traceId: TRACE_ID },
    );
    expect(await statusOf(user)).toBe("suspended");
    expect(await auditRowsFor(user)).toEqual([
      {
        action: "safety.user.suspended",
        metadata: {
          reason: "report",
          reporter_email: "[redacted]",
          note: "[redacted]",
          trace_id: TRACE_ID,
        },
      },
    ]);
  });

  it("stores neither when the work fails after writing and auditing", async () => {
    const user = await newUser();
    await expect(
      inAuditedTransaction(pool, async (tx) => {
        await tx.db.query(`UPDATE app.users SET status = 'suspended' WHERE id = $1`, [user]);
        await tx.audit(suspend(user));
        throw new Error("payment provider timed out");
      }),
    ).rejects.toThrow("payment provider timed out");
    expect(await statusOf(user)).toBe("active");
    expect(await auditRowsFor(user)).toEqual([]);
  });

  it("stores neither when the audit row cannot be written", async () => {
    const user = await newUser();
    await expect(
      inAuditedTransaction(pool, async (tx) => {
        await tx.db.query(`UPDATE app.users SET status = 'suspended' WHERE id = $1`, [user]);
        // A database-level failure inside the audit insert: an actor id that is not a UUID.
        await tx.audit({ ...suspend(user), actorType: "staff", actorId: "not-a-uuid" });
      }),
    ).rejects.toThrow();
    expect(await statusOf(user)).toBe("active");
    expect(await auditRowsFor(user)).toEqual([]);
  });

  it("refuses a transaction that audits nothing, and keeps its write out", async () => {
    const user = await newUser();
    await expect(
      inAuditedTransaction(pool, async (tx) => {
        await tx.db.query(`UPDATE app.users SET status = 'suspended' WHERE id = $1`, [user]);
      }),
    ).rejects.toThrow("recorded no audit event");
    expect(await statusOf(user)).toBe("active");
  });

  it("releases its connection whatever happens", async () => {
    const before = pool.totalCount;
    for (let i = 0; i < 12; i += 1) {
      await inAuditedTransaction(pool, () => Promise.reject(new Error("x"))).catch(() => undefined);
    }
    expect(pool.idleCount).toBe(pool.totalCount);
    expect(pool.totalCount).toBeLessThanOrEqual(Math.max(before, 10));
  });
});

describe("recordAudit", () => {
  it("refuses malformed events before touching the database", async () => {
    const user = await newUser();
    for (const event of [
      { ...suspend(user), action: "Suspended" },
      { ...suspend(user), action: "suspend" },
      { ...suspend(user), objectType: "User Account" },
      { ...suspend(user), traceId: "not-a-trace" },
      { ...suspend(user), actorType: "robot" as AuditEvent["actorType"] },
    ]) {
      await expect(recordAudit(pool, event)).rejects.toThrow(TypeError);
    }
    expect(await auditRowsFor(user)).toEqual([]);
  });

  it("writes rows that no one, the service role included, can change or remove", async () => {
    const user = await newUser();
    const id = await recordAudit(pool, suspend(user));
    await expect(
      pool.query(`UPDATE app.audit_events SET action = 'x.y' WHERE id = $1`, [id]),
    ).rejects.toThrow();
    await expect(pool.query(`DELETE FROM app.audit_events WHERE id = $1`, [id])).rejects.toThrow();
    expect(await auditRowsFor(user)).toHaveLength(1);
  });
});

describe("pgAuditSink", () => {
  it("stores consent decisions with the trace they ran in", async () => {
    const user = await newUser();
    await pgAuditSink(pool, { traceId: () => TRACE_ID }).record({
      actorType: "agent",
      actorId: null,
      action: "consent.authorize",
      objectType: "user",
      objectId: user,
      policyVersion: 1,
      metadata: {
        allowed: false,
        reason: "no_grant",
        resource: "profile_facts",
        purpose: "matching",
        recipientClass: "matching_service",
        scope: null,
        scopeVersion: null,
        grantId: null,
      },
    });
    const [row] = await auditRowsFor(user);
    expect(row?.metadata).toMatchObject({ allowed: false, reason: "no_grant", trace_id: TRACE_ID });
  });
});
