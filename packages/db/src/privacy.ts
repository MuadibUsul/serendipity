import { PrivacyError } from "@serendipity/privacy";
import type { DeletionReceipt, PersonalExport, PrivacyRepository } from "@serendipity/privacy";
import type pg from "pg";

interface ReceiptRow {
  id: string;
  status: DeletionReceipt["status"];
  requested_at: Date;
  completed_at: Date | null;
  attempts: number;
  failure_stage: DeletionReceipt["failureStage"];
  retained_summary: Record<string, number>;
}

const RECEIPT_COLUMNS =
  "id, status, requested_at, completed_at, attempts, failure_stage, retained_summary";

function receipt(row: ReceiptRow): DeletionReceipt {
  return {
    id: row.id,
    status: row.status,
    requestedAt: row.requested_at,
    completedAt: row.completed_at,
    attempts: row.attempts,
    failureStage: row.failure_stage,
    retainedSummary: row.retained_summary,
  };
}

async function transaction<T>(
  pool: pg.Pool,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const value = await fn(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function status(
  db: pg.Pool | pg.PoolClient,
  userId: string,
): Promise<DeletionReceipt | null> {
  const { rows } = await db.query<ReceiptRow>(
    `SELECT ${RECEIPT_COLUMNS} FROM app.account_deletion_requests WHERE user_id = $1`,
    [userId],
  );
  return rows[0] === undefined ? null : receipt(rows[0]);
}

/** Every export query is scoped to the person. Pairs and negotiations are excluded. */
export function pgPrivacyRepository(pool: pg.Pool): PrivacyRepository {
  return {
    async exportForUser(userId) {
      return transaction(pool, async (db): Promise<PersonalExport | null> => {
        await db.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
        const { rows: accounts } = await db.query<{
          id: string;
          status: string;
          created_at: Date;
        }>(`SELECT id, status, created_at FROM app.users WHERE id = $1`, [userId]);
        const account = accounts[0];
        if (account === undefined || account.status === "deleted") return null;
        const rows = async (sql: string) => (await db.query<pg.QueryResultRow>(sql, [userId])).rows;
        return {
          schemaVersion: 1,
          account: { id: account.id, status: account.status, createdAt: account.created_at },
          identity: await rows(`SELECT provider, age_verified AS "ageVerified",
            real_person_verified AS "realPersonVerified", verified_at AS "verifiedAt",
            expires_at AS "expiresAt" FROM app.identity_attestations WHERE user_id = $1 ORDER BY created_at`),
          consent: await rows(`SELECT scope, purpose, recipient_class AS "recipientClass", version,
            granted_at AS "grantedAt", revoked_at AS "revokedAt"
            FROM app.consent_grants WHERE user_id = $1 ORDER BY granted_at`),
          profiles: await rows(`SELECT version, approval_state AS "approvalState",
            structured_json AS "structured", created_at AS "createdAt", approved_at AS "approvedAt"
            FROM app.profile_versions WHERE user_id = $1 ORDER BY version`),
          profileFacts: await rows(`SELECT pv.version AS "profileVersion", pf.key, pf.value,
            pf.provenance, pf.certainty, pf.visibility_scope AS "visibilityScope"
            FROM app.profile_facts pf JOIN app.profile_versions pv ON pv.id = pf.profile_version_id
            WHERE pv.user_id = $1 ORDER BY pv.version, pf.key`),
          matchPolicies: await rows(`SELECT version, active, region, hard_rules AS "hardRules",
            soft_weights AS "softWeights", schedule_json AS "schedule", budget_minor AS "budgetMinor",
            auto_authority AS "autoAuthority" FROM app.match_policies WHERE user_id = $1 ORDER BY version`),
          photos: await rows(`SELECT id, purpose, status, created_at AS "createdAt",
            retention_until AS "retentionUntil" FROM app.media_assets WHERE owner_user_id = $1
            ORDER BY created_at`),
          visualFeatures: await rows(`SELECT asset_id AS "assetId", role, preference,
            hair_length AS "hairLength", hair_confidence AS "hairConfidence",
            clothing_style AS "clothingStyle", clothing_confidence AS "clothingConfidence",
            photo_style AS "photoStyle", photo_confidence AS "photoConfidence"
            FROM app.visual_feature_snapshots WHERE owner_user_id = $1 ORDER BY created_at`),
          invitations: await rows(`SELECT id, date_id AS "dateId", status,
            responded_at AS "respondedAt", expires_at AS "expiresAt"
            FROM app.date_invites WHERE user_id = $1 ORDER BY created_at`),
          feedback: await rows(`SELECT date_id AS "dateId", mutual_interest AS "mutualInterest",
            comfort_rating AS "comfortRating", safety_flag AS "safetyFlag"
            FROM app.post_date_feedback WHERE user_id = $1 ORDER BY created_at`),
          auditHistory: await rows(`SELECT action, at FROM app.audit_events
            WHERE (actor_type = 'user' AND actor_id = $1)
              OR (object_type = 'user' AND object_id = $1) ORDER BY at`),
          transactionRecords: {
            dates: await rows(`SELECT id, status, start_at AS "startAt", end_at AS "endAt",
              created_at AS "createdAt" FROM app.dates WHERE user_a = $1 OR user_b = $1
              ORDER BY created_at`),
            checkins: await rows(`SELECT date_id AS "dateId", method,
              verified_at AS "verifiedAt", venue_attested AS "venueAttested"
              FROM app.checkins WHERE user_id = $1 ORDER BY verified_at`),
            paymentOrders:
              await rows(`SELECT id, date_id AS "dateId", amount_minor AS "amountMinor",
              currency, state, paid_at AS "paidAt", created_at AS "createdAt"
              FROM app.payment_orders WHERE user_id = $1 ORDER BY created_at`),
            refunds: await rows(`SELECT r.id, r.payment_order_id AS "paymentOrderId",
              r.amount_minor AS "amountMinor", r.state, r.created_at AS "createdAt"
              FROM app.refunds r JOIN app.payment_orders p ON p.id = r.payment_order_id
              WHERE p.user_id = $1 ORDER BY r.created_at`),
          },
        };
      });
    },
    requestDeletion(userId) {
      return transaction(pool, async (db) => {
        const { rows: users } = await db.query<{ status: string }>(
          `SELECT status FROM app.users WHERE id = $1 FOR UPDATE`,
          [userId],
        );
        if (users[0] === undefined) throw new PrivacyError("not_found");
        const inserted = await db.query<{ id: string }>(
          `INSERT INTO app.account_deletion_requests (user_id, status)
           VALUES ($1, 'requested') ON CONFLICT (user_id) DO NOTHING RETURNING id`,
          [userId],
        );
        if (inserted.rowCount === 1) {
          await db.query(
            `UPDATE app.users SET status = 'paused', updated_at = now()
             WHERE id = $1 AND status IN ('pending', 'active', 'paused')`,
            [userId],
          );
          await db.query(
            `UPDATE app.consent_grants SET revoked_at = GREATEST(now(), granted_at)
             WHERE user_id = $1 AND revoked_at IS NULL`,
            [userId],
          );
          await db.query(`UPDATE app.match_policies SET active = false WHERE user_id = $1`, [
            userId,
          ]);
          await db.query(
            `INSERT INTO app.audit_events (actor_type, actor_id, action, object_type, object_id)
             VALUES ('user', $1, 'account_deletion_requested', 'user', $1)`,
            [userId],
          );
        }
        const current = await status(db, userId);
        if (current === null) throw new PrivacyError("not_found");
        return current;
      });
    },
    deletionStatus(userId) {
      return status(pool, userId);
    },
    async claimDeletion(userId) {
      return transaction(pool, async (db) => {
        const result = await db.query(
          `UPDATE app.account_deletion_requests SET status = 'purging', started_at = now(),
             attempts = attempts + 1, failure_stage = NULL, updated_at = now()
           WHERE user_id = $1 AND (status IN ('requested', 'failed')
             OR (status = 'purging' AND started_at < now() - interval '5 minutes'))
             AND NOT EXISTS (SELECT 1 FROM app.media_assets m
               WHERE m.owner_user_id = $1 AND m.status = 'pending'
                 AND m.created_at > now() - interval '60 seconds')`,
          [userId],
        );
        if (result.rowCount !== 1) return false;
        await db.query(
          `INSERT INTO app.audit_events (actor_type, action, object_type, object_id)
           VALUES ('system', 'account_deletion_processing', 'user', $1)`,
          [userId],
        );
        return true;
      });
    },
    async pendingDeletionUserIds(limit) {
      const { rows } = await pool.query<{ user_id: string }>(
        `SELECT user_id FROM app.account_deletion_requests
         WHERE status = 'requested'
            OR (status = 'failed' AND updated_at < now() - interval '1 minute')
            OR (status = 'purging' AND started_at < now() - interval '5 minutes')
         ORDER BY requested_at LIMIT $1`,
        [limit],
      );
      return rows.map((row) => row.user_id);
    },
    async photoIdsForDeletion(userId) {
      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM app.media_assets WHERE owner_user_id = $1 AND status <> 'deleted' ORDER BY id`,
        [userId],
      );
      return rows.map((row) => row.id);
    },
    finalizeDeletion: (userId) => finalizeDeletion(pool, userId),
    failDeletion: (userId, stage) => failDeletion(pool, userId, stage),
  };
}

async function finalizeDeletion(pool: pg.Pool, userId: string): Promise<DeletionReceipt> {
  return transaction(pool, async (db) => {
    const current = await db.query<{ status: string }>(
      `SELECT status FROM app.account_deletion_requests WHERE user_id = $1 FOR UPDATE`,
      [userId],
    );
    if (current.rows[0]?.status === "completed") {
      const complete = await status(db, userId);
      if (complete === null) throw new PrivacyError("not_found");
      return complete;
    }
    if (current.rows[0]?.status !== "purging") throw new PrivacyError("not_found");
    const remaining = await db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM app.media_assets
       WHERE owner_user_id = $1 AND status <> 'deleted'`,
      [userId],
    );
    if ((remaining.rows[0]?.count ?? 0) !== 0) throw new PrivacyError("deletion_failed");

    await db.query(
      `DELETE FROM app.visual_feature_snapshots v USING app.media_assets m
       WHERE v.asset_id = m.id AND m.owner_user_id = $1`,
      [userId],
    );
    await db.query(
      `DELETE FROM app.media_derivatives d USING app.media_assets m
       WHERE d.asset_id = m.id AND m.owner_user_id = $1`,
      [userId],
    );
    await db.query(`DELETE FROM app.media_assets WHERE owner_user_id = $1`, [userId]);
    await db.query(
      `DELETE FROM app.notification_outbox WHERE recipient_user_id = $1
        OR (aggregate_type = 'user' AND aggregate_id = $1)
        OR (aggregate_type = 'candidate_pair' AND aggregate_id IN
          (SELECT id FROM app.candidate_pairs WHERE user_a = $1 OR user_b = $1))`,
      [userId],
    );
    await db.query(`DELETE FROM app.relationships WHERE user_a = $1 OR user_b = $1`, [userId]);
    await db.query(`DELETE FROM app.date_invites WHERE user_id = $1`, [userId]);
    await db.query(`DELETE FROM app.post_date_feedback WHERE user_id = $1`, [userId]);
    await db.query(
      `UPDATE app.dates SET candidate_pair_id = NULL
       WHERE candidate_pair_id IN (SELECT id FROM app.candidate_pairs
         WHERE user_a = $1 OR user_b = $1)`,
      [userId],
    );
    await db.query(
      `DELETE FROM app.negotiations WHERE candidate_pair_id IN
       (SELECT id FROM app.candidate_pairs WHERE user_a = $1 OR user_b = $1)`,
      [userId],
    );
    await db.query(`DELETE FROM app.candidate_pairs WHERE user_a = $1 OR user_b = $1`, [userId]);
    await db.query(
      `DELETE FROM app.profile_facts WHERE profile_version_id IN
       (SELECT id FROM app.profile_versions WHERE user_id = $1)`,
      [userId],
    );
    await db.query(`DELETE FROM app.profile_versions WHERE user_id = $1`, [userId]);
    await db.query(`DELETE FROM app.match_policies WHERE user_id = $1`, [userId]);
    await db.query(`DELETE FROM app.identity_attestations WHERE user_id = $1`, [userId]);
    await db.query(`DELETE FROM app.consent_grants WHERE user_id = $1`, [userId]);
    await db.query(
      `UPDATE app.users SET status = 'deleted', deleted_at = now(), updated_at = now()
       WHERE id = $1`,
      [userId],
    );
    await db.query(
      `INSERT INTO app.audit_events (actor_type, action, object_type, object_id)
       VALUES ('system', 'account_deletion_completed', 'user', $1)`,
      [userId],
    );
    const summary = await db.query<Record<string, number>>(
      `SELECT
        (SELECT count(*)::int FROM app.dates WHERE user_a = $1 OR user_b = $1) AS dates,
        (SELECT count(*)::int FROM app.checkins WHERE user_id = $1) AS checkins,
        (SELECT count(*)::int FROM app.payment_orders WHERE user_id = $1) AS "paymentOrders",
        (SELECT count(*)::int FROM app.refunds r JOIN app.payment_orders p
          ON p.id = r.payment_order_id WHERE p.user_id = $1) AS refunds,
        (SELECT count(*)::int FROM app.audit_events
          WHERE actor_id = $1 OR (object_type = 'user' AND object_id = $1)) AS "auditEvents"`,
      [userId],
    );
    await db.query(
      `UPDATE app.account_deletion_requests SET status = 'completed',
         completed_at = now(), updated_at = now(), retained_summary = $2::jsonb
       WHERE user_id = $1`,
      [userId, JSON.stringify(summary.rows[0] ?? {})],
    );
    const complete = await status(db, userId);
    if (complete === null) throw new PrivacyError("not_found");
    return complete;
  });
}

async function failDeletion(
  pool: pg.Pool,
  userId: string,
  stage: "media" | "database",
): Promise<void> {
  await transaction(pool, async (db) => {
    const result = await db.query(
      `UPDATE app.account_deletion_requests SET status = 'failed',
         failure_stage = $2, updated_at = now() WHERE user_id = $1 AND status = 'purging'`,
      [userId, stage],
    );
    if (result.rowCount === 1) {
      await db.query(
        `INSERT INTO app.audit_events (actor_type, action, object_type, object_id,
          metadata_redacted) VALUES ('system', 'account_deletion_failed', 'user', $1,
          jsonb_build_object('stage', $2::text))`,
        [userId, stage],
      );
    }
  });
}
