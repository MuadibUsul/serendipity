/**
 * Choosing where and when a matched pair meets (PLAN-001 P03-10): the venue
 * side of the agents' negotiation, done deterministically. Agents may talk
 * about what each person likes; the choice itself is this function, so it
 * is explainable, repeatable and never invents a table.
 *
 * A slot is possible only when all of these hold:
 * - it is open and has a free table;
 * - it starts at least `leadHours` from now and within `horizonDays`;
 * - it falls wholly inside a weekly window of each person, in the market's
 *   local time;
 * - its price per person is within each person's budget (the hard rule);
 * - its venue serves everyone's dietary needs (`suitableVenues`);
 * - both can reach its venue within their tolerance (`fairVenues`).
 *
 * Among the possible slots: the soonest day first, so a match does not go
 * cold; on that day the fairest venue; then the earliest start.
 *
 * What comes back is the chosen venue and slot, or why there is none, as a
 * reason for the system (`no_common_time` or `no_venue`). It never says
 * whose window, budget, diet or journey ruled a slot out, so the answer
 * cannot be traced back to either person.
 */
import { MARKET } from "@serendipity/market";
import { mergedDay } from "@serendipity/matching";
import type { Weekday, WeeklyWindow } from "@serendipity/matching";
import type { DietaryRestriction } from "@serendipity/profile";

import { fairVenues } from "./commute.js";
import type { CommuteEstimate, Traveller } from "./commute.js";
import { suitableVenues } from "./dietary.js";
import type { DietaryOffer } from "./dietary.js";

/** A venue's listing, as the planner reads it. */
export interface VenueListing extends DietaryOffer {
  readonly id: string;
  /** What a date there costs each person, in minor units of the market currency. */
  readonly pricePerPersonMinor: number;
}

/** One bookable slot. */
export interface SlotOffer {
  readonly id: string;
  readonly venueId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  /** A table is still free (`reserved < capacity`, status `open`). */
  readonly free: boolean;
}

/** One person, as only the planner sees them. */
export interface PlanPerson {
  readonly traveller: Traveller;
  readonly windows: readonly WeeklyWindow[];
  /** `date.budget_per_person` in minor units, or `null` for no ceiling given. */
  readonly budgetMinor: number | null;
  /** Read through `dietaryNeedsOf`, so only with the consent. */
  readonly dietary: readonly DietaryRestriction[];
}

export interface PlanInput {
  readonly a: PlanPerson;
  readonly b: PlanPerson;
  /** How well the two fit, 0 to 1: stretches travel tolerance (ADR-0017). */
  readonly fit: number;
  readonly venues: readonly VenueListing[];
  readonly slots: readonly SlotOffer[];
  readonly estimate: CommuteEstimate;
  readonly now: Date;
  readonly timeZone?: string;
  readonly leadHours?: number;
  readonly horizonDays?: number;
}

export type Plan =
  | { readonly ok: true; readonly venueId: string; readonly slotId: string }
  | { readonly ok: false; readonly reason: "no_common_time" | "no_venue" };

/** A date is planned at least this far ahead, so both can arrange their day. */
export const DEFAULT_LEAD_HOURS = 24;
/** And no further ahead than this. */
export const DEFAULT_HORIZON_DAYS = 14;

const HOUR_MS = 60 * 60 * 1000;

interface Local {
  /** YYYY-MM-DD. */
  readonly date: string;
  readonly day: Weekday;
  /** Minutes after local midnight. */
  readonly minute: number;
}

function localOf(at: Date, timeZone: string): Local {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  const day = part("weekday").toLowerCase().slice(0, 3) as Local["day"];
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    day,
    minute: Number(part("hour")) * 60 + Number(part("minute")),
  };
}

/** Whether the slot lies wholly inside one of the person's (merged) windows on its day. */
function withinWindows(
  windows: readonly WeeklyWindow[],
  slot: SlotOffer,
  timeZone: string,
): boolean {
  const start = localOf(slot.startsAt, timeZone);
  const end = localOf(slot.endsAt, timeZone);
  // A slot past local midnight fits no single day's window.
  if (end.date !== start.date) return false;
  return mergedDay(windows, start.day).some(
    (window) => window.from <= start.minute && end.minute <= window.to,
  );
}

const affordable = (budget: number | null, price: number) => budget === null || price <= budget;

export function planDate(input: PlanInput): Plan {
  const timeZone = input.timeZone ?? MARKET.timeZone;
  const earliest = input.now.getTime() + (input.leadHours ?? DEFAULT_LEAD_HOURS) * HOUR_MS;
  const latest = input.now.getTime() + (input.horizonDays ?? DEFAULT_HORIZON_DAYS) * 24 * HOUR_MS;

  const timed = input.slots.filter(
    (slot) =>
      slot.free &&
      slot.startsAt.getTime() >= earliest &&
      slot.startsAt.getTime() <= latest &&
      slot.endsAt > slot.startsAt &&
      withinWindows(input.a.windows, slot, timeZone) &&
      withinWindows(input.b.windows, slot, timeZone),
  );
  if (timed.length === 0) return { ok: false, reason: "no_common_time" };

  const affordableVenues = input.venues.filter(
    (venue) =>
      Number.isFinite(venue.pricePerPersonMinor) &&
      affordable(input.a.budgetMinor, venue.pricePerPersonMinor) &&
      affordable(input.b.budgetMinor, venue.pricePerPersonMinor),
  );
  const served = suitableVenues(affordableVenues, [input.a.dietary, input.b.dietary]);
  const fair = fairVenues(served, input.a.traveller, input.b.traveller, input.fit, input.estimate);
  const rank = new Map(fair.map((venue, index) => [venue.id, index]));

  const possible = timed
    .filter((slot) => rank.has(slot.venueId))
    .map((slot) => ({
      slot,
      date: localOf(slot.startsAt, timeZone).date,
      rank: rank.get(slot.venueId) ?? Number.POSITIVE_INFINITY,
    }));
  if (possible.length === 0) return { ok: false, reason: "no_venue" };
  possible.sort(
    (x, y) =>
      (x.date < y.date ? -1 : x.date > y.date ? 1 : 0) ||
      x.rank - y.rank ||
      x.slot.startsAt.getTime() - y.slot.startsAt.getTime() ||
      (x.slot.id < y.slot.id ? -1 : x.slot.id > y.slot.id ? 1 : 0),
  );
  const chosen = possible[0];
  if (chosen === undefined) return { ok: false, reason: "no_venue" };
  return { ok: true, venueId: chosen.slot.venueId, slotId: chosen.slot.id };
}
