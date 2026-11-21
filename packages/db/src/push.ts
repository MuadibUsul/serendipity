// Push devices and delivering the outbox (ADR-0030), over app.push_devices
// and app.notification_outbox, as the application role. The rules are
// @serendipity/notify's deliverOutbox.
import type { OutboxStore, PendingNotification, Platform } from "@serendipity/notify";

import { inAuditedTransaction } from "./audit.js";
import type { TransactionPool } from "./audit.js";
import type { Queryable } from "./queryable.js";

export interface PushDeviceRepository {
  /** Records the token for this person, taking it over from anyone who had it before. */
  register(
    userId: string,
    token: string,
    platform: Platform,
    context?: { traceId?: string },
  ): Promise<void>;
  /** Removes the token if it is this person's (signing out on that phone). */
  unregister(userId: string, token: string, context?: { traceId?: string }): Promise<boolean>;
}

export function pgPushDeviceRepository(pool: TransactionPool & Queryable): PushDeviceRepository {
  return {
    register: (userId, token, platform, context = {}) =>
      inAuditedTransaction(
        pool,
        async (tx) => {
          await tx.db.query(
            `INSERT INTO app.push_devices (token, user_id, platform) VALUES ($1, $2, $3)
             ON CONFLICT (token) DO UPDATE
               SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, last_seen_at = now()`,
            [token, userId, platform],
          );
          await tx.audit({
            actorType: "user",
            actorId: userId,
            action: "push.device.registered",
            objectType: "user",
            objectId: userId,
            // Never the token: it is enough to send this person notifications.
            metadata: { platform },
          });
        },
        context,
      ),

    unregister: (userId, token, context = {}) =>
      inAuditedTransaction(
        pool,
        async (tx) => {
          const { rowCount } = await tx.db.query(
            "DELETE FROM app.push_devices WHERE token = $1 AND user_id = $2",
            [token, userId],
          );
          await tx.audit({
            actorType: "user",
            actorId: userId,
            action: (rowCount ?? 0) > 0 ? "push.device.removed" : "push.device.remove_unchanged",
            objectType: "user",
            objectId: userId,
          });
          return (rowCount ?? 0) > 0;
        },
        context,
      ),
  };
}

interface PendingRow {
  id: string;
  payload: Record<string, unknown>;
  tokens: string[] | null;
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

/** The outbox as deliverOutbox reads it. Only notifications with a recipient and a title are pushed. */
export function pgOutboxStore(pool: TransactionPool & Queryable): OutboxStore {
  const mark = (id: string, action: string, sql: string) =>
    inAuditedTransaction(pool, async (tx) => {
      await tx.db.query(sql, [id]);
      await tx.audit({
        actorType: "system",
        actorId: null,
        action,
        objectType: "notification",
        objectId: id,
      });
    });

  return {
    async pending(limit, maxAttempts) {
      const { rows } = await pool.query<PendingRow>(
        `SELECT o.id, o.payload,
                (SELECT array_agg(d.token ORDER BY d.created_at) FROM app.push_devices d
                 WHERE d.user_id = o.recipient_user_id) AS tokens
         FROM app.notification_outbox o
         WHERE o.dispatched_at IS NULL AND o.attempts < $2
           AND o.recipient_user_id IS NOT NULL AND o.payload ? 'title'
         ORDER BY o.created_at LIMIT $1`,
        [limit, maxAttempts],
      );
      return rows.map((row): PendingNotification => ({
        id: row.id,
        title: text(row.payload["title"]),
        body: text(row.payload["body"]),
        data: typeof row.payload["date_id"] === "string" ? { date_id: row.payload["date_id"] } : {},
        tokens: row.tokens ?? [],
      }));
    },
    sent: (id) =>
      mark(
        id,
        "notification.sent",
        `UPDATE app.notification_outbox SET dispatched_at = now(), attempts = attempts + 1
         WHERE id = $1 AND dispatched_at IS NULL`,
      ),
    failed: (id) =>
      mark(
        id,
        "notification.failed",
        "UPDATE app.notification_outbox SET attempts = attempts + 1 WHERE id = $1",
      ),
    async forgetToken(token) {
      await inAuditedTransaction(pool, async (tx) => {
        const { rows } = await tx.db.query<{ user_id: string }>(
          "DELETE FROM app.push_devices WHERE token = $1 RETURNING user_id",
          [token],
        );
        await tx.audit({
          actorType: "system",
          actorId: null,
          action: "push.device.forgotten",
          objectType: "user",
          objectId: rows[0]?.user_id ?? null,
        });
      });
    },
  };
}
