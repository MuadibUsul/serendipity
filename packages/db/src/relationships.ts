// Chat after a mutual yes (PLAN-001 P05-02) over app.relationships and
// app.chat_messages, as the application role. The rules are
// @serendipity/relationships' chatRefusal; the database trigger refuses a
// message into a closed chat even if this module is bypassed.
import { SCOPES } from "@serendipity/consent";
import { chatRefusal, peerSees } from "@serendipity/relationships";
import type { ChatRefusal, ChatState } from "@serendipity/relationships";

import { inAuditedTransaction } from "./audit.js";
import type { AuditedTransaction, TransactionPool } from "./audit.js";
import type { Queryable } from "./queryable.js";

export interface RelationshipSummary {
  readonly id: string;
  /** Whether the two can still talk; never why not. */
  readonly chat: "open" | "closed";
  /** Whether this person can send now (they may lack the chat consent). */
  readonly canSend: boolean;
}

export interface ChatMessage {
  readonly id: string;
  readonly mine: boolean;
  readonly body: string;
  readonly sentAt: Date;
}

export type SendOutcome =
  | { readonly kind: "sent"; readonly message: ChatMessage }
  | { readonly kind: "refused"; readonly refusal: ChatRefusal }
  | { readonly kind: "not_found" };

export interface RelationshipRepository {
  forUser(userId: string): Promise<RelationshipSummary[]>;
  /** Up to 100 messages after `after` (oldest first), or `null` when not the person's. */
  messages(
    userId: string,
    relationshipId: string,
    after: Date | null,
  ): Promise<ChatMessage[] | null>;
  send(
    userId: string,
    relationshipId: string,
    body: string,
    now: Date,
    context?: { traceId?: string },
  ): Promise<SendOutcome>;
  /** Leaves (or blocks): chat closes for both, for good. `false` when not the person's. */
  close(
    userId: string,
    relationshipId: string,
    how: "leave" | "block",
    now: Date,
    context?: { traceId?: string },
  ): Promise<boolean>;
}

interface Row {
  id: string;
  user_a: string;
  user_b: string;
  mutual: boolean;
  left: boolean;
  blocked: boolean;
  status_a: string;
  status_b: string;
}

const SELECT = `
  SELECT r.id, r.user_a, r.user_b, r.mutual_opt_in_at IS NOT NULL AS mutual,
         r.left_at IS NOT NULL AS left, r.blocked_at IS NOT NULL AS blocked,
         ua.status AS status_a, ub.status AS status_b
  FROM app.relationships r
  JOIN app.users ua ON ua.id = r.user_a
  JOIN app.users ub ON ub.id = r.user_b
  WHERE (r.user_a = $1 OR r.user_b = $1)`;

async function hasChatConsent(db: Queryable, userId: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `SELECT 1 FROM app.consent_grants
     WHERE user_id = $1 AND scope = 'relationship_chat' AND purpose = 'relationship_messaging'
       AND recipient_class = 'relationship_peer' AND revoked_at IS NULL AND version >= $2`,
    [userId, SCOPES.relationship_chat.minimumVersion],
  );
  return (rowCount ?? 0) > 0;
}

const stateOf = (row: Row, userId: string, consent: boolean): ChatState => {
  const mineIsA = row.user_a === userId;
  return {
    mutualOptIn: row.mutual,
    left: row.left,
    blocked: row.blocked,
    senderStatus: mineIsA ? row.status_a : row.status_b,
    peerStatus: mineIsA ? row.status_b : row.status_a,
    senderConsent: consent,
  };
};

async function audit(
  tx: AuditedTransaction,
  action: string,
  userId: string,
  relationshipId: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await tx.audit({
    actorType: "user",
    actorId: userId,
    action,
    objectType: "relationship",
    objectId: relationshipId,
    metadata,
  });
}

export function pgRelationshipRepository(
  pool: TransactionPool & Queryable,
): RelationshipRepository {
  return {
    async forUser(userId) {
      const { rows } = await pool.query<Row>(`${SELECT} ORDER BY r.created_at DESC`, [userId]);
      const consent = await hasChatConsent(pool, userId);
      return rows.map((row) => {
        const refusal = chatRefusal(stateOf(row, userId, consent));
        return {
          id: row.id,
          chat: peerSees(refusal) === "open" ? "open" : "closed",
          canSend: refusal === null,
        };
      });
    },

    async messages(userId, relationshipId, after) {
      const { rows } = await pool.query<Row>(`${SELECT} AND r.id = $2`, [userId, relationshipId]);
      if (rows[0] === undefined) return null;
      const result = await pool.query<{
        id: string;
        sender_id: string;
        body: string;
        created_at: Date;
      }>(
        `SELECT id, sender_id, body, created_at FROM app.chat_messages
         WHERE relationship_id = $1 AND ($2::timestamptz IS NULL OR created_at > $2)
         ORDER BY created_at, id LIMIT 100`,
        [relationshipId, after],
      );
      return result.rows.map((row) => ({
        id: row.id,
        mine: row.sender_id === userId,
        body: row.body,
        sentAt: row.created_at,
      }));
    },

    send: (userId, relationshipId, body, now, context = {}) =>
      inAuditedTransaction(
        pool,
        async (tx): Promise<SendOutcome> => {
          const { rows } = await tx.db.query<Row>(`${SELECT} AND r.id = $2 FOR UPDATE OF r`, [
            userId,
            relationshipId,
          ]);
          const row = rows[0];
          if (row === undefined) {
            await audit(tx, "relationship.message.not_found", userId, relationshipId);
            return { kind: "not_found" };
          }
          const refusal = chatRefusal(stateOf(row, userId, await hasChatConsent(tx.db, userId)));
          if (refusal !== null) {
            await audit(tx, "relationship.message.refused", userId, relationshipId, { refusal });
            return { kind: "refused", refusal };
          }
          const inserted = await tx.db.query<{ id: string }>(
            `INSERT INTO app.chat_messages (relationship_id, sender_id, body, created_at)
             VALUES ($1, $2, $3, $4) RETURNING id`,
            [relationshipId, userId, body, now],
          );
          // The message is audited without its text.
          await audit(tx, "relationship.message.sent", userId, relationshipId);
          return {
            kind: "sent",
            message: { id: inserted.rows[0]?.id ?? "", mine: true, body, sentAt: now },
          };
        },
        context,
      ),

    close: (userId, relationshipId, how, now, context = {}) =>
      inAuditedTransaction(
        pool,
        async (tx) => {
          const { rows } = await tx.db.query<Row>(`${SELECT} AND r.id = $2 FOR UPDATE OF r`, [
            userId,
            relationshipId,
          ]);
          if (rows[0] === undefined) {
            await audit(tx, `relationship.${how}.not_found`, userId, relationshipId);
            return false;
          }
          await tx.db.query(
            how === "block"
              ? `UPDATE app.relationships SET chat_open = false,
                   blocked_at = coalesce(blocked_at, $2), blocked_by = coalesce(blocked_by, $3)
                 WHERE id = $1`
              : `UPDATE app.relationships SET chat_open = false,
                   left_at = coalesce(left_at, $2), left_by = coalesce(left_by, $3)
                 WHERE id = $1`,
            [relationshipId, now, userId],
          );
          await audit(
            tx,
            how === "block" ? "relationship.blocked" : "relationship.left",
            userId,
            relationshipId,
          );
          return true;
        },
        context,
      ),
  };
}
