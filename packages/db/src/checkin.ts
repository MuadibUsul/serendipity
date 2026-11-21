// Checking in at the venue and the reveal (P04-08a, ADR-0028), over
// app.dates, app.checkins and app.venue_devices, as the application role.
//
// The person's side only finds out which side of their own date they are on
// and whether check-in is open. The venue's side acts only on dates at its
// own venue, through the domain machine (PARTY_CHECKED_IN, REVEAL, sent as
// the merchant), and every scan, refused ones included, is audited.
import { transition } from "@serendipity/domain";
import type { DateRecord, DateState, Party } from "@serendipity/domain";

import { inAuditedTransaction } from "./audit.js";
import type { AuditedTransaction, TransactionPool } from "./audit.js";
import { saveDate, toDate } from "./invitations.js";
import type { Queryable } from "./queryable.js";

/** States in which a person shows a code: the date is on and not yet revealed. */
const SHOWING: readonly DateState[] = ["CONFIRMED", "CHECKIN_PARTIAL", "BOTH_CHECKED_IN"];

export interface OwnCheckin {
  readonly party: Party;
  readonly startAt: Date;
  readonly endAt: Date;
  /** Whether the date is in a state where a code means anything. */
  readonly showing: boolean;
  /** This person is already checked in. */
  readonly checkedIn: boolean;
}

export type CheckinOutcome =
  | { readonly kind: "checked_in"; readonly both: boolean; readonly repeated: boolean }
  /** Not a date at this venue, or no such date: the two are not told apart. */
  | { readonly kind: "not_found" }
  | { readonly kind: "closed" }
  | { readonly kind: "refused" };

export type RevealOutcome =
  | { readonly kind: "revealed"; readonly repeated: boolean }
  | { readonly kind: "not_found" }
  | { readonly kind: "waiting" };

export interface CheckinRepository {
  /** The person's side of their own date, or `null` if it is not theirs. */
  ownCheckin(userId: string, dateId: string): Promise<OwnCheckin | null>;
  /** The venue a live device belongs to, or `null`. */
  deviceVenue(keyHash: string): Promise<string | null>;
  registerDevice(
    venueId: string,
    label: string,
    keyHash: string,
    context?: { traceId?: string },
  ): Promise<string>;
  revokeDevice(deviceId: string, context?: { traceId?: string }): Promise<boolean>;
  checkIn(
    venueId: string,
    dateId: string,
    party: Party,
    now: Date,
    isOpen: (startAt: Date, endAt: Date, now: Date) => boolean,
    context?: { traceId?: string },
  ): Promise<CheckinOutcome>;
  reveal(venueId: string, dateId: string, context?: { traceId?: string }): Promise<RevealOutcome>;
}

interface DateRow {
  user_a: string;
  user_b: string;
  venue_id: string | null;
  status: DateState;
  machine_version: number;
  revision: number;
  machine_context: Partial<DateRecord>;
  start_at: Date | null;
  end_at: Date | null;
}

async function lockDate(db: Queryable, dateId: string): Promise<DateRow | undefined> {
  const { rows } = await db.query<DateRow>(
    `SELECT user_a, user_b, venue_id, status, machine_version, revision, machine_context,
            start_at, end_at
     FROM app.dates WHERE id = $1 FOR UPDATE`,
    [dateId],
  );
  return rows[0];
}

const venueAudit = (
  tx: AuditedTransaction,
  action: string,
  venueId: string,
  dateId: string,
  metadata: Record<string, unknown> = {},
) =>
  tx.audit({
    actorType: "merchant",
    actorId: venueId,
    action,
    objectType: "date",
    objectId: dateId,
    metadata,
  });

const MERCHANT = { kind: "merchant" } as const;

export function pgCheckinRepository(pool: TransactionPool & Queryable): CheckinRepository {
  return {
    async ownCheckin(userId, dateId) {
      const { rows } = await pool.query<{
        party: Party;
        status: DateState;
        start_at: Date | null;
        end_at: Date | null;
        checked_in: boolean;
      }>(
        `SELECT CASE WHEN d.user_a = $1 THEN 'A' ELSE 'B' END AS party,
                d.status, d.start_at, d.end_at,
                EXISTS (SELECT 1 FROM app.checkins c WHERE c.date_id = d.id AND c.user_id = $1)
                  AS checked_in
         FROM app.dates d WHERE d.id = $2 AND (d.user_a = $1 OR d.user_b = $1)`,
        [userId, dateId],
      );
      const row = rows[0];
      if (row === undefined || row.start_at === null || row.end_at === null) return null;
      return {
        party: row.party,
        startAt: row.start_at,
        endAt: row.end_at,
        showing: SHOWING.includes(row.status),
        checkedIn: row.checked_in,
      };
    },

    async deviceVenue(keyHash) {
      const { rows } = await pool.query<{ venue_id: string }>(
        `SELECT d.venue_id FROM app.venue_devices d JOIN app.venues v ON v.id = d.venue_id
         WHERE d.key_hash = $1 AND d.revoked_at IS NULL AND v.status = 'active'`,
        [keyHash],
      );
      return rows[0]?.venue_id ?? null;
    },

    registerDevice: (venueId, label, keyHash, context = {}) =>
      inAuditedTransaction(
        pool,
        async (tx) => {
          const { rows } = await tx.db.query<{ id: string }>(
            `INSERT INTO app.venue_devices (venue_id, label, key_hash) VALUES ($1, $2, $3)
             RETURNING id`,
            [venueId, label, keyHash],
          );
          const id = rows[0]?.id ?? "";
          await tx.audit({
            actorType: "staff",
            actorId: null,
            action: "venue.device.registered",
            objectType: "venue",
            objectId: venueId,
            metadata: { device_id: id },
          });
          return id;
        },
        context,
      ),

    revokeDevice: (deviceId, context = {}) =>
      inAuditedTransaction(
        pool,
        async (tx) => {
          const { rows } = await tx.db.query<{ venue_id: string }>(
            `UPDATE app.venue_devices SET revoked_at = now()
             WHERE id = $1 AND revoked_at IS NULL RETURNING venue_id`,
            [deviceId],
          );
          await tx.audit({
            actorType: "staff",
            actorId: null,
            action: rows.length > 0 ? "venue.device.revoked" : "venue.device.revoke_unchanged",
            objectType: "venue_device",
            objectId: deviceId,
          });
          return rows.length > 0;
        },
        context,
      ),

    checkIn: (venueId, dateId, party, now, isOpen, context = {}) =>
      inAuditedTransaction(
        pool,
        async (tx): Promise<CheckinOutcome> => {
          const row = await lockDate(tx.db, dateId);
          if (row?.venue_id !== venueId) {
            await venueAudit(tx, "date.checkin.refused", venueId, dateId, {
              reason: "not_found",
            });
            return { kind: "not_found" };
          }
          if (
            row.start_at === null ||
            row.end_at === null ||
            !isOpen(row.start_at, row.end_at, now)
          ) {
            await venueAudit(tx, "date.checkin.refused", venueId, dateId, { reason: "closed" });
            return { kind: "closed" };
          }
          const current = toDate(row);
          const result = transition(current, { type: "PARTY_CHECKED_IN", party }, MERCHANT);
          if (!result.ok) {
            await venueAudit(tx, "date.checkin.refused", venueId, dateId, {
              reason: result.error.code,
              state: current.state,
            });
            return { kind: "refused" };
          }
          if (result.changed) {
            await saveDate(tx.db, dateId, result.date, current.revision);
            await tx.db.query(
              `INSERT INTO app.checkins (date_id, user_id, method, verified_at, venue_attested)
               VALUES ($1, $2, 'qr', $3, true)
               ON CONFLICT (date_id, user_id) DO NOTHING`,
              [dateId, party === "A" ? row.user_a : row.user_b, now],
            );
          }
          const both = result.date.state === "BOTH_CHECKED_IN";
          await venueAudit(tx, "date.checkin.recorded", venueId, dateId, {
            party,
            repeated: !result.changed,
            state: result.date.state,
          });
          return { kind: "checked_in", both, repeated: !result.changed };
        },
        context,
      ),

    reveal: (venueId, dateId, context = {}) =>
      inAuditedTransaction(
        pool,
        async (tx): Promise<RevealOutcome> => {
          const row = await lockDate(tx.db, dateId);
          if (row?.venue_id !== venueId) {
            await venueAudit(tx, "date.reveal.refused", venueId, dateId, { reason: "not_found" });
            return { kind: "not_found" };
          }
          const current = toDate(row);
          if (current.state === "REVEALED") {
            await venueAudit(tx, "date.reveal.repeated", venueId, dateId);
            return { kind: "revealed", repeated: true };
          }
          const result = transition(current, { type: "REVEAL" }, MERCHANT);
          if (!result.ok) {
            await venueAudit(tx, "date.reveal.refused", venueId, dateId, {
              reason: result.error.code,
              state: current.state,
            });
            return { kind: "waiting" };
          }
          await saveDate(tx.db, dateId, result.date, current.revision);
          await venueAudit(tx, "date.revealed", venueId, dateId);
          return { kind: "revealed", repeated: false };
        },
        context,
      ),
  };
}
