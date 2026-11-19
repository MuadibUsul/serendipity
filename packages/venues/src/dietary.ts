/**
 * The dietary filter (CHG-001 D4): the one place dietary restrictions are
 * read. They rule venues out; they never rule people out, and nothing here
 * says which restriction excluded a venue, so neither person can learn the
 * other's restrictions from the venues left.
 *
 * A restriction is read only while the person holds the
 * `dietary_restrictions` consent: after it is revoked, the next call sees
 * none.
 */
import { DIETARY_RESTRICTIONS, withConsent } from "@serendipity/profile";
import type { DietaryRestriction, Facts, GrantedScopes } from "@serendipity/profile";

/** What a venue can serve, from its reviewed listing (P04-03a). */
export interface DietaryOffer {
  readonly accommodates: readonly DietaryRestriction[];
}

/**
 * A venue that accommodates the key also accommodates these. Kept small and
 * conservative: when in doubt, a restriction is satisfied only by itself.
 */
const ALSO_SATISFIES: Readonly<Partial<Record<DietaryRestriction, readonly DietaryRestriction[]>>> =
  {
    vegan: ["vegetarian", "lactose_free", "egg_allergy"],
    halal: ["no_pork"],
    kosher: ["no_pork", "shellfish_allergy"],
  };

const KNOWN = new Set<string>(DIETARY_RESTRICTIONS);

/** The person's dietary restrictions, if they hold the consent; none otherwise. */
export function dietaryNeedsOf(facts: Facts, granted: GrantedScopes): DietaryRestriction[] {
  const value = withConsent(facts, granted).get("date.dietary_restrictions")?.value;
  if (!Array.isArray(value)) return [];
  return (value as readonly unknown[]).filter(
    (item): item is DietaryRestriction => typeof item === "string" && KNOWN.has(item),
  );
}

/** Everything a venue's listing accommodates, implied ones included. */
export function accommodated(offer: DietaryOffer): ReadonlySet<DietaryRestriction> {
  return new Set(offer.accommodates.flatMap((item) => [item, ...(ALSO_SATISFIES[item] ?? [])]));
}

/**
 * The venues that suit everyone at the date. Each person's needs are passed
 * separately and never returned; the order of `venues` is kept.
 */
export function suitableVenues<V extends DietaryOffer>(
  venues: readonly V[],
  needs: readonly (readonly DietaryRestriction[])[],
): V[] {
  const required = new Set(needs.flat());
  return venues.filter((venue) => {
    const served = accommodated(venue);
    return [...required].every((need) => served.has(need));
  });
}
