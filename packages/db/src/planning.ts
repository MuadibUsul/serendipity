// Planning a matched pair's date (P03-10, ADR-0027): reads what the planner
// needs, runs @serendipity/venues' planDate, and records the date in DRAFT
// with its venue, slot and time, as the application role. The verifier
// (P03-07) then moves it to ELIGIBLE and the booking saga sends invitations.
//
// The planner's inputs (windows, budgets, home areas, travel tolerance,
// dietary needs) are read here and never written anywhere: the date row
// holds only the choice, and the audit only whether one was found.
import { SCOPES } from "@serendipity/consent";
import { MARKET, travelMinutes } from "@serendipity/market";
import { readHardRules } from "@serendipity/matching";
import { DIETARY_RESTRICTIONS } from "@serendipity/profile";
import type { DietaryRestriction } from "@serendipity/profile";
import { planDate } from "@serendipity/venues";
import type { PlanPerson, SlotOffer, VenueListing } from "@serendipity/venues";

import { inAuditedTransaction } from "./audit.js";
import type { AuditedTransaction, TransactionPool } from "./audit.js";
import type { Queryable } from "./queryable.js";

export type PlanOutcome =
  | { readonly kind: "planned"; readonly dateId: string }
  /** No slot both can make, or no venue that suits both: tried again with new slots later. */
  | { readonly kind: "no_plan"; readonly reason: "no_common_time" | "no_venue" }
  | {
      readonly kind: "refused";
      readonly refusal: "not_found" | "not_passed" | "already_planned" | "profile_unreadable";
    };

export interface DatePlanner {
  /**
   * Plans the date for a candidate pair whose negotiation ended in PASS.
   * `fit` (0 to 1) is how well the two fit, from ranking: it stretches
   * travel tolerance, never anything else.
   */
  planForPair(
    pairId: string,
    fit: number,
    now: Date,
    context?: { traceId?: string },
  ): Promise<PlanOutcome>;
}

const KNOWN_DIETARY = new Set<string>(DIETARY_RESTRICTIONS);

async function personFor(db: Queryable, userId: string): Promise<PlanPerson | null> {
  const version = await db.query<{ structured_json: unknown }>(
    `SELECT structured_json FROM app.profile_versions
     WHERE user_id = $1 AND approval_state = 'approved'`,
    [userId],
  );
  const rules = readHardRules(version.rows[0]?.structured_json ?? null);
  if (!rules.ok || rules.rules.budgetPerPerson.currency !== MARKET.currency) return null;
  const facts = await db.query<{ key: string; value: unknown }>(
    `SELECT f.key, f.value FROM app.profile_facts f
     JOIN app.profile_versions v ON v.id = f.profile_version_id
     WHERE v.user_id = $1 AND v.approval_state = 'approved'
       AND f.key IN ('self.home_area', 'date.max_commute_minutes', 'date.dietary_restrictions')`,
    [userId],
  );
  const value = (key: string) => facts.rows.find((row) => row.key === key)?.value;
  // Dietary needs only while the person holds the dietary consent (CHG-001 D4).
  const consent = await db.query(
    `SELECT 1 FROM app.consent_grants
     WHERE user_id = $1 AND scope = 'dietary_restrictions' AND revoked_at IS NULL
       AND version >= $2`,
    [userId, SCOPES.dietary_restrictions.minimumVersion],
  );
  const rawDietary = (consent.rowCount ?? 0) > 0 ? value("date.dietary_restrictions") : undefined;
  const dietary = Array.isArray(rawDietary)
    ? (rawDietary as unknown[]).filter(
        (item): item is DietaryRestriction => typeof item === "string" && KNOWN_DIETARY.has(item),
      )
    : [];
  const area = value("self.home_area");
  const commute = value("date.max_commute_minutes");
  return {
    traveller: {
      area: typeof area === "string" ? area : null,
      maxCommuteMinutes: typeof commute === "number" ? commute : null,
    },
    windows: rules.rules.availability,
    budgetMinor: rules.rules.budgetPerPerson.minor,
    dietary,
  };
}

const audit = (
  tx: AuditedTransaction,
  action: string,
  pairId: string,
  metadata: Record<string, unknown> = {},
) =>
  tx.audit({
    actorType: "system",
    actorId: null,
    action,
    objectType: "candidate_pair",
    objectId: pairId,
    metadata,
  });

export function pgDatePlanner(pool: TransactionPool & Queryable): DatePlanner {
  return {
    planForPair: (pairId, fit, now, context = {}) =>
      inAuditedTransaction(
        pool,
        async (tx): Promise<PlanOutcome> => {
          const refuse = async (refusal: Extract<PlanOutcome, { kind: "refused" }>["refusal"]) => {
            await audit(tx, "date.plan.refused", pairId, { refusal });
            return { kind: "refused", refusal } as const;
          };
          const pair = await tx.db.query<{ user_a: string; user_b: string }>(
            "SELECT user_a, user_b FROM app.candidate_pairs WHERE id = $1 FOR UPDATE",
            [pairId],
          );
          const people = pair.rows[0];
          if (people === undefined) return refuse("not_found");
          const verdict = await tx.db.query<{ status: string }>(
            `SELECT status FROM app.negotiations WHERE candidate_pair_id = $1
             ORDER BY attempt DESC LIMIT 1`,
            [pairId],
          );
          if (verdict.rows[0]?.status !== "PASS") return refuse("not_passed");
          const existing = await tx.db.query(
            "SELECT 1 FROM app.dates WHERE candidate_pair_id = $1",
            [pairId],
          );
          if ((existing.rowCount ?? 0) > 0) return refuse("already_planned");
          const a = await personFor(tx.db, people.user_a);
          const b = await personFor(tx.db, people.user_b);
          if (a === null || b === null) return refuse("profile_unreadable");

          const venues = await tx.db.query<{
            id: string;
            area: string;
            price_per_person_minor: number;
            accommodates: string[];
          }>(
            `SELECT id, area, price_per_person_minor, accommodates FROM app.venues
             WHERE status = 'active' AND region = $1
               AND area IS NOT NULL AND price_per_person_minor IS NOT NULL`,
            [MARKET.region],
          );
          const areaOf = new Map(venues.rows.map((row) => [row.id, row.area]));
          const listings: VenueListing[] = venues.rows.map((row) => ({
            id: row.id,
            pricePerPersonMinor: row.price_per_person_minor,
            accommodates: row.accommodates.filter((item): item is DietaryRestriction =>
              KNOWN_DIETARY.has(item),
            ),
          }));
          const slots = await tx.db.query<{
            id: string;
            venue_id: string;
            starts_at: Date;
            ends_at: Date;
            free: boolean;
          }>(
            `SELECT s.id, s.venue_id, s.starts_at, s.ends_at,
                    (s.status = 'open' AND s.reserved < s.capacity) AS free
             FROM app.venue_slots s
             WHERE s.venue_id = ANY($1::uuid[]) AND s.starts_at > $2`,
            [listings.map((listing) => listing.id), now],
          );
          const offers: SlotOffer[] = slots.rows.map((row) => ({
            id: row.id,
            venueId: row.venue_id,
            startsAt: row.starts_at,
            endsAt: row.ends_at,
            free: row.free,
          }));
          const plan = planDate({
            a,
            b,
            fit,
            venues: listings,
            slots: offers,
            estimate: (area, venueId) => {
              const venueArea = areaOf.get(venueId);
              return venueArea === undefined ? null : travelMinutes(area, venueArea);
            },
            now,
          });
          if (!plan.ok) {
            await audit(tx, "date.plan.none", pairId, { reason: plan.reason });
            return { kind: "no_plan", reason: plan.reason };
          }
          const chosen = offers.find((offer) => offer.id === plan.slotId);
          if (chosen === undefined) throw new Error("planning: the chosen slot vanished");
          const inserted = await tx.db.query<{ id: string }>(
            `INSERT INTO app.dates
               (user_a, user_b, candidate_pair_id, venue_id, venue_slot_id, start_at, end_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [
              people.user_a,
              people.user_b,
              pairId,
              plan.venueId,
              plan.slotId,
              chosen.startsAt,
              chosen.endsAt,
            ],
          );
          const dateId = inserted.rows[0]?.id ?? "";
          await tx.audit({
            actorType: "system",
            actorId: null,
            action: "date.planned",
            objectType: "date",
            objectId: dateId,
            metadata: { candidate_pair_id: pairId, venue_id: plan.venueId },
          });
          return { kind: "planned", dateId };
        },
        context,
      ),
  };
}
