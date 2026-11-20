// Pausing and resuming matching (PLAN-001 P05-04) over `app.users`, as the
// application role. The rules are @serendipity/identity's pauseRefusal and
// resumeCheck; this module reads the facts they need under a row lock and
// writes the move, audited. The status guard (migration 0013) refuses any
// move ACCOUNT_LIFECYCLE does not declare.
import { SCOPES } from "@serendipity/consent";
import { birthDateRefusal, pauseRefusal, resumeCheck } from "@serendipity/identity";
import type {
  AccountState,
  BirthDateRefusal,
  PauseReason,
  PauseRefusal,
  ResumeNeed,
} from "@serendipity/identity";

import { inAuditedTransaction } from "./audit.js";
import type { AuditedTransaction, TransactionPool } from "./audit.js";
import type { Queryable } from "./queryable.js";

export type PauseOutcome =
  | { readonly kind: "paused"; readonly reason: PauseReason }
  | { readonly kind: "refused"; readonly refusal: PauseRefusal }
  | { readonly kind: "not_found" };

export interface ResumeStatus {
  readonly status: AccountState;
  readonly pausedReason: PauseReason | null;
  /** What resuming still needs, besides the person's confirmation. */
  readonly needs: readonly ResumeNeed[];
  /**
   * The approved profile's hard rules, for the person to look over before
   * confirming. Their own data only; `null` without an approved profile.
   */
  readonly keyPreferences: Readonly<Record<string, unknown>> | null;
}

export type ResumeOutcome =
  | { readonly kind: "resumed" }
  | { readonly kind: "not_paused" }
  | { readonly kind: "needs"; readonly needs: readonly ResumeNeed[] }
  | { readonly kind: "not_found" };

export type BirthDateOutcome =
  | { readonly kind: "recorded" }
  | { readonly kind: "refused"; readonly refusal: BirthDateRefusal | "already_set" }
  | { readonly kind: "not_found" };

export interface AccountRepository {
  /**
   * Records the date of birth given at sign-up (ADR-0024): 18 and over only,
   * once. It is never shown to anyone; a mistake is corrected through support.
   */
  setBirthDate(
    userId: string,
    birthDate: string,
    today: string,
    context?: { traceId?: string },
  ): Promise<BirthDateOutcome>;
  pause(
    userId: string,
    reason: PauseReason,
    now: Date,
    context?: { traceId?: string },
  ): Promise<PauseOutcome>;
  resumeStatus(userId: string, now: Date): Promise<ResumeStatus | null>;
  /** `confirmed`: the person confirmed on the resume screen that matching may start again. */
  resume(
    userId: string,
    confirmed: boolean,
    now: Date,
    context?: { traceId?: string },
  ): Promise<ResumeOutcome>;
}

interface Facts {
  readonly status: AccountState;
  readonly pausedReason: PauseReason | null;
  readonly deletionRequested: boolean;
  readonly matchingConsent: boolean;
  readonly profileApprovedAt: Date | null;
  readonly keyPreferences: Readonly<Record<string, unknown>> | null;
}

async function factsOf(db: Queryable, userId: string, lock: boolean): Promise<Facts | null> {
  const { rows } = await db.query<{ status: AccountState; paused_reason: PauseReason | null }>(
    `SELECT status, paused_reason FROM app.users WHERE id = $1${lock ? " FOR UPDATE" : ""}`,
    [userId],
  );
  const user = rows[0];
  if (user === undefined) return null;
  const deletion = await db.query(
    "SELECT 1 FROM app.account_deletion_requests WHERE user_id = $1",
    [userId],
  );
  const consent = await db.query(
    `SELECT 1 FROM app.consent_grants
     WHERE user_id = $1 AND scope = 'profile_matching' AND purpose = 'matching'
       AND recipient_class = 'matching_service' AND revoked_at IS NULL AND version >= $2`,
    [userId, SCOPES.profile_matching.minimumVersion],
  );
  const profile = await db.query<{ approved_at: Date | null; structured_json: unknown }>(
    `SELECT approved_at, structured_json FROM app.profile_versions
     WHERE user_id = $1 AND approval_state = 'approved'`,
    [userId],
  );
  const approved = profile.rows[0];
  const snapshot = approved?.structured_json as
    { hard_rules?: Record<string, unknown> } | undefined;
  return {
    status: user.status,
    pausedReason: user.paused_reason,
    deletionRequested: (deletion.rowCount ?? 0) > 0,
    matchingConsent: (consent.rowCount ?? 0) > 0,
    profileApprovedAt: approved?.approved_at ?? null,
    keyPreferences: snapshot?.hard_rules ?? null,
  };
}

async function audit(
  tx: AuditedTransaction,
  action: string,
  userId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await tx.audit({
    actorType: "user",
    actorId: userId,
    action,
    objectType: "user",
    objectId: userId,
    metadata,
  });
}

export function pgAccountRepository(pool: TransactionPool & Queryable): AccountRepository {
  return {
    setBirthDate: (userId, birthDate, today, context = {}) =>
      inAuditedTransaction(
        pool,
        async (tx): Promise<BirthDateOutcome> => {
          const { rows } = await tx.db.query<{ set: boolean }>(
            "SELECT birth_date IS NOT NULL AS set FROM app.users WHERE id = $1 FOR UPDATE",
            [userId],
          );
          const row = rows[0];
          if (row === undefined) {
            await audit(tx, "account.birth_date.not_found", userId, {});
            return { kind: "not_found" };
          }
          const refusal = row.set ? "already_set" : birthDateRefusal(birthDate, today);
          if (refusal !== null) {
            // The date itself is never audited.
            await audit(tx, "account.birth_date.refused", userId, { refusal });
            return { kind: "refused", refusal };
          }
          await tx.db.query(
            "UPDATE app.users SET birth_date = $2, updated_at = now() WHERE id = $1",
            [userId, birthDate],
          );
          await audit(tx, "account.birth_date.recorded", userId, {});
          return { kind: "recorded" };
        },
        context,
      ),

    pause: (userId, reason, now, context = {}) =>
      inAuditedTransaction(
        pool,
        async (tx): Promise<PauseOutcome> => {
          const facts = await factsOf(tx.db, userId, true);
          if (facts === null) {
            await audit(tx, "account.pause.not_found", userId, {});
            return { kind: "not_found" };
          }
          const refusal = pauseRefusal(facts.status, facts.deletionRequested);
          if (refusal !== null) {
            await audit(tx, "account.pause.refused", userId, { refusal });
            return { kind: "refused", refusal };
          }
          await tx.db.query(
            `UPDATE app.users SET status = 'paused', paused_reason = $2,
               paused_at = CASE WHEN status = 'paused' THEN coalesce(paused_at, $3) ELSE $3 END,
               updated_at = $3
             WHERE id = $1`,
            [userId, reason, now],
          );
          await audit(tx, "account.paused", userId, { reason, from: facts.status });
          return { kind: "paused", reason };
        },
        context,
      ),

    async resumeStatus(userId, now) {
      const facts = await factsOf(pool, userId, false);
      if (facts === null) return null;
      const check = resumeCheck({ ...facts, confirmed: true }, now);
      return {
        status: facts.status,
        pausedReason: facts.pausedReason,
        needs: check.kind === "needs" ? check.needs : [],
        keyPreferences: facts.keyPreferences,
      };
    },

    resume: (userId, confirmed, now, context = {}) =>
      inAuditedTransaction(
        pool,
        async (tx): Promise<ResumeOutcome> => {
          const facts = await factsOf(tx.db, userId, true);
          if (facts === null) {
            await audit(tx, "account.resume.not_found", userId, {});
            return { kind: "not_found" };
          }
          const check = resumeCheck({ ...facts, confirmed }, now);
          if (check.kind !== "ready") {
            await audit(tx, "account.resume.refused", userId, {
              ...(check.kind === "needs" ? { needs: check.needs } : { status: facts.status }),
            });
            return check;
          }
          await tx.db.query(
            `UPDATE app.users SET status = 'active', paused_reason = NULL, paused_at = NULL,
               updated_at = $2
             WHERE id = $1`,
            [userId, now],
          );
          await audit(tx, "account.resumed", userId, { reason: facts.pausedReason });
          return { kind: "resumed" };
        },
        context,
      ),
  };
}
