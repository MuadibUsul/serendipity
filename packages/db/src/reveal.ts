// One card a day after a mutual yes (ADR-0021), over app.reveal_settings and
// app.reveal_flips, as the application role. The rules are
// @serendipity/relationships' deckOf, faceDown, stillShown and flipRefusal.
// Decks are built from the owner's approved profile at the moment of asking,
// so a fact they remove, or a category they take out, disappears at once.
import { SCOPES } from "@serendipity/consent";
import {
  DEFAULT_SETTINGS,
  chatRefusal,
  deckOf,
  faceDown,
  flipRefusal,
  isCategory,
  startOfDay,
  stillShown,
} from "@serendipity/relationships";
import type { Card, Category, DeckSettings, FlipRefusal } from "@serendipity/relationships";

import { inAuditedTransaction } from "./audit.js";
import type { AuditedTransaction, TransactionPool } from "./audit.js";
import type { Queryable } from "./queryable.js";

export interface RevealView {
  /** `open`: cards can be turned over (subject to the daily limit and step). */
  readonly status: "open" | "closed" | "no_consent";
  /** How many cards are face down in each category of the other's deck. */
  readonly faceDown: readonly { readonly category: Category; readonly remaining: number }[];
  /** The cards the viewer turned over, still in the other's deck. */
  readonly seen: readonly Card[];
  /** Why a card cannot be turned over now, or `null`. */
  readonly refusal: FlipRefusal | null;
}

export type FlipOutcome =
  | { readonly kind: "flipped"; readonly card: Card }
  | { readonly kind: "refused"; readonly refusal: FlipRefusal }
  | { readonly kind: "not_found" };

export interface RevealRepository {
  view(viewerId: string, relationshipId: string, now: Date): Promise<RevealView | null>;
  flip(
    viewerId: string,
    relationshipId: string,
    category: Category,
    now: Date,
    pick?: (count: number) => number,
    context?: { traceId?: string },
  ): Promise<FlipOutcome>;
  /** The owner's own deck settings. */
  settings(userId: string): Promise<{ excluded: Category[]; included: Category[] }>;
  setSettings(
    userId: string,
    settings: { excluded: readonly Category[]; included: readonly Category[] },
    context?: { traceId?: string },
  ): Promise<void>;
}

interface RelRow {
  id: string;
  user_a: string;
  user_b: string;
  mutual: boolean;
  left: boolean;
  blocked: boolean;
  status_a: string;
  status_b: string;
}

const SELECT_REL = `
  SELECT r.id, r.user_a, r.user_b, r.mutual_opt_in_at IS NOT NULL AS mutual,
         r.left_at IS NOT NULL AS left, r.blocked_at IS NOT NULL AS blocked,
         ua.status AS status_a, ub.status AS status_b
  FROM app.relationships r
  JOIN app.users ua ON ua.id = r.user_a
  JOIN app.users ub ON ub.id = r.user_b
  WHERE r.id = $2 AND (r.user_a = $1 OR r.user_b = $1)`;

async function holds(db: Queryable, userId: string, scope: keyof typeof SCOPES): Promise<boolean> {
  const { rowCount } = await db.query(
    `SELECT 1 FROM app.consent_grants
     WHERE user_id = $1 AND scope = $2 AND revoked_at IS NULL AND version >= $3`,
    [userId, scope, SCOPES[scope].minimumVersion],
  );
  return (rowCount ?? 0) > 0;
}

const categories = (values: readonly string[] | null): Category[] =>
  (values ?? []).filter(isCategory);

async function settingsOf(db: Queryable, userId: string): Promise<DeckSettings> {
  const { rows } = await db.query<{ excluded: string[]; included: string[] }>(
    "SELECT excluded, included FROM app.reveal_settings WHERE user_id = $1",
    [userId],
  );
  const row = rows[0];
  return {
    ...DEFAULT_SETTINGS,
    excluded: categories(row?.excluded ?? null),
    included: categories(row?.included ?? null),
    dietaryConsent: await holds(db, userId, "dietary_restrictions"),
  };
}

/** The owner's deck now, from their approved profile. */
async function deckFor(db: Queryable, ownerId: string): Promise<Card[]> {
  const { rows } = await db.query<{ key: string; value: unknown }>(
    `SELECT f.key, f.value FROM app.profile_facts f
     JOIN app.profile_versions v ON v.id = f.profile_version_id
     WHERE v.user_id = $1 AND v.approval_state = 'approved'`,
    [ownerId],
  );
  return deckOf(new Map(rows.map((row) => [row.key, row.value])), await settingsOf(db, ownerId));
}

async function seenBy(db: Queryable, relationshipId: string, viewerId: string): Promise<Card[]> {
  const { rows } = await db.query<{ category: string; item: string }>(
    `SELECT category, item FROM app.reveal_flips
     WHERE relationship_id = $1 AND viewer_id = $2 ORDER BY flipped_at, id`,
    [relationshipId, viewerId],
  );
  return rows.flatMap((row) =>
    isCategory(row.category) ? [{ category: row.category, item: row.item }] : [],
  );
}

async function countSince(
  db: Queryable,
  relationshipId: string,
  viewerId: string,
  since: Date | null,
): Promise<number> {
  const { rows } = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM app.reveal_flips
     WHERE relationship_id = $1 AND viewer_id = $2 AND ($3::timestamptz IS NULL OR flipped_at >= $3)`,
    [relationshipId, viewerId, since],
  );
  return rows[0]?.count ?? 0;
}

interface Situation {
  readonly rel: RelRow;
  readonly ownerId: string;
  readonly open: boolean;
  readonly bothConsent: boolean;
  readonly deck: Card[];
  readonly seen: Card[];
}

async function situation(
  db: Queryable,
  viewerId: string,
  relationshipId: string,
  lock: boolean,
): Promise<Situation | null> {
  const { rows } = await db.query<RelRow>(`${SELECT_REL}${lock ? " FOR UPDATE OF r" : ""}`, [
    viewerId,
    relationshipId,
  ]);
  const rel = rows[0];
  if (rel === undefined) return null;
  const viewerIsA = rel.user_a === viewerId;
  const ownerId = viewerIsA ? rel.user_b : rel.user_a;
  // The chat rules decide whether the two are still in touch; the chat consent is not needed here.
  const refusal = chatRefusal({
    mutualOptIn: rel.mutual,
    left: rel.left,
    blocked: rel.blocked,
    senderStatus: viewerIsA ? rel.status_a : rel.status_b,
    peerStatus: viewerIsA ? rel.status_b : rel.status_a,
    senderConsent: true,
  });
  const bothConsent =
    (await holds(db, viewerId, "relationship_reveal")) &&
    (await holds(db, ownerId, "relationship_reveal"));
  return {
    rel,
    ownerId,
    open: refusal === null,
    bothConsent,
    deck: await deckFor(db, ownerId),
    seen: await seenBy(db, relationshipId, viewerId),
  };
}

async function flipState(db: Queryable, s: Situation, viewerId: string, now: Date) {
  return {
    open: s.open,
    bothConsent: s.bothConsent,
    flippedToday: await countSince(db, s.rel.id, viewerId, startOfDay(now)),
    mine: await countSince(db, s.rel.id, viewerId, null),
    theirs: await countSince(db, s.rel.id, s.ownerId, null),
    myDeckSize: (await deckFor(db, viewerId)).length,
  };
}

async function audit(
  tx: AuditedTransaction,
  action: string,
  userId: string,
  objectType: string,
  objectId: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await tx.audit({ actorType: "user", actorId: userId, action, objectType, objectId, metadata });
}

export function pgRevealRepository(pool: TransactionPool & Queryable): RevealRepository {
  return {
    async view(viewerId, relationshipId, now) {
      const s = await situation(pool, viewerId, relationshipId, false);
      if (s === null) return null;
      if (!s.open || !s.bothConsent) {
        // Nothing of the other's deck is shown while the two are out of touch.
        return {
          status: s.open ? "no_consent" : "closed",
          faceDown: [],
          seen: [],
          refusal: s.open ? "no_consent" : "closed",
        };
      }
      const state = await flipState(pool, s, viewerId, now);
      const remaining = faceDown(s.deck, s.seen);
      const any = remaining.reduce((sum, c) => sum + c.remaining, 0);
      return {
        status: "open",
        faceDown: remaining,
        seen: stillShown(s.deck, s.seen),
        refusal: flipRefusal({ ...state, remainingInCategory: any }),
      };
    },

    flip: (
      viewerId,
      relationshipId,
      category,
      now,
      pick = (n) => Math.floor(Math.random() * n),
      context = {},
    ) =>
      inAuditedTransaction(
        pool,
        async (tx): Promise<FlipOutcome> => {
          const s = await situation(tx.db, viewerId, relationshipId, true);
          if (s === null) {
            await audit(
              tx,
              "relationship.card.not_found",
              viewerId,
              "relationship",
              relationshipId,
            );
            return { kind: "not_found" };
          }
          const seen = new Set(s.seen.map((card) => `${card.category}\u0000${card.item}`));
          const candidates = s.deck.filter(
            (card) => card.category === category && !seen.has(`${card.category}\u0000${card.item}`),
          );
          const refusal = flipRefusal({
            ...(await flipState(tx.db, s, viewerId, now)),
            remainingInCategory: candidates.length,
          });
          if (refusal !== null) {
            await audit(tx, "relationship.card.refused", viewerId, "relationship", relationshipId, {
              refusal,
            });
            return { kind: "refused", refusal };
          }
          const index = Math.min(candidates.length - 1, Math.max(0, pick(candidates.length)));
          const card = candidates[index] ?? candidates[0];
          if (card === undefined) return { kind: "refused", refusal: "category_empty" };
          await tx.db.query(
            `INSERT INTO app.reveal_flips (relationship_id, viewer_id, category, item, flipped_at)
             VALUES ($1, $2, $3, $4, $5)`,
            [relationshipId, viewerId, card.category, card.item, now],
          );
          // The audit names the category, never the item.
          await audit(tx, "relationship.card.flipped", viewerId, "relationship", relationshipId, {
            category,
          });
          return { kind: "flipped", card };
        },
        context,
      ),

    async settings(userId) {
      const s = await settingsOf(pool, userId);
      return { excluded: [...s.excluded], included: [...s.included] };
    },

    setSettings: (userId, settings, context = {}) =>
      inAuditedTransaction(
        pool,
        async (tx) => {
          await tx.db.query(
            `INSERT INTO app.reveal_settings (user_id, excluded, included, updated_at)
             VALUES ($1, $2, $3, now())
             ON CONFLICT (user_id) DO UPDATE
               SET excluded = EXCLUDED.excluded, included = EXCLUDED.included, updated_at = now()`,
            [userId, settings.excluded.filter(isCategory), settings.included.filter(isCategory)],
          );
          await audit(tx, "relationship.deck.updated", userId, "user", userId, {
            excluded: settings.excluded,
            included: settings.included,
          });
        },
        context,
      ),
  };
}
