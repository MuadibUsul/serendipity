// Reports, holds, blocks and appeals (PLAN-001 P05-05, ADR-0022) as the
// application role. The rules are @serendipity/safety's; this module writes
// them under row locks, audited. Audits carry the category and risk, never
// the reporter's details. Staff are identified by a uuid until staff
// accounts exist (an owner decision); their decisions are audited as staff.
import { effectOf, reporterView, riskOf } from "@serendipity/safety";
import type { Category, Decision, ReportState, Risk } from "@serendipity/safety";

import { inAuditedTransaction } from "./audit.js";
import type { AuditedTransaction, TransactionPool } from "./audit.js";
import type { Queryable } from "./queryable.js";

export type ReportOutcome =
  | { readonly kind: "received"; readonly id: string; readonly risk: Risk }
  | { readonly kind: "not_found" };

export interface OwnReport {
  readonly id: string;
  readonly category: Category;
  readonly createdAt: Date;
  readonly status: "received" | "handled";
}

export interface QueuedReport {
  readonly id: string;
  readonly subjectId: string;
  readonly reporterId: string;
  readonly category: Category;
  readonly risk: Risk;
  readonly details: string | null;
  readonly createdAt: Date;
}

export interface SafetyRepository {
  /** A report about the other person of the reporter's date. */
  report(
    reporterId: string,
    dateId: string,
    category: Category,
    details: string | null,
    now: Date,
    context?: { traceId?: string },
  ): Promise<ReportOutcome>;
  ownReports(reporterId: string): Promise<OwnReport[]>;
  /** Open reports, high risk first, oldest first: the staff queue. */
  queue(limit: number): Promise<QueuedReport[]>;
  decide(reportId: string, staffId: string, decision: Decision, now: Date): Promise<boolean>;
  /** An appeal against a suspension, taken by staff from the support channel. */
  recordAppeal(
    reportId: string,
    statement: string,
    staffId: string,
    now: Date,
  ): Promise<string | null>;
  decideAppeal(
    appealId: string,
    staffId: string,
    outcome: "upheld" | "overturned",
    now: Date,
  ): Promise<boolean>;
}

/**
 * Files a report inside an audited transaction: blocks the two from ever
 * being matched again and, for a high-risk report, holds the other person
 * and closes chat between them. Shared with post-date feedback ("I did not
 * feel safe").
 */
export async function fileReport(
  tx: AuditedTransaction,
  report: {
    readonly reporterId: string;
    readonly subjectId: string;
    readonly dateId: string | null;
    readonly category: Category;
    readonly details: string | null;
    readonly now: Date;
  },
): Promise<{ id: string; risk: Risk }> {
  const risk = riskOf(report.category);
  const { rows } = await tx.db.query<{ id: string }>(
    `INSERT INTO app.safety_reports (reporter_id, subject_id, date_id, category, risk, details, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      report.reporterId,
      report.subjectId,
      report.dateId,
      report.category,
      risk,
      report.details,
      report.now,
    ],
  );
  const id = rows[0]?.id ?? "";
  await tx.db.query(
    `INSERT INTO app.user_blocks (blocker_id, blocked_id, created_at) VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING`,
    [report.reporterId, report.subjectId, report.now],
  );
  if (risk === "high") {
    await tx.db.query(
      "UPDATE app.users SET match_hold_at = coalesce(match_hold_at, $2) WHERE id = $1",
      [report.subjectId, report.now],
    );
    await tx.db.query(
      `UPDATE app.relationships SET chat_open = false,
         blocked_at = coalesce(blocked_at, $3), blocked_by = coalesce(blocked_by, $1)
       WHERE (user_a = $1 AND user_b = $2) OR (user_a = $2 AND user_b = $1)`,
      [report.reporterId, report.subjectId, report.now],
    );
  }
  await tx.audit({
    actorType: "user",
    actorId: report.reporterId,
    action: "safety.report.filed",
    objectType: "safety_report",
    objectId: id,
    metadata: { category: report.category, risk },
  });
  return { id, risk };
}

async function staffAudit(
  tx: AuditedTransaction,
  staffId: string,
  action: string,
  objectType: string,
  objectId: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await tx.audit({ actorType: "staff", actorId: staffId, action, objectType, objectId, metadata });
}

/** Releases a person's hold when no open high-risk report about them remains. */
async function releaseHoldIfClear(db: Queryable, subjectId: string): Promise<void> {
  await db.query(
    `UPDATE app.users SET match_hold_at = NULL WHERE id = $1 AND NOT EXISTS (
       SELECT 1 FROM app.safety_reports WHERE subject_id = $1 AND status = 'open' AND risk = 'high')`,
    [subjectId],
  );
}

export function pgSafetyRepository(pool: TransactionPool & Queryable): SafetyRepository {
  return {
    report: (reporterId, dateId, category, details, now, context = {}) =>
      inAuditedTransaction(
        pool,
        async (tx): Promise<ReportOutcome> => {
          const { rows } = await tx.db.query<{ user_a: string; user_b: string }>(
            "SELECT user_a, user_b FROM app.dates WHERE id = $1 AND (user_a = $2 OR user_b = $2)",
            [dateId, reporterId],
          );
          const date = rows[0];
          if (date === undefined) {
            await tx.audit({
              actorType: "user",
              actorId: reporterId,
              action: "safety.report.not_found",
              objectType: "date",
              objectId: dateId,
            });
            return { kind: "not_found" };
          }
          const subjectId = date.user_a === reporterId ? date.user_b : date.user_a;
          const filed = await fileReport(tx, {
            reporterId,
            subjectId,
            dateId,
            category,
            details,
            now,
          });
          return { kind: "received", ...filed };
        },
        context,
      ),

    async ownReports(reporterId) {
      const { rows } = await pool.query<{
        id: string;
        category: Category;
        created_at: Date;
        status: ReportState;
      }>(
        `SELECT id, category, created_at, status FROM app.safety_reports
         WHERE reporter_id = $1 ORDER BY created_at DESC`,
        [reporterId],
      );
      return rows.map((row) => ({
        id: row.id,
        category: row.category,
        createdAt: row.created_at,
        status: reporterView(row.status),
      }));
    },

    async queue(limit) {
      const { rows } = await pool.query<{
        id: string;
        subject_id: string;
        reporter_id: string;
        category: Category;
        risk: Risk;
        details: string | null;
        created_at: Date;
      }>(
        `SELECT id, subject_id, reporter_id, category, risk, details, created_at
         FROM app.safety_reports WHERE status = 'open'
         ORDER BY (risk = 'high') DESC, created_at LIMIT $1`,
        [limit],
      );
      return rows.map((row) => ({
        id: row.id,
        subjectId: row.subject_id,
        reporterId: row.reporter_id,
        category: row.category,
        risk: row.risk,
        details: row.details,
        createdAt: row.created_at,
      }));
    },

    decide: (reportId, staffId, decision, now) =>
      inAuditedTransaction(pool, async (tx) => {
        const { rows } = await tx.db.query<{ subject_id: string; status: ReportState }>(
          "SELECT subject_id, status FROM app.safety_reports WHERE id = $1 FOR UPDATE",
          [reportId],
        );
        const row = rows[0];
        if (row?.status !== "open") {
          await staffAudit(tx, staffId, "safety.report.decide_refused", "safety_report", reportId);
          return false;
        }
        const effect = effectOf(decision);
        await tx.db.query(
          `UPDATE app.safety_reports SET status = $2, decision = $3, decided_by = $4, decided_at = $5
           WHERE id = $1`,
          [reportId, effect.report, decision, staffId, now],
        );
        if (effect.suspend) {
          await tx.db.query(
            `UPDATE app.users SET status = 'suspended', paused_reason = NULL, paused_at = NULL,
               updated_at = $2
             WHERE id = $1 AND status IN ('pending', 'active', 'paused')`,
            [row.subject_id, now],
          );
          await staffAudit(tx, staffId, "account.suspended", "user", row.subject_id, { reportId });
        }
        if (effect.releaseHold) await releaseHoldIfClear(tx.db, row.subject_id);
        await staffAudit(tx, staffId, "safety.report.decided", "safety_report", reportId, {
          decision,
        });
        return true;
      }),

    recordAppeal: (reportId, statement, staffId, now) =>
      inAuditedTransaction(pool, async (tx) => {
        const { rows } = await tx.db.query<{ status: ReportState; decision: string | null }>(
          "SELECT status, decision FROM app.safety_reports WHERE id = $1 FOR UPDATE",
          [reportId],
        );
        const row = rows[0];
        if (row?.status !== "actioned" || row.decision !== "suspend") {
          await staffAudit(tx, staffId, "safety.appeal.refused", "safety_report", reportId);
          return null;
        }
        const inserted = await tx.db.query<{ id: string }>(
          `INSERT INTO app.safety_appeals (report_id, statement, recorded_by, created_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (report_id) WHERE status = 'open' DO NOTHING RETURNING id`,
          [reportId, statement.trim(), staffId, now],
        );
        const id = inserted.rows[0]?.id ?? null;
        await staffAudit(tx, staffId, "safety.appeal.recorded", "safety_report", reportId, {
          duplicate: id === null,
        });
        return id;
      }),

    decideAppeal: (appealId, staffId, outcome, now) =>
      inAuditedTransaction(pool, async (tx) => {
        const { rows } = await tx.db.query<{ report_id: string; subject_id: string }>(
          `SELECT a.report_id, r.subject_id FROM app.safety_appeals a
           JOIN app.safety_reports r ON r.id = a.report_id
           WHERE a.id = $1 AND a.status = 'open' FOR UPDATE OF a, r`,
          [appealId],
        );
        const row = rows[0];
        if (row === undefined) {
          await staffAudit(tx, staffId, "safety.appeal.decide_refused", "safety_appeal", appealId);
          return false;
        }
        await tx.db.query(
          "UPDATE app.safety_appeals SET status = $2, decided_by = $3, decided_at = $4 WHERE id = $1",
          [appealId, outcome, staffId, now],
        );
        if (outcome === "overturned") {
          await tx.db.query("UPDATE app.safety_reports SET status = 'overturned' WHERE id = $1", [
            row.report_id,
          ]);
          // Restored only if no other suspension stands against them.
          await tx.db.query(
            `UPDATE app.users SET status = 'active', updated_at = $2
             WHERE id = $1 AND status = 'suspended' AND NOT EXISTS (
               SELECT 1 FROM app.safety_reports
               WHERE subject_id = $1 AND status = 'actioned' AND decision = 'suspend')`,
            [row.subject_id, now],
          );
          await releaseHoldIfClear(tx.db, row.subject_id);
        }
        await staffAudit(tx, staffId, "safety.appeal.decided", "safety_appeal", appealId, {
          outcome,
        });
        return true;
      }),
  };
}
