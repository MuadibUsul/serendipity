// Sign-in storage in app.auth_* (migration 0010) for @serendipity/auth.
//
// Every value that could identify a person or be replayed arrives as a keyed
// hash; this module never sees a phone number, a code or a token. Each call is
// one audited transaction. Limits are counted in the database under an
// advisory lock per number and per network address, so two requests at once
// cannot both slip under a limit.
import { CHALLENGE_LIFECYCLE, SESSION_LIFECYCLE, sameHash } from "@serendipity/auth";
import type {
  AuthRepository,
  ChallengeState,
  RefreshRefusal,
  StoredTokens,
  VerifyRefusal,
} from "@serendipity/auth";

import { inAuditedTransaction } from "./audit.js";
import type { AuditedTransaction, TransactionPool } from "./audit.js";
import type { Queryable } from "./queryable.js";

const HOUR_MS = 60 * 60 * 1000;

/** Accounts that may no longer sign in or act. */
const CLOSED = ["suspended", "deleted"];

const secondsUntil = (from: Date, to: Date) =>
  Math.max(1, Math.ceil((to.getTime() - from.getTime()) / 1000));

async function audit(
  tx: AuditedTransaction,
  action: string,
  actor: string | null,
  object: { readonly type: string; readonly id: string | null },
  metadata: Record<string, unknown> = {},
) {
  await tx.audit({
    actorType: actor === null ? "system" : "user",
    actorId: actor,
    action,
    objectType: object.type,
    objectId: object.id,
    metadata,
  });
}

async function insertSession(
  db: Queryable,
  userId: string,
  familyId: string | null,
  tokens: StoredTokens,
  now: Date,
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO app.auth_sessions
       (family_id, user_id, access_hash, access_expires_at, refresh_hash, refresh_expires_at, created_at)
     VALUES (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      familyId,
      userId,
      tokens.accessHash,
      tokens.accessExpiresAt,
      tokens.refreshHash,
      tokens.refreshExpiresAt,
      now,
    ],
  );
  return rows[0]?.id ?? "";
}

/** Moves a challenge, checked against its lifecycle first (the database guard checks again). */
async function endChallenge(
  db: Queryable,
  id: string,
  from: ChallengeState,
  to: ChallengeState,
  now: Date,
) {
  CHALLENGE_LIFECYCLE.assertCan(from, to);
  await db.query("UPDATE app.auth_challenges SET status = $2, ended_at = $3 WHERE id = $1", [
    id,
    to,
    now,
  ]);
}

export function pgAuthRepository(pool: TransactionPool & Queryable): AuthRepository {
  return {
    requestCode({ phoneHash, ipHash, codeHash, now, expiresAt, limits }) {
      return inAuditedTransaction(pool, async (tx) => {
        // Number first, then address, in every transaction: no lock cycle.
        await tx.db.query("SELECT pg_advisory_xact_lock(hashtext('auth:phone:' || $1))", [
          phoneHash,
        ]);
        await tx.db.query("SELECT pg_advisory_xact_lock(hashtext('auth:ip:' || $1))", [ipHash]);
        const since = new Date(now.getTime() - HOUR_MS);
        const { rows } = await tx.db.query<{
          phone_last: Date | null;
          phone_count: string;
          phone_oldest: Date | null;
          ip_count: string;
          ip_oldest: Date | null;
        }>(
          `SELECT
             (SELECT max(created_at) FROM app.auth_challenges WHERE phone_hash = $1) AS phone_last,
             (SELECT count(*) FROM app.auth_challenges WHERE phone_hash = $1 AND created_at > $3) AS phone_count,
             (SELECT min(created_at) FROM app.auth_challenges WHERE phone_hash = $1 AND created_at > $3) AS phone_oldest,
             (SELECT count(*) FROM app.auth_challenges WHERE ip_hash = $2 AND created_at > $3) AS ip_count,
             (SELECT min(created_at) FROM app.auth_challenges WHERE ip_hash = $2 AND created_at > $3) AS ip_oldest`,
          [phoneHash, ipHash, since],
        );
        const seen = rows[0];
        const waits: number[] = [];
        if (seen?.phone_last !== undefined && seen.phone_last !== null) {
          const ready = new Date(seen.phone_last.getTime() + limits.resendAfterS * 1000);
          if (ready > now) waits.push(secondsUntil(now, ready));
        }
        if (
          seen !== undefined &&
          Number(seen.phone_count) >= limits.perPhonePerHour &&
          seen.phone_oldest !== null
        ) {
          waits.push(secondsUntil(now, new Date(seen.phone_oldest.getTime() + HOUR_MS)));
        }
        if (
          seen !== undefined &&
          Number(seen.ip_count) >= limits.perIpPerHour &&
          seen.ip_oldest !== null
        ) {
          waits.push(secondsUntil(now, new Date(seen.ip_oldest.getTime() + HOUR_MS)));
        }
        if (waits.length > 0) {
          const retryAfterS = Math.max(...waits);
          await audit(
            tx,
            "auth.code.limited",
            null,
            { type: "auth_challenge", id: null },
            {
              retry_after_s: retryAfterS,
            },
          );
          return { ok: false, retryAfterS } as const;
        }
        // A new code replaces any earlier one.
        const earlier = await tx.db.query<{ id: string }>(
          "SELECT id FROM app.auth_challenges WHERE phone_hash = $1 AND status = 'pending' FOR UPDATE",
          [phoneHash],
        );
        for (const { id } of earlier.rows) await endChallenge(tx.db, id, "pending", "expired", now);
        const inserted = await tx.db.query<{ id: string }>(
          `INSERT INTO app.auth_challenges (phone_hash, ip_hash, code_hash, expires_at, created_at)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [phoneHash, ipHash, codeHash, expiresAt, now],
        );
        await audit(
          tx,
          "auth.code.requested",
          null,
          {
            type: "auth_challenge",
            id: inserted.rows[0]?.id ?? null,
          },
          { replaced: earlier.rows.length },
        );
        return { ok: true } as const;
      });
    },

    verify({ phoneHash, codeHash, now, maxAttempts, tokens }) {
      return inAuditedTransaction(pool, async (tx) => {
        const refuse = async (
          refusal: VerifyRefusal | "account_closed",
          challenge: string | null,
        ) => {
          await audit(
            tx,
            "auth.signin.refused",
            null,
            { type: "auth_challenge", id: challenge },
            {
              reason: refusal,
            },
          );
          return {
            ok: false,
            // A closed account reads like any other refusal to the client.
            refusal: refusal === "account_closed" ? "no_code" : refusal,
          } as const;
        };
        const { rows } = await tx.db.query<{
          id: string;
          code_hash: string;
          attempts: number;
          expires_at: Date;
        }>(
          `SELECT id, code_hash, attempts, expires_at FROM app.auth_challenges
           WHERE phone_hash = $1 AND status = 'pending' FOR UPDATE`,
          [phoneHash],
        );
        const challenge = rows[0];
        if (challenge === undefined) return refuse("no_code", null);
        if (challenge.expires_at <= now) {
          await endChallenge(tx.db, challenge.id, "pending", "expired", now);
          return refuse("expired", challenge.id);
        }
        if (!sameHash(challenge.code_hash, codeHash)) {
          const attempts = challenge.attempts + 1;
          await tx.db.query("UPDATE app.auth_challenges SET attempts = $2 WHERE id = $1", [
            challenge.id,
            attempts,
          ]);
          if (attempts >= maxAttempts) {
            await endChallenge(tx.db, challenge.id, "pending", "locked", now);
            return refuse("locked", challenge.id);
          }
          return refuse("wrong_code", challenge.id);
        }
        await endChallenge(tx.db, challenge.id, "pending", "used", now);

        const account = await tx.db.query<{ user_id: string; status: string }>(
          `SELECT a.user_id, u.status FROM app.auth_phone_accounts a
           JOIN app.users u ON u.id = a.user_id WHERE a.phone_hash = $1`,
          [phoneHash],
        );
        let userId = account.rows[0]?.user_id;
        const created = userId === undefined;
        if (account.rows[0] !== undefined && CLOSED.includes(account.rows[0].status)) {
          return refuse("account_closed", challenge.id);
        }
        if (userId === undefined) {
          // A number banned when its suspended account was deleted cannot start over.
          const banned = await tx.db.query(
            "SELECT 1 FROM app.auth_banned_phones WHERE phone_hash = $1",
            [phoneHash],
          );
          if (banned.rowCount !== 0) return refuse("account_closed", challenge.id);
          const user = await tx.db.query<{ id: string }>(
            "INSERT INTO app.users DEFAULT VALUES RETURNING id",
          );
          userId = user.rows[0]?.id ?? "";
          await tx.db.query(
            "INSERT INTO app.auth_phone_accounts (phone_hash, user_id) VALUES ($1, $2)",
            [phoneHash, userId],
          );
        }
        const session = await insertSession(tx.db, userId, null, tokens, now);
        await audit(tx, "auth.signin", userId, { type: "auth_session", id: session }, { created });
        return { ok: true, userId, created } as const;
      });
    },

    refresh({ refreshHash, now, tokens }) {
      return inAuditedTransaction(pool, async (tx) => {
        const refuse = async (
          refusal: RefreshRefusal,
          session: string | null,
          actor: string | null,
        ) => {
          await audit(
            tx,
            "auth.refresh.refused",
            actor,
            { type: "auth_session", id: session },
            {
              reason: refusal,
            },
          );
          return { ok: false, refusal } as const;
        };
        const { rows } = await tx.db.query<{
          id: string;
          family_id: string;
          user_id: string;
          status: "active" | "rotated" | "revoked";
          refresh_expires_at: Date;
          user_status: string;
        }>(
          `SELECT s.id, s.family_id, s.user_id, s.status, s.refresh_expires_at, u.status AS user_status
           FROM app.auth_sessions s JOIN app.users u ON u.id = s.user_id
           WHERE s.refresh_hash = $1 FOR UPDATE OF s`,
          [refreshHash],
        );
        const session = rows[0];
        if (session === undefined) return refuse("unknown", null, null);
        if (session.status === "rotated") {
          // Spent twice: someone kept a copy. End every session of this sign-in.
          await tx.db.query(
            `UPDATE app.auth_sessions SET status = 'revoked', ended_at = $2
             WHERE family_id = $1 AND status IN ('active', 'rotated')`,
            [session.family_id, now],
          );
          return refuse("reused", session.id, session.user_id);
        }
        if (session.status === "revoked") return refuse("revoked", session.id, session.user_id);
        if (session.refresh_expires_at <= now || CLOSED.includes(session.user_status)) {
          SESSION_LIFECYCLE.assertCan("active", "revoked");
          await tx.db.query(
            "UPDATE app.auth_sessions SET status = 'revoked', ended_at = $2 WHERE id = $1",
            [session.id, now],
          );
          return refuse(
            session.refresh_expires_at <= now ? "expired" : "revoked",
            session.id,
            session.user_id,
          );
        }
        SESSION_LIFECYCLE.assertCan("active", "rotated");
        await tx.db.query(
          "UPDATE app.auth_sessions SET status = 'rotated', ended_at = $2 WHERE id = $1",
          [session.id, now],
        );
        const next = await insertSession(tx.db, session.user_id, session.family_id, tokens, now);
        await audit(tx, "auth.refresh", session.user_id, { type: "auth_session", id: next });
        return { ok: true, userId: session.user_id } as const;
      });
    },

    async logout(accessHash, now) {
      await inAuditedTransaction(pool, async (tx) => {
        const { rows } = await tx.db.query<{ id: string; user_id: string }>(
          `UPDATE app.auth_sessions SET status = 'revoked', ended_at = $2
           WHERE access_hash = $1 AND status = 'active' RETURNING id, user_id`,
          [accessHash, now],
        );
        const ended = rows[0];
        await audit(
          tx,
          "auth.logout",
          ended?.user_id ?? null,
          {
            type: "auth_session",
            id: ended?.id ?? null,
          },
          { ended: ended !== undefined },
        );
      });
    },

    async callerFor(accessHash, now) {
      const { rows } = await pool.query<{ user_id: string }>(
        `SELECT s.user_id FROM app.auth_sessions s JOIN app.users u ON u.id = s.user_id
         WHERE s.access_hash = $1 AND s.status = 'active' AND s.access_expires_at > $2
           AND NOT (u.status = ANY ($3))`,
        [accessHash, now, CLOSED],
      );
      return rows[0]?.user_id ?? null;
    },
  };
}
