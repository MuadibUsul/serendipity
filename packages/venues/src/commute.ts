/**
 * Fair travel for a date (CHG-001 D12, ADR-0017). Distance is a soft
 * preference, not a rule about people:
 *
 * - Each person gives a coarse home area (a district, never an address) and
 *   how long they are happy to travel.
 * - That tolerance stretches for a pair that fits well, by up to
 *   `MAX_FIT_STRETCH`. "Fits well" is how well the two of them fit each
 *   other, never a notion of one person's worth.
 * - Among the venues both can reach within their tolerance, the fairest one
 *   keeps the longer of the two journeys as short as possible.
 *
 * Privacy: home areas are seen only by this function and the person's own
 * agent. What comes back is the venues, in order, and nothing else: no
 * areas, no journey times. So neither person, nor the other's agent, can
 * work out where the other lives.
 */

/** The tolerance used when a person has not said. */
export const DEFAULT_COMMUTE_MINUTES = 45;

/** At a perfect fit, a person's tolerance stretches by this share (+50%). */
export const MAX_FIT_STRETCH = 0.5;

/** One person, as only the venue negotiation sees them. */
export interface Traveller {
  /** `self.home_area`, or `null` when the person has not given one. */
  readonly area: string | null;
  /** `date.max_commute_minutes`, or `null` for the default. */
  readonly maxCommuteMinutes: number | null;
}

/** Minutes from an area to a venue by public transport, or `null` when unknown. */
export type CommuteEstimate = (area: string, venueId: string) => number | null;

const clampFit = (fit: number) => (Number.isFinite(fit) ? Math.min(1, Math.max(0, fit)) : 0);

/** How long this person will travel for this pair: their tolerance, stretched by fit. */
export function toleranceFor(maxCommuteMinutes: number | null, fit: number): number {
  return (maxCommuteMinutes ?? DEFAULT_COMMUTE_MINUTES) * (1 + MAX_FIT_STRETCH * clampFit(fit));
}

/**
 * The cost of a venue for a pair: the longer of the two journeys, or `null`
 * when either is beyond that person's tolerance. A journey of `undefined`
 * belongs to a person without a home area: it constrains nothing.
 */
export function pairCommuteCost(
  minutesA: number | undefined,
  minutesB: number | undefined,
  toleranceA: number,
  toleranceB: number,
): number | null {
  if (minutesA !== undefined && !(minutesA <= toleranceA)) return null;
  if (minutesB !== undefined && !(minutesB <= toleranceB)) return null;
  return Math.max(minutesA ?? 0, minutesB ?? 0);
}

/**
 * The venues both people can reach, fairest first: the shorter the longer
 * journey, the better; then the shorter the two together; then the order
 * given. A venue with no known route from a person's area is left out.
 * Returns the venues only.
 */
export function fairVenues<V extends { readonly id: string }>(
  venues: readonly V[],
  a: Traveller,
  b: Traveller,
  fit: number,
  estimate: CommuteEstimate,
): V[] {
  const toleranceA = toleranceFor(a.maxCommuteMinutes, fit);
  const toleranceB = toleranceFor(b.maxCommuteMinutes, fit);
  const journey = (area: string | null, venueId: string): number | undefined | null =>
    area === null ? undefined : estimate(area, venueId);

  const ranked: { venue: V; cost: number; total: number; index: number }[] = [];
  venues.forEach((venue, index) => {
    const minutesA = journey(a.area, venue.id);
    const minutesB = journey(b.area, venue.id);
    if (minutesA === null || minutesB === null) return;
    const cost = pairCommuteCost(minutesA, minutesB, toleranceA, toleranceB);
    if (cost === null) return;
    ranked.push({ venue, cost, total: (minutesA ?? 0) + (minutesB ?? 0), index });
  });
  ranked.sort((x, y) => x.cost - y.cost || x.total - y.total || x.index - y.index);
  return ranked.map((entry) => entry.venue);
}
