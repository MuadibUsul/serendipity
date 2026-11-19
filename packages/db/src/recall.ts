// Candidate recall over app.recall_entries (ARCH-001 §7.1 steps 0–3, ADR-0012).
//
// An entry is derived from a person's approved profile, confirmed self tags
// and identity verdict, and is rebuilt with refresh() whenever one of those
// changes. recall() puts forward, for one person, the people who could pass
// the bilateral filter with them: a superset of @serendipity/matching
// decidePair, which still decides every pair. What can change from one
// moment to the next is checked live in the query, not trusted from the
// entry: the account being active, the matching consent grant (a revocation
// stops recall on the next query), the entry's profile still being the
// approved one, the identity verdict not having run out, and no held date.
//
// recall() returns user ids only: never profile data, never a reason.
import type { EligibilityPolicy } from "@serendipity/identity";
import { eligibility } from "@serendipity/identity";
import { AVAILABILITY_BITS, recallEntryOf, requiredQuarters } from "@serendipity/matching";
import type { NoEntryReason, RecallContext, RecallEntry } from "@serendipity/matching";

import type pg from "pg";

import { inAuditedTransaction } from "./audit.js";
import type { AuditedTransaction, TransactionPool } from "./audit.js";
import type { Queryable } from "./queryable.js";

/** The vector column's dimension (0008_recall.sql). */
export const EMBEDDING_DIMENSIONS = 1024;

/** Confirmed facts whose tags the other person's dealbreakers are matched against. */
const SELF_TAG_KEYS = ["self.interests", "self.lifestyle", "self.communication_style"];

/** The consent grant every recall needs, from both people (ser-p01-05 catalog). */
const MATCHING_GRANT = `
  EXISTS (SELECT 1 FROM app.consent_grants g
          WHERE g.user_id = %s AND g.scope = 'profile_matching'
            AND g.recipient_class = 'matching_service' AND g.purpose = 'matching'
            AND g.revoked_at IS NULL)`;

/** Checked live for both people on every recall: what an entry cannot vouch for. */
const live = (alias: string) => `
  (${alias}.eligible_until IS NULL OR ${alias}.eligible_until > $2)
  AND EXISTS (SELECT 1 FROM app.users u WHERE u.id = ${alias}.user_id AND u.status = 'active'
              AND u.match_hold_at IS NULL)
  AND EXISTS (SELECT 1 FROM app.profile_versions p
              WHERE p.id = ${alias}.profile_version_id AND p.approval_state = 'approved')
  AND ${MATCHING_GRANT.replace("%s", `${alias}.user_id`)}
  AND NOT EXISTS (SELECT 1 FROM app.date_participants d
                  WHERE d.user_id = ${alias}.user_id AND d.holds_time)`;

/** `x & (x << 1) & … & (x << run-1)` has a bit set iff x has `run` consecutive set bits. */
function runOf(run: number): string {
  return Array.from({ length: run }, (_, shift) =>
    shift === 0 ? "s.x" : `(s.x << ${String(shift)})`,
  ).join(" & ");
}

/**
 * $1 the person, $2 now, $3 the package currency, $4 its price, $5 the limit,
 * $6 the shuffle salt. Both sides pass the same rules in both directions;
 * the person themselves must pass the live checks and afford the package,
 * or nobody is recalled.
 */
function recallSql(run: number): string {
  return `
    WITH me AS (
      SELECT e.* FROM app.recall_entries e
      WHERE e.user_id = $1 AND e.budget_currency = $3 AND e.budget_minor >= $4 AND ${live("e")}
    )
    SELECT c.user_id
    FROM me
    JOIN app.recall_entries c
      ON c.region = me.region AND c.user_id <> me.user_id
     AND c.age BETWEEN me.age_min AND me.age_max
    CROSS JOIN LATERAL (SELECT c.availability & me.availability AS x) s
    WHERE me.age BETWEEN c.age_min AND c.age_max
      AND c.goal = ANY (me.accepts_goals) AND me.goal = ANY (c.accepts_goals)
      AND c.budget_currency = $3 AND c.budget_minor >= $4
      AND NOT (c.dealbreakers && me.self_tags) AND NOT (me.dealbreakers && c.self_tags)
      AND bit_count(${runOf(run)}) > 0
      AND ${live("c")}
      AND NOT EXISTS (SELECT 1 FROM app.user_blocks b
                      WHERE (b.blocker_id = me.user_id AND b.blocked_id = c.user_id)
                         OR (b.blocker_id = c.user_id AND b.blocked_id = me.user_id))
    ORDER BY
      CASE WHEN c.embedding_model = me.embedding_model THEN c.embedding <=> me.embedding END,
      md5($6 || c.user_id::text)
    LIMIT $5`;
}

export interface RecallQuery {
  readonly context: RecallContext;
  readonly now: Date;
  /** At most this many people (ARCH-001 §7.1 step 4 suggests 5–20 pairs a round). */
  readonly limit: number;
  /**
   * Orders people the embedding cannot tell apart (no embedding on either
   * side): the same salt gives the same order, a new one (say, each round)
   * a new shuffle, so the same few are not always first.
   */
  readonly salt: string;
}

export type RefreshOutcome =
  | { readonly stored: true }
  | {
      readonly stored: false;
      readonly reason: NoEntryReason | "no_account" | "account_inactive" | "no_matching_consent";
    };

export type EmbeddingOutcome =
  /** Stored against the entry's profile version. */
  | "stored"
  /** The entry is now built from another profile version (or there is none): embed that one. */
  | "stale";

export class EmbeddingRefused extends Error {
  constructor(reason: string) {
    super(`recall: embedding refused: ${reason}`);
    this.name = "EmbeddingRefused";
  }
}

export interface RecallRepository {
  /**
   * Rebuilds a person's entry from their approved profile, confirmed self
   * tags and identity attestations, or removes it when they cannot be
   * recalled. `age` comes from the caller while its source is an open owner
   * decision (ADR-0009); `null` removes the entry.
   */
  refresh(
    userId: string,
    input: { readonly age: number | null },
    now: Date,
    context?: { readonly traceId?: string },
  ): Promise<RefreshOutcome>;
  /** Removes a person's entry, for instance when they pause or delete their account. */
  remove(userId: string, reason: string, context?: { readonly traceId?: string }): Promise<void>;
  /**
   * Stores the embedding of a profile version's approved summary, made with
   * the configured model. Never of photos, voice or transcripts.
   */
  setEmbedding(
    userId: string,
    profileVersionId: string,
    embedding: readonly number[],
    context?: { readonly traceId?: string },
  ): Promise<EmbeddingOutcome>;
  /** The people who could pass the bilateral filter with this person, as user ids. */
  recall(userId: string, query: RecallQuery): Promise<string[]>;
}

export interface RecallOptions {
  /** Which identity attestations count (the same policy as `identity.eligible`). */
  readonly identity: EligibilityPolicy;
  /** The one embedding model whose vectors are stored; others are refused. */
  readonly embeddingModel: string;
}

interface AttestationRow {
  provider: string;
  provider_ref: string;
  age_verified: boolean;
  real_person_verified: boolean;
  verified_at: Date;
  expires_at: Date | null;
}

function tagsOf(values: readonly unknown[]): string[] {
  const tags = new Set<string>();
  for (const value of values) {
    const items = Array.isArray(value) ? (value as unknown[]) : [value];
    for (const item of items) if (typeof item === "string" && item.length > 0) tags.add(item);
  }
  return [...tags].sort();
}

async function audit(
  tx: AuditedTransaction,
  action: string,
  userId: string,
  metadata: Record<string, unknown> = {},
) {
  await tx.audit({
    actorType: "system",
    actorId: null,
    action,
    objectType: "user",
    objectId: userId,
    metadata,
  });
}

function vectorLiteral(embedding: readonly number[]): string {
  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new EmbeddingRefused(
      `expected ${String(EMBEDDING_DIMENSIONS)} dimensions, got ${String(embedding.length)}`,
    );
  }
  if (!embedding.every((value) => Number.isFinite(value))) {
    throw new EmbeddingRefused("not every component is a finite number");
  }
  if (embedding.every((value) => value === 0)) {
    throw new EmbeddingRefused("a zero vector has no direction");
  }
  return `[${embedding.join(",")}]`;
}

async function storeEntry(db: Queryable, profileVersionId: string, entry: RecallEntry) {
  await db.query(
    `INSERT INTO app.recall_entries
       (user_id, profile_version_id, region, age, age_min, age_max, goal, accepts_goals,
        availability, budget_currency, budget_minor, dealbreakers, self_tags, eligible_until,
        refreshed_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::bit(${String(AVAILABILITY_BITS)}), $10, $11, $12, $13, $14, now())
     ON CONFLICT (user_id) DO UPDATE SET
       -- An embedding belongs to one profile version; a new version needs a new one.
       embedding = CASE WHEN recall_entries.profile_version_id = EXCLUDED.profile_version_id
                        THEN recall_entries.embedding END,
       embedding_model = CASE WHEN recall_entries.profile_version_id = EXCLUDED.profile_version_id
                              THEN recall_entries.embedding_model END,
       profile_version_id = EXCLUDED.profile_version_id, region = EXCLUDED.region,
       age = EXCLUDED.age, age_min = EXCLUDED.age_min, age_max = EXCLUDED.age_max,
       goal = EXCLUDED.goal, accepts_goals = EXCLUDED.accepts_goals,
       availability = EXCLUDED.availability, budget_currency = EXCLUDED.budget_currency,
       budget_minor = EXCLUDED.budget_minor, dealbreakers = EXCLUDED.dealbreakers,
       self_tags = EXCLUDED.self_tags, eligible_until = EXCLUDED.eligible_until,
       refreshed_at = now()`,
    [
      entry.userId,
      profileVersionId,
      entry.region,
      entry.age,
      entry.ageMin,
      entry.ageMax,
      entry.goal,
      entry.acceptsGoals,
      entry.availability,
      entry.budget.currency,
      entry.budget.minor,
      entry.dealbreakers,
      entry.selfTags,
      entry.eligibleUntil,
    ],
  );
}

/** A pool that can also run a named (prepared) statement, as `pg.Pool` can. */
export interface PreparingPool extends TransactionPool, Queryable {
  query<Row extends pg.QueryResultRow>(config: pg.QueryConfig): Promise<pg.QueryResult<Row>>;
  query<Row extends pg.QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<pg.QueryResult<Row>>;
}

export function pgRecallRepository(pool: PreparingPool, options: RecallOptions): RecallRepository {
  async function removeIn(tx: AuditedTransaction, userId: string, reason: string) {
    const { rowCount } = await tx.db.query("DELETE FROM app.recall_entries WHERE user_id = $1", [
      userId,
    ]);
    await audit(tx, "matching.recall.removed", userId, { reason, existed: rowCount === 1 });
  }

  return {
    refresh(userId, input, now, context = {}) {
      return inAuditedTransaction(
        pool,
        async (tx): Promise<RefreshOutcome> => {
          // Lock the person so two refreshes of one entry run one after the other.
          const user = await tx.db.query<{ status: string; consented: boolean }>(
            `SELECT u.status, ${MATCHING_GRANT.replace("%s", "u.id")} AS consented
             FROM app.users u WHERE u.id = $1 FOR UPDATE`,
            [userId],
          );
          const row = user.rows[0];
          const refuse = async (reason: Exclude<RefreshOutcome, { stored: true }>["reason"]) => {
            await removeIn(tx, userId, reason);
            return { stored: false, reason } as const;
          };
          if (row === undefined) return refuse("no_account");
          if (row.status !== "active") return refuse("account_inactive");
          if (!row.consented) return refuse("no_matching_consent");

          const version = await tx.db.query<{ id: string; structured_json: unknown }>(
            `SELECT id, structured_json FROM app.profile_versions
             WHERE user_id = $1 AND approval_state = 'approved'`,
            [userId],
          );
          const approved = version.rows[0];
          const tags =
            approved === undefined
              ? []
              : (
                  await tx.db.query<{ value: unknown }>(
                    `SELECT value FROM app.profile_facts
                     WHERE profile_version_id = $1 AND key = ANY ($2) AND provenance = 'confirmed'`,
                    [approved.id, SELF_TAG_KEYS],
                  )
                ).rows.map((fact) => fact.value);
          const attestations = await tx.db.query<AttestationRow>(
            `SELECT provider, provider_ref, age_verified, real_person_verified, verified_at, expires_at
             FROM app.identity_attestations WHERE user_id = $1`,
            [userId],
          );
          const verdict = eligibility(
            attestations.rows.map((a) => ({
              provider: a.provider,
              providerRef: a.provider_ref,
              ageVerified: a.age_verified,
              realPersonVerified: a.real_person_verified,
              verifiedAt: a.verified_at,
              expiresAt: a.expires_at,
            })),
            now,
            options.identity,
          );
          const result = recallEntryOf({
            userId,
            age: input.age,
            profileSnapshot: approved?.structured_json ?? null,
            confirmedSelfTags: tagsOf(tags),
            identity: verdict.eligible
              ? { eligible: true, until: verdict.until }
              : { eligible: false },
          });
          if (!result.ok || approved === undefined) {
            return refuse(result.ok ? "profile_unusable" : result.reason);
          }
          await storeEntry(tx.db, approved.id, result.entry);
          await audit(tx, "matching.recall.refreshed", userId, { profile_version_id: approved.id });
          return { stored: true };
        },
        context,
      );
    },

    remove(userId, reason, context = {}) {
      return inAuditedTransaction(pool, (tx) => removeIn(tx, userId, reason), context);
    },

    async setEmbedding(userId, profileVersionId, embedding, context = {}) {
      const literal = vectorLiteral(embedding);
      return inAuditedTransaction(
        pool,
        async (tx): Promise<EmbeddingOutcome> => {
          const { rowCount } = await tx.db.query(
            `UPDATE app.recall_entries SET embedding = $3::vector, embedding_model = $4
             WHERE user_id = $1 AND profile_version_id = $2`,
            [userId, profileVersionId, literal, options.embeddingModel],
          );
          const outcome = rowCount === 1 ? "stored" : "stale";
          await audit(tx, "matching.recall.embedding", userId, {
            profile_version_id: profileVersionId,
            model: options.embeddingModel,
            outcome,
          });
          return outcome;
        },
        context,
      );
    },

    async recall(userId, query) {
      const run = requiredQuarters(query.context.dateLengthMinutes);
      const price = query.context.cheapestPackagePerPerson;
      if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 200) {
        throw new RangeError("recall: limit must be a whole number from 1 to 200");
      }
      if (!Number.isInteger(price.minor) || price.minor < 0) {
        throw new RangeError("recall: the package price must be a whole, non-negative amount");
      }
      // Named, so each connection prepares it once instead of planning every call.
      const { rows } = await pool.query<{ user_id: string }>({
        name: `recall-run-${String(run)}`,
        text: recallSql(run),
        values: [userId, query.now, price.currency, price.minor, query.limit, query.salt],
      });
      return rows.map((row) => row.user_id);
    },
  };
}

/** For tests and the benchmark: the recall query for a date length, as run. */
export const recallQueryText = (dateLengthMinutes: number) =>
  recallSql(requiredQuarters(dateLengthMinutes));
