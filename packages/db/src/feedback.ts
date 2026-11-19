// Private post-date feedback (PLAN-001 P05-01) over app.post_date_feedback,
// as the application role. The rules are @serendipity/feedback's; this
// module reads both answers under a lock on the date, writes the person's
// own, and records a relationship when both said yes. Audit events carry no
// answer, only whether a safety concern was raised (for the safety queue).
import { feedbackView, isMutual, submitRefusal } from "@serendipity/feedback";
import type {
  FeedbackAnswer,
  FeedbackState,
  FeedbackView,
  SubmitRefusal,
} from "@serendipity/feedback";

import { inAuditedTransaction } from "./audit.js";
import { fileReport } from "./safety.js";
import type { AuditedTransaction, TransactionPool } from "./audit.js";
import type { Queryable } from "./queryable.js";

export type FeedbackOutcome =
  | { readonly kind: "answered"; readonly view: FeedbackView }
  | { readonly kind: "refused"; readonly refusal: SubmitRefusal }
  | { readonly kind: "not_found" };

export interface FeedbackRepository {
  /** The person's own view, or `null` when the date is not theirs (or does not exist). */
  view(userId: string, dateId: string, now: Date): Promise<FeedbackView | null>;
  submit(
    userId: string,
    dateId: string,
    answer: FeedbackAnswer,
    now: Date,
    context?: { traceId?: string },
  ): Promise<FeedbackOutcome>;
}

interface DateRow {
  status: string;
  end_at: Date | null;
  user_a: string;
  user_b: string;
}

interface AnswerRow {
  user_id: string;
  mutual_interest: boolean | null;
  comfort_rating: number | null;
  safety_flag: boolean;
}

const toAnswer = (row: AnswerRow | undefined): FeedbackAnswer | null =>
  row === undefined
    ? null
    : {
        feltSafe: !row.safety_flag,
        comfort: (row.comfort_rating ?? 3) as FeedbackAnswer["comfort"],
        wantsToContinue: row.mutual_interest === true,
      };

async function stateOf(
  db: Queryable,
  userId: string,
  dateId: string,
  lock: boolean,
): Promise<(FeedbackState & { users: readonly [string, string] }) | null> {
  const { rows } = await db.query<DateRow>(
    `SELECT status, end_at, user_a, user_b FROM app.dates
     WHERE id = $1 AND (user_a = $2 OR user_b = $2)${lock ? " FOR UPDATE" : ""}`,
    [dateId, userId],
  );
  const date = rows[0];
  if (date === undefined) return null;
  const answers = await db.query<AnswerRow>(
    `SELECT user_id, mutual_interest, comfort_rating, safety_flag
     FROM app.post_date_feedback WHERE date_id = $1`,
    [dateId],
  );
  return {
    dateStatus: date.status,
    dateEndedAt: date.end_at,
    mine: toAnswer(answers.rows.find((row) => row.user_id === userId)),
    theirs: toAnswer(answers.rows.find((row) => row.user_id !== userId)),
    users: [date.user_a, date.user_b],
  };
}

async function audit(
  tx: AuditedTransaction,
  action: string,
  userId: string | null,
  dateId: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await tx.audit({
    actorType: userId === null ? "system" : "user",
    actorId: userId,
    action,
    objectType: "date",
    objectId: dateId,
    metadata,
  });
}

export function pgFeedbackRepository(pool: TransactionPool & Queryable): FeedbackRepository {
  return {
    async view(userId, dateId, now) {
      const state = await stateOf(pool, userId, dateId, false);
      return state === null ? null : feedbackView(state, now);
    },

    submit: (userId, dateId, answer, now, context = {}) =>
      inAuditedTransaction(
        pool,
        async (tx): Promise<FeedbackOutcome> => {
          const state = await stateOf(tx.db, userId, dateId, true);
          if (state === null) {
            await audit(tx, "date.feedback.not_found", userId, dateId);
            return { kind: "not_found" };
          }
          const refusal = submitRefusal(state, now);
          if (refusal !== null) {
            await audit(tx, "date.feedback.refused", userId, dateId, { refusal });
            return { kind: "refused", refusal };
          }
          await tx.db.query(
            `INSERT INTO app.post_date_feedback
               (date_id, user_id, mutual_interest, comfort_rating, safety_flag, created_at)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [dateId, userId, answer.wantsToContinue, answer.comfort, !answer.feltSafe, now],
          );
          await audit(tx, "date.feedback.submitted", userId, dateId, {
            safety_concern: !answer.feltSafe,
          });
          if (!answer.feltSafe) {
            // "I did not feel safe" goes to the safety team as a report (ADR-0022).
            const [a, b] = state.users;
            await fileReport(tx, {
              reporterId: userId,
              subjectId: a === userId ? b : a,
              dateId,
              category: "felt_unsafe",
              details: null,
              now,
            });
          }
          const next = { ...state, mine: answer };
          if (isMutual(next.mine, next.theirs)) {
            const [a, b] = state.users;
            await tx.db.query(
              `INSERT INTO app.relationships (date_id, user_a, user_b, mutual_opt_in_at, chat_open)
               VALUES ($1, $2, $3, $4, true) ON CONFLICT (date_id) DO NOTHING`,
              [dateId, a, b, now],
            );
            await audit(tx, "relationship.mutual_opt_in", null, dateId);
          }
          return { kind: "answered", view: feedbackView(next, now) };
        },
        context,
      ),
  };
}
