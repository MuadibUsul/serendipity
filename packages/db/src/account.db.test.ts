// Pause and resume against the real schema, as serendipity_app.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { pgAccountRepository } from "./account.js";
import type { AccountRepository } from "./account.js";
import { migrate } from "./migrations.js";
import { pgPrivacyRepository } from "./privacy.js";
import { createLoginRole, createTestDatabase, urlFor } from "./test-db.js";
import type { TestDatabase } from "./test-db.js";

const NOW = new Date("2026-11-19T09:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

let db: TestDatabase;
let role: Awaited<ReturnType<typeof createLoginRole>>;
let admin: pg.Pool;
let pool: pg.Pool;
let accounts: AccountRepository;

beforeAll(async () => {
  db = await createTestDatabase();
  await migrate(db.url, "up");
  role = await createLoginRole("serendipity_app");
  admin = new pg.Pool({ connectionString: db.url });
  pool = new pg.Pool({ connectionString: urlFor(db.name, role) });
  accounts = pgAccountRepository(pool);
});

afterAll(async () => {
  await pool.end();
  await admin.end();
  await db.drop();
  await role.drop();
});

async function person(status = "active"): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    "INSERT INTO app.users (status) VALUES ($1) RETURNING id",
    [status],
  );
  return rows[0]?.id ?? "";
}

/** A person who could be matched: matching consent and a profile approved `daysAgo`. */
async function matchable(daysAgo = 30): Promise<string> {
  const id = await person();
  await admin.query(
    `INSERT INTO app.consent_grants (user_id, scope, recipient_class, purpose, version)
     VALUES ($1, 'profile_matching', 'matching_service', 'matching', 1)`,
    [id],
  );
  await admin.query(
    `INSERT INTO app.profile_versions (user_id, version, approval_state, approved_at, structured_json)
     VALUES ($1, 1, 'approved', $2, '{"schema_version":1,"hard_rules":{"self.city_region":"GZ_CORE"}}')`,
    [id, new Date(NOW.getTime() - daysAgo * DAY)],
  );
  return id;
}

async function row(id: string) {
  const { rows } = await admin.query<{
    status: string;
    paused_reason: string | null;
    paused_at: Date | null;
  }>("SELECT status, paused_reason, paused_at FROM app.users WHERE id = $1", [id]);
  return rows[0];
}

async function actions(id: string): Promise<string[]> {
  const { rows } = await admin.query<{ action: string }>(
    "SELECT action FROM app.audit_events WHERE object_id = $1 AND action LIKE 'account.%' ORDER BY at, id",
    [id],
  );
  return rows.map((r) => r.action);
}

describe("pausing", () => {
  it("pauses an active account for a reason, and a second pause only changes the reason", async () => {
    const id = await matchable();
    expect(await accounts.pause(id, "relationship", NOW)).toEqual({
      kind: "paused",
      reason: "relationship",
    });
    expect(await row(id)).toEqual({
      status: "paused",
      paused_reason: "relationship",
      paused_at: NOW,
    });
    const later = new Date(NOW.getTime() + DAY);
    expect(await accounts.pause(id, "break", later)).toMatchObject({ kind: "paused" });
    expect(await row(id)).toEqual({ status: "paused", paused_reason: "break", paused_at: NOW });
    expect(await actions(id)).toEqual(["account.paused", "account.paused"]);
  });

  it("refuses a suspended account, and one being deleted", async () => {
    const suspended = await person("suspended");
    expect(await accounts.pause(suspended, "break", NOW)).toEqual({
      kind: "refused",
      refusal: "suspended",
    });
    const leaving = await person();
    await pgPrivacyRepository(pool).requestDeletion(leaving);
    expect(await accounts.pause(leaving, "break", NOW)).toEqual({
      kind: "refused",
      refusal: "deletion_requested",
    });
    expect(await row(suspended)).toMatchObject({ status: "suspended", paused_reason: null });
  });

  it("keeps a reason only on a paused account", async () => {
    const id = await person();
    await expect(
      admin.query("UPDATE app.users SET paused_reason = 'break' WHERE id = $1", [id]),
    ).rejects.toMatchObject({ code: "23514" });
  });
});

describe("resuming", () => {
  it("shows the person their key preferences and what is still needed", async () => {
    const id = await matchable();
    await accounts.pause(id, "break", NOW);
    expect(await accounts.resumeStatus(id, NOW)).toEqual({
      status: "paused",
      pausedReason: "break",
      needs: [],
      keyPreferences: { "self.city_region": "GZ_CORE" },
    });
  });

  it("waits for the person's confirmation, then resumes and clears the pause", async () => {
    const id = await matchable();
    await accounts.pause(id, "relationship", NOW);
    expect(await accounts.resume(id, false, NOW)).toEqual({
      kind: "needs",
      needs: ["confirmation"],
    });
    expect((await row(id))?.status).toBe("paused");
    expect(await accounts.resume(id, true, NOW)).toEqual({ kind: "resumed" });
    expect(await row(id)).toEqual({ status: "active", paused_reason: null, paused_at: null });
    expect(await accounts.resume(id, true, NOW)).toEqual({ kind: "not_paused" });
    expect(await actions(id)).toEqual([
      "account.paused",
      "account.resume.refused",
      "account.resumed",
      "account.resume.refused",
    ]);
  });

  it("asks for consent and a profile review first when they lapsed", async () => {
    const id = await matchable(400);
    await accounts.pause(id, "break", NOW);
    await admin.query("UPDATE app.consent_grants SET revoked_at = now() WHERE user_id = $1", [id]);
    expect(await accounts.resume(id, true, NOW)).toEqual({
      kind: "needs",
      needs: ["matching_consent", "profile_review"],
    });
    expect((await row(id))?.status).toBe("paused");
  });

  it("asks for a profile when there is none", async () => {
    const id = await person();
    await accounts.pause(id, "break", NOW);
    expect(await accounts.resumeStatus(id, NOW)).toMatchObject({
      needs: ["matching_consent", "approved_profile"],
      keyPreferences: null,
    });
  });

  it("never resumes an account whose deletion was requested", async () => {
    const id = await matchable();
    await pgPrivacyRepository(pool).requestDeletion(id);
    expect(await accounts.resume(id, true, NOW)).toEqual({
      kind: "needs",
      needs: ["deletion_requested"],
    });
    expect((await row(id))?.status).toBe("paused");
  });

  it("knows nobody it was not given", async () => {
    const nobody = "00000000-0000-4000-8000-000000000000";
    expect(await accounts.resumeStatus(nobody, NOW)).toBeNull();
    expect(await accounts.pause(nobody, "break", NOW)).toEqual({ kind: "not_found" });
  });
});
