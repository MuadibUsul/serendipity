// Queuing reminders before confirmed dates (P04-09, ADR-0029) into
// app.notification_outbox, as the application role. The rules are
// @serendipity/invitations' dueReminder and reminderText; a push sender
// delivers what is queued. The payload names the time and the venue,
// never the other person.
import { REMINDER_KINDS, dueReminder, reminderText } from "@serendipity/invitations";
import type { ReminderKind } from "@serendipity/invitations";
import { MARKET } from "@serendipity/market";

import { inAuditedTransaction } from "./audit.js";
import type { TransactionPool } from "./audit.js";
import type { Queryable } from "./queryable.js";

/** The outbox `kind` of a reminder. */
export const reminderOutboxKind = (kind: ReminderKind) => `date.reminder.${kind}`;

const KIND_OF = new Map(REMINDER_KINDS.map((kind) => [reminderOutboxKind(kind), kind]));

/** The furthest ahead a reminder is sent. */
const LOOKAHEAD_MS = 24 * 60 * 60 * 1000 + 60_000;

export interface ReminderQueue {
  /** Queues every reminder that is due now; returns how many were queued. */
  enqueueDue(now: Date, limit?: number): Promise<number>;
}

export function pgReminderQueue(pool: TransactionPool & Queryable): ReminderQueue {
  return {
    async enqueueDue(now, limit = 200) {
      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM app.dates
         WHERE status = 'CONFIRMED' AND start_at > $1 AND start_at <= $2
         ORDER BY start_at LIMIT $3`,
        [now, new Date(now.getTime() + LOOKAHEAD_MS), limit],
      );
      let queued = 0;
      // Each date in its own transaction, so one failure does not hold back the rest.
      for (const { id } of rows) {
        queued += await inAuditedTransaction(pool, async (tx) => {
          const date = await tx.db.query<{
            status: string;
            start_at: Date;
            venue_name: string | null;
            user_a: string;
            user_b: string;
          }>(
            `SELECT d.status, d.start_at, v.name AS venue_name, d.user_a, d.user_b
             FROM app.dates d LEFT JOIN app.venues v ON v.id = d.venue_id
             WHERE d.id = $1 FOR UPDATE OF d`,
            [id],
          );
          const row = date.rows[0];
          let count = 0;
          if (row?.status === "CONFIRMED" && row.venue_name !== null) {
            for (const userId of [row.user_a, row.user_b]) {
              count += await queueFor(tx.db, id, userId, row.start_at, row.venue_name, now);
            }
          }
          await tx.audit({
            actorType: "system",
            actorId: null,
            action: "date.reminders.checked",
            objectType: "date",
            objectId: id,
            metadata: { queued: count },
          });
          return count;
        });
      }
      return queued;
    },
  };
}

async function queueFor(
  db: Queryable,
  dateId: string,
  userId: string,
  startAt: Date,
  venueName: string,
  now: Date,
): Promise<number> {
  const person = await db.query<{ status: string }>("SELECT status FROM app.users WHERE id = $1", [
    userId,
  ]);
  if (!["active", "paused"].includes(person.rows[0]?.status ?? "")) return 0;
  const sent = await db.query<{ kind: string }>(
    `SELECT kind FROM app.notification_outbox
     WHERE aggregate_type = 'date' AND aggregate_id = $1 AND recipient_user_id = $2`,
    [dateId, userId],
  );
  const kinds = sent.rows.flatMap((row) => {
    const kind = KIND_OF.get(row.kind);
    return kind === undefined ? [] : [kind];
  });
  const due = dueReminder(startAt, now, kinds);
  if (due === null) return 0;
  const text = reminderText(due, startAt, venueName, MARKET.timeZone, MARKET.locale);
  const inserted = await db.query(
    `INSERT INTO app.notification_outbox (aggregate_type, aggregate_id, kind, recipient_user_id, payload)
     VALUES ('date', $1, $2, $3, $4)
     ON CONFLICT (aggregate_type, aggregate_id, kind, recipient_user_id) DO NOTHING`,
    [dateId, reminderOutboxKind(due), userId, JSON.stringify({ date_id: dateId, ...text })],
  );
  return inserted.rowCount ?? 0;
}
