// Profile versions and facts in app.profile_versions / app.profile_facts
// (ARCH-001 §5; ADR-009: profiles are user-approved and versioned). Drafts
// are edited freely; approval checks @serendipity/profile's rules, is
// audited, and supersedes the previous approved version in the same
// transaction. Approved versions are never edited: a change starts a new
// draft from them.
import { isFactKey, missingRequired, snapshotOf } from "@serendipity/profile";
import type { Certainty, Fact, FactKey, Facts, Provenance, Visibility } from "@serendipity/profile";
import type { FactValue } from "@serendipity/profile";
import type pg from "pg";

import { inAuditedTransaction } from "./audit.js";
import type { ActorType, TransactionPool } from "./audit.js";
import type { Queryable } from "./queryable.js";

export type VersionState = "draft" | "approved" | "superseded" | "withdrawn";

export interface ProfileVersion {
  readonly id: string;
  readonly userId: string;
  readonly version: number;
  readonly state: VersionState;
  readonly approvedAt: Date | null;
  readonly facts: Facts;
}

export interface Actor {
  readonly type: ActorType;
  readonly id: string | null;
}

/** Approval refused: the listed required facts are missing or not confirmed. */
export class ProfileNotApprovable extends Error {
  override readonly name = "ProfileNotApprovable";
  constructor(readonly missing: readonly FactKey[]) {
    super(`profile not approvable; unconfirmed required facts: ${missing.join(", ")}`);
  }
}

/** The version is not a draft (or does not exist), so it cannot be changed. */
export class ProfileVersionLocked extends Error {
  override readonly name = "ProfileVersionLocked";
}

interface VersionRow {
  id: string;
  user_id: string;
  version: number;
  approval_state: VersionState;
  approved_at: Date | null;
}

interface FactRow {
  key: string;
  value: FactValue;
  provenance: Provenance;
  certainty: Certainty;
  visibility_scope: Visibility;
  updated_at: Date;
}

async function factsOf(db: Queryable, versionId: string): Promise<Facts> {
  const { rows } = await db.query<FactRow>(
    `SELECT key, value, provenance, certainty, visibility_scope, updated_at
     FROM app.profile_facts WHERE profile_version_id = $1`,
    [versionId],
  );
  const facts = new Map<FactKey, Fact>();
  for (const row of rows) {
    // A key a newer catalog dropped is not part of this build's profile.
    if (!isFactKey(row.key)) continue;
    facts.set(row.key, {
      key: row.key,
      value: row.value,
      provenance: row.provenance,
      certainty: row.certainty,
      visibility: row.visibility_scope,
      updatedAt: row.updated_at,
    });
  }
  return facts;
}

async function load(
  db: Queryable,
  row: VersionRow | undefined,
): Promise<ProfileVersion | undefined> {
  if (row === undefined) return undefined;
  return {
    id: row.id,
    userId: row.user_id,
    version: row.version,
    state: row.approval_state,
    approvedAt: row.approved_at,
    facts: await factsOf(db, row.id),
  };
}

const VERSION_COLUMNS = "id, user_id, version, approval_state, approved_at";

async function versionIn(db: Queryable, userId: string, state: VersionState) {
  const { rows } = await db.query<VersionRow>(
    `SELECT ${VERSION_COLUMNS} FROM app.profile_versions
     WHERE user_id = $1 AND approval_state = $2 ORDER BY version DESC LIMIT 1`,
    [userId, state],
  );
  return load(db, rows[0]);
}

async function writeFacts(db: Queryable, versionId: string, facts: Facts): Promise<void> {
  await db.query(`DELETE FROM app.profile_facts WHERE profile_version_id = $1`, [versionId]);
  for (const fact of facts.values()) {
    await db.query(
      `INSERT INTO app.profile_facts
         (profile_version_id, key, value, provenance, certainty, visibility_scope, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        versionId,
        fact.key,
        JSON.stringify(fact.value),
        fact.provenance,
        fact.certainty,
        fact.visibility,
        fact.updatedAt,
      ],
    );
  }
}

export interface ProfileRepository {
  /** The version matching uses, if the person has approved one. */
  approved(userId: string): Promise<ProfileVersion | undefined>;
  /** The draft being edited, if any. */
  draft(userId: string): Promise<ProfileVersion | undefined>;
  /** The open draft, or a new one starting from the approved version's facts. */
  openDraft(userId: string): Promise<ProfileVersion>;
  /** Replaces a draft's facts. Refused for anything but a draft. */
  saveDraft(versionId: string, facts: Facts): Promise<void>;
  /**
   * Approves a draft whose required facts are all confirmed: it becomes the
   * one approved version, the previous one is superseded, its hard rules are
   * snapshotted for matching, and the approval is audited.
   */
  approve(versionId: string, actor: Actor, context?: { traceId?: string }): Promise<ProfileVersion>;
  /** The person withdraws their profile from matching (audited). */
  withdraw(userId: string, actor: Actor, context?: { traceId?: string }): Promise<boolean>;
}

/** A versioned profile store over `pool`; writes that matter run in audited transactions. */
export function pgProfileRepository(pool: TransactionPool & Queryable): ProfileRepository {
  async function inTransaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async function lockDraft(db: Queryable, versionId: string): Promise<VersionRow> {
    const { rows } = await db.query<VersionRow>(
      `SELECT ${VERSION_COLUMNS} FROM app.profile_versions WHERE id = $1 FOR UPDATE`,
      [versionId],
    );
    const row = rows[0];
    if (row?.approval_state !== "draft") {
      throw new ProfileVersionLocked(`profile version ${versionId} is not an open draft`);
    }
    return row;
  }

  return {
    approved: (userId) => versionIn(pool, userId, "approved"),
    draft: (userId) => versionIn(pool, userId, "draft"),

    openDraft: (userId) =>
      inTransaction(async (client) => {
        // One draft at a time: serialise on the person's row.
        await client.query(`SELECT id FROM app.users WHERE id = $1 FOR UPDATE`, [userId]);
        const existing = await versionIn(client, userId, "draft");
        if (existing !== undefined) return existing;
        const base = await versionIn(client, userId, "approved");
        const { rows } = await client.query<VersionRow>(
          `INSERT INTO app.profile_versions (user_id, version, approval_state)
           SELECT $1, COALESCE(MAX(version), 0) + 1, 'draft' FROM app.profile_versions WHERE user_id = $1
           RETURNING ${VERSION_COLUMNS}`,
          [userId],
        );
        const row = rows[0];
        if (row === undefined) throw new Error("profile: the draft insert returned no row");
        if (base !== undefined) await writeFacts(client, row.id, base.facts);
        const draft = await load(client, row);
        if (draft === undefined) throw new Error("profile: the new draft vanished");
        return draft;
      }),

    saveDraft: (versionId, facts) =>
      inTransaction(async (client) => {
        await lockDraft(client, versionId);
        await writeFacts(client, versionId, facts);
      }),

    approve: (versionId, actor, context = {}) =>
      inAuditedTransaction(
        pool,
        async (tx) => {
          const row = await lockDraft(tx.db, versionId);
          const facts = await factsOf(tx.db, versionId);
          const missing = missingRequired(facts);
          if (missing.length > 0) throw new ProfileNotApprovable(missing);
          const snapshot = snapshotOf(facts);
          await tx.db.query(
            `UPDATE app.profile_versions SET approval_state = 'superseded'
             WHERE user_id = $1 AND approval_state = 'approved'`,
            [row.user_id],
          );
          const { rows } = await tx.db.query<VersionRow>(
            `UPDATE app.profile_versions
             SET approval_state = 'approved', approved_at = now(), structured_json = $2
             WHERE id = $1 RETURNING ${VERSION_COLUMNS}`,
            [versionId, JSON.stringify(snapshot)],
          );
          await tx.audit({
            actorType: actor.type,
            actorId: actor.id,
            action: "profile.version.approved",
            objectType: "user",
            objectId: row.user_id,
            metadata: {
              version: row.version,
              schema_version: snapshot.schema_version,
              hard_rule_keys: Object.keys(snapshot.hard_rules),
            },
          });
          const approved = await load(tx.db, rows[0]);
          if (approved === undefined) throw new Error("profile: the approved version vanished");
          return approved;
        },
        context,
      ),

    withdraw: (userId, actor, context = {}) =>
      inAuditedTransaction(
        pool,
        async (tx) => {
          const { rows } = await tx.db.query<{ version: number }>(
            `UPDATE app.profile_versions SET approval_state = 'withdrawn'
             WHERE user_id = $1 AND approval_state = 'approved' RETURNING version`,
            [userId],
          );
          await tx.audit({
            actorType: actor.type,
            actorId: actor.id,
            action: "profile.version.withdrawn",
            objectType: "user",
            objectId: userId,
            metadata: { version: rows[0]?.version ?? null },
          });
          return rows.length > 0;
        },
        context,
      ),
  };
}
