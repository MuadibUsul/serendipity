// Starting checks, the biometric consent, and asking vendors to forget
// (ADR-0025), over app.verification_sessions, app.vendor_deletion_requests
// and app.consent_grants, as the application role.
//
// Nothing here holds a selfie, an ID or a face: only which vendor, its
// reference, the level asked for and when. The rules are
// @serendipity/identity's startRefusal and drainVendorDeletions.
import { CONSENT_POLICY_VERSION, FLOWS, SCOPES } from "@serendipity/consent";
import type { Flow } from "@serendipity/consent";
import type { Level, VendorDeletion, VendorDeletionQueue } from "@serendipity/identity";
import { MARKET, startOfLocalDay } from "@serendipity/market";

import { inAuditedTransaction } from "./audit.js";
import type { AuditedTransaction, TransactionPool } from "./audit.js";
import type { Queryable } from "./queryable.js";

/** The flow the biometric consent covers: the selfie and any ID, to the vendor. */
export const BIOMETRIC_FLOW: Flow = (() => {
  const flow = FLOWS.find((candidate) => candidate.scope === "biometric_verification");
  if (flow === undefined) throw new Error("the consent policy has no biometric flow");
  return flow;
})();

export interface VerificationFacts {
  readonly accountOpen: boolean;
  readonly hasBirthDate: boolean;
  readonly biometricConsent: boolean;
  readonly startsToday: number;
}

export type ConsentOutcome = "granted" | "unchanged" | "not_found";
export type WithdrawOutcome =
  | { readonly kind: "withdrawn"; readonly deletionsQueued: number }
  | { readonly kind: "not_held" }
  | { readonly kind: "not_found" };

export interface VerificationRepository {
  /** What `startRefusal` needs, or `null` for no such person. */
  facts(userId: string, now: Date): Promise<VerificationFacts | null>;
  grantConsent(userId: string, context?: { traceId?: string }): Promise<ConsentOutcome>;
  /** Revokes the consent and asks every vendor that checked the person to delete what it holds. */
  withdrawConsent(userId: string, context?: { traceId?: string }): Promise<WithdrawOutcome>;
  recordStart(
    userId: string,
    provider: string,
    providerRef: string,
    level: Level,
    context?: { traceId?: string },
  ): Promise<void>;
}

const OPEN_STATES = ["pending", "active", "paused"];

async function holdsConsent(db: Queryable, userId: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `SELECT 1 FROM app.consent_grants
     WHERE user_id = $1 AND scope = $2 AND purpose = $3 AND recipient_class = $4
       AND revoked_at IS NULL AND version >= $5`,
    [
      userId,
      BIOMETRIC_FLOW.scope,
      BIOMETRIC_FLOW.purpose,
      BIOMETRIC_FLOW.recipient,
      SCOPES.biometric_verification.minimumVersion,
    ],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Queues a deletion request for every reference `userId` has with any
 * vendor: each check started and each verdict received. Returns how many
 * new requests were queued. A reference already queued stays as it is.
 */
export async function queueVendorDeletions(db: Queryable, userId: string): Promise<number> {
  const { rowCount } = await db.query(
    `INSERT INTO app.vendor_deletion_requests (provider, provider_ref)
     SELECT provider, provider_ref FROM app.verification_sessions WHERE user_id = $1
     UNION
     SELECT provider, provider_ref FROM app.identity_attestations WHERE user_id = $1
     ON CONFLICT (provider, provider_ref) DO NOTHING`,
    [userId],
  );
  return rowCount ?? 0;
}

const userAudit = (
  tx: AuditedTransaction,
  action: string,
  userId: string,
  metadata: Record<string, unknown> = {},
) =>
  tx.audit({
    actorType: "user",
    actorId: userId,
    action,
    objectType: "user",
    objectId: userId,
    policyVersion: CONSENT_POLICY_VERSION,
    metadata,
  });

export function pgVerificationRepository(
  pool: TransactionPool & Queryable,
): VerificationRepository {
  return {
    async facts(userId, now) {
      const { rows } = await pool.query<{
        status: string;
        has_birth_date: boolean;
        deletion_requested: boolean;
        starts_today: number;
      }>(
        `SELECT u.status, u.birth_date IS NOT NULL AS has_birth_date,
           EXISTS (SELECT 1 FROM app.account_deletion_requests d WHERE d.user_id = u.id)
             AS deletion_requested,
           (SELECT count(*)::int FROM app.verification_sessions s
            WHERE s.user_id = u.id AND s.started_at >= $2) AS starts_today
         FROM app.users u WHERE u.id = $1`,
        [userId, startOfLocalDay(now, MARKET.timeZone)],
      );
      const row = rows[0];
      if (row === undefined) return null;
      return {
        accountOpen: OPEN_STATES.includes(row.status) && !row.deletion_requested,
        hasBirthDate: row.has_birth_date,
        biometricConsent: await holdsConsent(pool, userId),
        startsToday: row.starts_today,
      };
    },

    grantConsent: (userId, context = {}) =>
      inAuditedTransaction(
        pool,
        async (tx): Promise<ConsentOutcome> => {
          const user = await tx.db.query("SELECT 1 FROM app.users WHERE id = $1 FOR UPDATE", [
            userId,
          ]);
          if ((user.rowCount ?? 0) === 0) {
            await userAudit(tx, "consent.biometric.not_found", userId);
            return "not_found";
          }
          if (await holdsConsent(tx.db, userId)) {
            await userAudit(tx, "consent.biometric.unchanged", userId);
            return "unchanged";
          }
          // An outdated grant (below the scope's minimum version) is replaced.
          await tx.db.query(
            `UPDATE app.consent_grants SET revoked_at = now()
             WHERE user_id = $1 AND scope = $2 AND purpose = $3 AND recipient_class = $4
               AND revoked_at IS NULL`,
            [userId, BIOMETRIC_FLOW.scope, BIOMETRIC_FLOW.purpose, BIOMETRIC_FLOW.recipient],
          );
          await tx.db.query(
            `INSERT INTO app.consent_grants (user_id, scope, purpose, recipient_class, version)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              userId,
              BIOMETRIC_FLOW.scope,
              BIOMETRIC_FLOW.purpose,
              BIOMETRIC_FLOW.recipient,
              SCOPES.biometric_verification.version,
            ],
          );
          await userAudit(tx, "consent.biometric.granted", userId, {
            scope_version: SCOPES.biometric_verification.version,
          });
          return "granted";
        },
        context,
      ),

    withdrawConsent: (userId, context = {}) =>
      inAuditedTransaction(
        pool,
        async (tx): Promise<WithdrawOutcome> => {
          const user = await tx.db.query("SELECT 1 FROM app.users WHERE id = $1 FOR UPDATE", [
            userId,
          ]);
          if ((user.rowCount ?? 0) === 0) {
            await userAudit(tx, "consent.biometric.not_found", userId);
            return { kind: "not_found" };
          }
          const revoked = await tx.db.query(
            `UPDATE app.consent_grants SET revoked_at = now()
             WHERE user_id = $1 AND scope = $2 AND revoked_at IS NULL`,
            [userId, BIOMETRIC_FLOW.scope],
          );
          if ((revoked.rowCount ?? 0) === 0) {
            await userAudit(tx, "consent.biometric.not_held", userId);
            return { kind: "not_held" };
          }
          const deletionsQueued = await queueVendorDeletions(tx.db, userId);
          await userAudit(tx, "consent.biometric.withdrawn", userId, {
            vendor_deletions_queued: deletionsQueued,
          });
          return { kind: "withdrawn", deletionsQueued };
        },
        context,
      ),

    recordStart: (userId, provider, providerRef, level, context = {}) =>
      inAuditedTransaction(
        pool,
        async (tx) => {
          await tx.db.query(
            `INSERT INTO app.verification_sessions (provider, provider_ref, user_id, level)
             VALUES ($1, $2, $3, $4)`,
            [provider, providerRef, userId, level],
          );
          await userAudit(tx, "identity.check.started", userId, { provider, level });
        },
        context,
      ),
  };
}

/** The vendor deletion queue, oldest first. Each attempt is audited; no person is named. */
export function pgVendorDeletionQueue(pool: TransactionPool & Queryable): VendorDeletionQueue {
  const finish = (deletion: VendorDeletion, completed: boolean) =>
    inAuditedTransaction(pool, async (tx) => {
      await tx.db.query(
        `UPDATE app.vendor_deletion_requests
         SET attempts = attempts + 1, last_attempt_at = now(),
             completed_at = CASE WHEN $3 THEN now() ELSE completed_at END
         WHERE provider = $1 AND provider_ref = $2`,
        [deletion.provider, deletion.providerRef, completed],
      );
      await tx.audit({
        actorType: "system",
        actorId: null,
        action: completed ? "identity.vendor_deletion.done" : "identity.vendor_deletion.failed",
        objectType: "vendor_reference",
        objectId: null,
        metadata: { provider: deletion.provider },
      });
    });
  return {
    async pending(limit) {
      const { rows } = await pool.query<{ provider: string; provider_ref: string }>(
        `SELECT provider, provider_ref FROM app.vendor_deletion_requests
         WHERE completed_at IS NULL ORDER BY requested_at, provider_ref LIMIT $1`,
        [limit],
      );
      return rows.map((row) => ({ provider: row.provider, providerRef: row.provider_ref }));
    },
    done: (deletion) => finish(deletion, true),
    failed: (deletion) => finish(deletion, false),
  };
}
