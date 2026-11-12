// Profile versions against the real schema, as serendipity_app: drafts,
// approval only when every required fact is confirmed, one approved version
// per person, approved facts never edited, and audited approval.
import { NO_FACTS, applyProposals, confirmFact } from "@serendipity/profile";
import type { Facts } from "@serendipity/profile";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrate } from "./migrations.js";
import { ProfileNotApprovable, ProfileVersionLocked, pgProfileRepository } from "./profile.js";
import { createLoginRole, createTestDatabase, urlFor } from "./test-db.js";
import type { TestDatabase } from "./test-db.js";

const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const NOW = new Date("2026-11-01T10:00:00Z");

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

const REQUIRED: Record<string, unknown> = {
  "self.city_region": "GZ_CORE",
  "self.relationship_goal": "long_term",
  "self.availability": [{ day: "sat", from: "14:00", to: "18:00" }],
  "seeking.age_range": { min: 25, max: 35 },
  "seeking.relationship_goals": ["long_term"],
  "seeking.max_distance_km": 15,
  "date.budget_per_person": { currency: "CNY", max_minor: 8800 },
};

/** What the extractor heard: every required fact, plus an inferred interest. */
function stated(): Facts {
  return applyProposals(
    NO_FACTS,
    [
      ...Object.entries(REQUIRED).map(([key, value]) => ({
        key,
        value,
        provenance: "explicit",
        certainty: "medium",
      })),
      { key: "self.interests", value: ["music"], provenance: "inferred", certainty: "low" },
    ],
    NOW,
  ).facts;
}

function confirmRequired(facts: Facts): Facts {
  let result = facts;
  for (const key of Object.keys(REQUIRED)) {
    const confirmed = confirmFact(result, key as never, NOW);
    if (!confirmed.ok) throw new Error(confirmed.problem);
    result = confirmed.facts;
  }
  return result;
}

async function newUser(): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO app.users (status) VALUES ('active') RETURNING id`,
  );
  return rows[0]?.id ?? "";
}

async function auditActions(userId: string) {
  const { rows } = await pool.query<{ action: string; trace_id: string | null }>(
    `SELECT action, metadata_redacted->>'trace_id' AS trace_id FROM app.audit_events
     WHERE object_id = $1 ORDER BY at, id`,
    [userId],
  );
  return rows;
}

const profiles = () => pgProfileRepository(pool);

describe("profile drafts", () => {
  it("opens one draft per person, even when asked many times at once", async () => {
    const user = await newUser();
    const drafts = await Promise.all(Array.from({ length: 8 }, () => profiles().openDraft(user)));
    expect(new Set(drafts.map((draft) => draft.id)).size).toBe(1);
    expect(drafts[0]).toMatchObject({ version: 1, state: "draft", approvedAt: null });
    expect(drafts[0]?.facts.size).toBe(0);
  });

  it("waits for a draft another connection is opening, rather than opening a second", async () => {
    const user = await newUser();
    const other = await pool.connect();
    try {
      await other.query("BEGIN");
      await other.query(`SELECT id FROM app.users WHERE id = $1 FOR UPDATE`, [user]);
      const opening = profiles().openDraft(user);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const { rows } = await other.query<{ id: string }>(
        `INSERT INTO app.profile_versions (user_id, version, approval_state)
         VALUES ($1, 1, 'draft') RETURNING id`,
        [user],
      );
      await other.query("COMMIT");
      expect((await opening).id).toBe(rows[0]?.id);
    } finally {
      other.release();
    }
  });

  it("stores facts with their provenance, certainty, visibility and time", async () => {
    const user = await newUser();
    const draft = await profiles().openDraft(user);
    const facts = stated();
    await profiles().saveDraft(draft.id, facts);
    const reloaded = await profiles().draft(user);
    expect(reloaded?.facts).toEqual(facts);
  });
});

describe("approval", () => {
  it("is refused until every required fact is confirmed, and nothing is written", async () => {
    const user = await newUser();
    const draft = await profiles().openDraft(user);
    await profiles().saveDraft(draft.id, stated());
    const refusal = await profiles()
      .approve(draft.id, { type: "user", id: user })
      .catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(ProfileNotApprovable);
    expect((refusal as ProfileNotApprovable).missing).toHaveLength(Object.keys(REQUIRED).length);
    expect((await profiles().draft(user))?.state).toBe("draft");
    expect(await profiles().approved(user)).toBeUndefined();
    expect(await auditActions(user)).toEqual([]);
  });

  it("approves a confirmed draft, snapshots its hard rules, and audits it with the trace", async () => {
    const user = await newUser();
    const draft = await profiles().openDraft(user);
    await profiles().saveDraft(draft.id, confirmRequired(stated()));
    const approved = await profiles().approve(
      draft.id,
      { type: "user", id: user },
      { traceId: TRACE_ID },
    );
    expect(approved).toMatchObject({ id: draft.id, version: 1, state: "approved" });
    expect(approved.approvedAt).toBeInstanceOf(Date);

    const { rows } = await pool.query<{
      structured_json: { schema_version: number; hard_rules: Record<string, unknown> };
    }>(`SELECT structured_json FROM app.profile_versions WHERE id = $1`, [draft.id]);
    const snapshot = rows[0]?.structured_json;
    expect(snapshot?.schema_version).toBe(1);
    expect(Object.keys(snapshot?.hard_rules ?? {}).sort()).toEqual(Object.keys(REQUIRED).sort());
    // The inferred interest is in the profile but never a hard rule.
    expect(snapshot?.hard_rules).not.toHaveProperty("self.interests");
    expect(await auditActions(user)).toEqual([
      { action: "profile.version.approved", trace_id: TRACE_ID },
    ]);
  });

  it("starts the next draft from the approved facts, and approving it supersedes the old version", async () => {
    const user = await newUser();
    const first = await profiles().openDraft(user);
    await profiles().saveDraft(first.id, confirmRequired(stated()));
    await profiles().approve(first.id, { type: "user", id: user });

    const second = await profiles().openDraft(user);
    expect(second.version).toBe(2);
    expect(second.facts).toEqual((await profiles().approved(user))?.facts);
    const moved = confirmFact(second.facts, "seeking.max_distance_km", NOW, 30);
    if (!moved.ok) throw new Error(moved.problem);
    await profiles().saveDraft(second.id, moved.facts);
    expect((await profiles().approved(user))?.facts.get("seeking.max_distance_km")?.value).toBe(15);

    await profiles().approve(second.id, { type: "user", id: user });
    const { rows } = await pool.query<{ version: number; approval_state: string }>(
      `SELECT version, approval_state FROM app.profile_versions WHERE user_id = $1 ORDER BY version`,
      [user],
    );
    expect(rows).toEqual([
      { version: 1, approval_state: "superseded" },
      { version: 2, approval_state: "approved" },
    ]);
    expect((await profiles().approved(user))?.facts.get("seeking.max_distance_km")?.value).toBe(30);
  });

  it("never edits an approved version", async () => {
    const user = await newUser();
    const draft = await profiles().openDraft(user);
    const facts = confirmRequired(stated());
    await profiles().saveDraft(draft.id, facts);
    await profiles().approve(draft.id, { type: "user", id: user });
    await expect(profiles().saveDraft(draft.id, NO_FACTS)).rejects.toBeInstanceOf(
      ProfileVersionLocked,
    );
    await expect(profiles().approve(draft.id, { type: "user", id: user })).rejects.toBeInstanceOf(
      ProfileVersionLocked,
    );
    expect((await profiles().approved(user))?.facts).toEqual(facts);
  });

  it("lets the person withdraw from matching, audited", async () => {
    const user = await newUser();
    const draft = await profiles().openDraft(user);
    await profiles().saveDraft(draft.id, confirmRequired(stated()));
    await profiles().approve(draft.id, { type: "user", id: user });
    expect(await profiles().withdraw(user, { type: "user", id: user })).toBe(true);
    expect(await profiles().approved(user)).toBeUndefined();
    expect((await auditActions(user)).map((row) => row.action)).toEqual([
      "profile.version.approved",
      "profile.version.withdrawn",
    ]);
  });
});
