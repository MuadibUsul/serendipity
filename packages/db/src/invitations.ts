// Date invitations in app.dates and app.date_invites (ARCH-001 §5, §8.1).
//
// Anonymity is enforced here, below the API: every query is for one person
// and selects only that person's invitation and what the two share (state,
// time, venue). The other person's id is used in WHERE clauses to find the
// row and to work out which side the person is on, and is never selected,
// so no caller can pass it on by mistake (ADR-006).
//
// Every answer, refusal and expiry is audited in the transaction that makes
// it; the date and the invitations change only through @serendipity/domain.
import { createDate } from "@serendipity/domain";
import type { DateRecord, DateState, Party } from "@serendipity/domain";
import { decideAnswer, expireInvitations, openInvitations } from "@serendipity/invitations";
import type {
  Answer,
  AnswerRefusal,
  InvitationRecord,
  InviteStatus,
} from "@serendipity/invitations";

import { inAuditedTransaction } from "./audit.js";
import type { AuditedTransaction, TransactionPool } from "./audit.js";
import type { Queryable } from "./queryable.js";

/** States after the reveal: no longer an invitation. */
const AFTER_REVEAL: readonly DateState[] = ["REVEALED", "COMPLETED", "POST_DATE_FEEDBACK"];

interface Row {
  date_id: string;
  party: Party;
  status: DateState;
  machine_version: number;
  revision: number;
  machine_context: Partial<DateRecord>;
  start_at: Date | null;
  end_at: Date | null;
  venue_name: string | null;
  venue_address: string | null;
  invite_status: InviteStatus;
  expires_at: Date;
  responded_at: Date | null;
}

/**
 * One person's side: their invitation, which side they are on, and the shared
 * date facts. `$1` is the person. The other person's id appears only in the
 * WHERE clause and the CASE, never in the selected columns.
 */
const SELECT_MINE = `
  SELECT d.id AS date_id,
         CASE WHEN d.user_a = $1 THEN 'A' ELSE 'B' END AS party,
         d.status, d.machine_version, d.revision, d.machine_context,
         d.start_at, d.end_at,
         v.name AS venue_name, v.address AS venue_address,
         i.status AS invite_status, i.expires_at, i.responded_at
  FROM app.date_invites i
  JOIN app.dates d ON d.id = i.date_id AND (d.user_a = $1 OR d.user_b = $1)
  LEFT JOIN app.venues v ON v.id = d.venue_id
  WHERE i.user_id = $1`;

function toDate(
  row: Pick<Row, "status" | "machine_version" | "revision" | "machine_context">,
): DateRecord {
  const defaults = createDate();
  const context = row.machine_context;
  return {
    machineVersion: row.machine_version,
    state: row.status,
    revision: row.revision,
    accepted: context.accepted ?? defaults.accepted,
    paymentsOpened: context.paymentsOpened ?? defaults.paymentsOpened,
    paid: context.paid ?? defaults.paid,
    venueConfirmed: context.venueConfirmed ?? defaults.venueConfirmed,
    checkedIn: context.checkedIn ?? defaults.checkedIn,
    heldFrom: context.heldFrom ?? defaults.heldFrom,
  };
}

function toRecord(row: Row): InvitationRecord {
  return {
    dateId: row.date_id,
    party: row.party,
    date: toDate(row),
    invite: { status: row.invite_status, expiresAt: row.expires_at, respondedAt: row.responded_at },
    startsAt: row.start_at,
    endsAt: row.end_at,
    venue:
      row.venue_name === null || row.venue_address === null
        ? null
        : { name: row.venue_name, address: row.venue_address },
  };
}

/** The machine's per-person facts, as `dates.machine_context` stores them. */
function contextOf(date: DateRecord): string {
  return JSON.stringify({
    accepted: date.accepted,
    paymentsOpened: date.paymentsOpened,
    paid: date.paid,
    venueConfirmed: date.venueConfirmed,
    checkedIn: date.checkedIn,
    heldFrom: date.heldFrom,
  });
}

/** Writes `next` over the stored date, which must still be at `expected` (optimistic lock). */
async function saveDate(db: Queryable, dateId: string, next: DateRecord, expected: number) {
  const { rowCount } = await db.query(
    `UPDATE app.dates
       SET status = $2, revision = $3, machine_context = $4, updated_at = now()
     WHERE id = $1 AND revision = $5`,
    [dateId, next.state, next.revision, contextOf(next), expected],
  );
  if (rowCount !== 1) throw new Error("invitations: the date changed underneath the transaction");
}

export type AnswerOutcome =
  | { readonly kind: "answered"; readonly changed: boolean; readonly record: InvitationRecord }
  | { readonly kind: "refused"; readonly refusal: AnswerRefusal; readonly record: InvitationRecord }
  /** No such date, or not this person's: the two are not told apart. */
  | { readonly kind: "not_found" };

export interface InvitationRepository {
  /** The person's invitations up to the reveal, newest first. */
  forUser(userId: string): Promise<InvitationRecord[]>;
  /** One of the person's invitations, or `null` (none, or not theirs). */
  forUserDate(userId: string, dateId: string): Promise<InvitationRecord | null>;
  /** The person accepts or declines. */
  answer(
    userId: string,
    dateId: string,
    answer: Answer,
    now: Date,
    context?: { readonly traceId?: string },
  ): Promise<AnswerOutcome>;
  /**
   * Sends an eligible date's two invitations (the booking saga, ser-p04-06).
   * Returns false if the date is not eligible.
   */
  open(dateId: string, expiresAt: Date, context?: { readonly traceId?: string }): Promise<boolean>;
  /** Expires dates whose invitations' deadline has passed; returns how many. */
  expireDue(now: Date, limit?: number): Promise<number>;
}

async function audit(
  tx: AuditedTransaction,
  action: string,
  userId: string | null,
  dateId: string,
  metadata: Record<string, unknown> = {},
) {
  await tx.audit({
    actorType: userId === null ? "system" : "user",
    actorId: userId,
    action,
    objectType: "date",
    objectId: dateId,
    metadata,
  });
}

export function pgInvitationRepository(pool: TransactionPool & Queryable): InvitationRepository {
  return {
    async forUser(userId) {
      const { rows } = await pool.query<Row>(
        `${SELECT_MINE} AND NOT (d.status = ANY($2)) ORDER BY i.created_at DESC LIMIT 50`,
        [userId, AFTER_REVEAL],
      );
      return rows.map(toRecord);
    },

    async forUserDate(userId, dateId) {
      const { rows } = await pool.query<Row>(`${SELECT_MINE} AND d.id = $2`, [userId, dateId]);
      const row = rows[0];
      return row === undefined ? null : toRecord(row);
    },

    answer(userId, dateId, answer, now, context = {}) {
      return inAuditedTransaction(
        pool,
        async (tx): Promise<AnswerOutcome> => {
          // Lock the date and the person's invitation: two answers to the same
          // date (the two people at once, or one person twice) run one after
          // the other, each seeing the other's result.
          const { rows } = await tx.db.query<Row>(
            `${SELECT_MINE} AND d.id = $2 FOR UPDATE OF d, i`,
            [userId, dateId],
          );
          const row = rows[0];
          if (row === undefined) {
            await audit(tx, "date.invite.not_found", userId, dateId, { answer });
            return { kind: "not_found" };
          }
          const record = toRecord(row);
          const decision = decideAnswer(record, answer, now);
          if (!decision.ok) {
            await audit(tx, "date.invite.refused", userId, dateId, {
              answer,
              refusal: decision.refusal,
            });
            return { kind: "refused", refusal: decision.refusal, record };
          }
          if (!decision.changed) {
            await audit(tx, "date.invite.repeated", userId, dateId, { answer });
            return { kind: "answered", changed: false, record };
          }
          await saveDate(tx.db, dateId, decision.date, record.date.revision);
          await tx.db.query(
            `UPDATE app.date_invites SET status = $3, responded_at = $4
             WHERE date_id = $1 AND user_id = $2`,
            [dateId, userId, decision.inviteStatus, now],
          );
          if (decision.withdrawOther) {
            await tx.db.query(
              `UPDATE app.date_invites SET status = 'withdrawn'
               WHERE date_id = $1 AND user_id <> $2 AND status = 'pending'`,
              [dateId, userId],
            );
          }
          await audit(
            tx,
            answer === "accept" ? "date.invite.accepted" : "date.invite.declined",
            userId,
            dateId,
            { party: record.party, date_state: decision.date.state },
          );
          return {
            kind: "answered",
            changed: true,
            record: {
              ...record,
              date: decision.date,
              invite: { ...record.invite, status: decision.inviteStatus, respondedAt: now },
            },
          };
        },
        context,
      );
    },

    open(dateId, expiresAt, context = {}) {
      return inAuditedTransaction(
        pool,
        async (tx) => {
          const { rows } = await tx.db.query<Row & { user_a: string; user_b: string }>(
            `SELECT status, machine_version, revision, machine_context, user_a, user_b
             FROM app.dates WHERE id = $1 FOR UPDATE`,
            [dateId],
          );
          const row = rows[0];
          const current = row === undefined ? null : toDate(row);
          const next = current === null ? null : openInvitations(current);
          if (row === undefined || current === null || next === null) {
            await audit(tx, "date.invite.open_refused", null, dateId);
            return false;
          }
          await saveDate(tx.db, dateId, next, current.revision);
          await tx.db.query(
            `INSERT INTO app.date_invites (date_id, user_id, expires_at)
             VALUES ($1, $2, $4), ($1, $3, $4)`,
            [dateId, row.user_a, row.user_b, expiresAt],
          );
          await audit(tx, "date.invite.opened", null, dateId, {
            expires_at: expiresAt.toISOString(),
          });
          return true;
        },
        context,
      );
    },

    async expireDue(now, limit = 100) {
      // Each date in its own transaction, so one failure does not hold back the rest.
      const { rows } = await pool.query<{ id: string }>(
        `SELECT DISTINCT d.id FROM app.dates d
         JOIN app.date_invites i ON i.date_id = d.id
         WHERE d.status = 'INVITED' AND i.expires_at <= $1
         LIMIT $2`,
        [now, limit],
      );
      let expired = 0;
      for (const { id } of rows) {
        const done = await inAuditedTransaction(pool, async (tx) => {
          const locked = await tx.db.query<Row & { deadline: Date }>(
            `SELECT d.status, d.machine_version, d.revision, d.machine_context,
                    (SELECT min(expires_at) FROM app.date_invites WHERE date_id = d.id) AS deadline
             FROM app.dates d WHERE d.id = $1 FOR UPDATE SKIP LOCKED`,
            [id],
          );
          const row = locked.rows[0];
          const current = row === undefined ? null : toDate(row);
          const next =
            row === undefined || current === null
              ? null
              : expireInvitations(current, row.deadline, now);
          if (current === null || next === null) {
            await audit(tx, "date.invite.expiry_skipped", null, id);
            return false;
          }
          await saveDate(tx.db, id, next, current.revision);
          await tx.db.query(
            `UPDATE app.date_invites SET status = 'expired'
             WHERE date_id = $1 AND status = 'pending'`,
            [id],
          );
          await audit(tx, "date.invite.expired", null, id);
          return true;
        });
        if (done) expired += 1;
      }
      return expired;
    },
  };
}
