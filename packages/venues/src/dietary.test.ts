import { DIETARY_RESTRICTIONS, NO_FACTS, applyProposals } from "@serendipity/profile";
import type { DietaryRestriction, GrantedScopes } from "@serendipity/profile";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { accommodated, dietaryNeedsOf, suitableVenues } from "./dietary.js";

const NOW = new Date("2026-11-19T08:00:00Z");
const CONSENTED: GrantedScopes = new Set(["dietary_restrictions"]);

const factsWith = (diet: DietaryRestriction[]) =>
  applyProposals(
    NO_FACTS,
    [{ key: "date.dietary_restrictions", value: diet, provenance: "explicit", certainty: "high" }],
    NOW,
    CONSENTED,
  ).facts;

const venue = (id: string, accommodates: DietaryRestriction[]) => ({ id, accommodates });

describe("dietaryNeedsOf", () => {
  it("reads the restrictions while the person holds the consent", () => {
    expect(dietaryNeedsOf(factsWith(["halal", "nut_allergy"]), CONSENTED)).toEqual([
      "halal",
      "nut_allergy",
    ]);
  });

  it("reads nothing once the consent is revoked", () => {
    expect(dietaryNeedsOf(factsWith(["halal"]), new Set())).toEqual([]);
  });

  it("reads nothing when there are none", () => {
    expect(dietaryNeedsOf(NO_FACTS, CONSENTED)).toEqual([]);
  });
});

describe("suitableVenues", () => {
  const venues = [
    venue("noodles", []),
    venue("green", ["vegan", "gluten_free"]),
    venue("crescent", ["halal"]),
    venue("garden", ["vegetarian", "halal", "nut_allergy"]),
  ];

  it("keeps every venue when nobody has restrictions", () => {
    expect(suitableVenues(venues, [[], []])).toEqual(venues);
  });

  it("keeps only venues that suit both people, in order", () => {
    expect(suitableVenues(venues, [["vegetarian"], ["halal"]]).map((v) => v.id)).toEqual([
      "garden",
    ]);
  });

  it("counts what a venue implies: vegan serves vegetarians, halal serves no pork", () => {
    expect(suitableVenues(venues, [["vegetarian"], []]).map((v) => v.id)).toEqual([
      "green",
      "garden",
    ]);
    expect(suitableVenues(venues, [["no_pork"]]).map((v) => v.id)).toEqual(["crescent", "garden"]);
  });

  it("implies only what is certain, and nothing else", () => {
    const implied = Object.fromEntries(
      DIETARY_RESTRICTIONS.map((item) => [
        item,
        [...accommodated({ accommodates: [item] })].sort(),
      ]),
    );
    expect(
      Object.entries(implied).filter(([item, set]) => set.length > 1 || set[0] !== item),
    ).toEqual([
      ["vegan", ["egg_allergy", "lactose_free", "vegan", "vegetarian"]],
      ["halal", ["halal", "no_pork"]],
      ["kosher", ["kosher", "no_pork", "shellfish_allergy"]],
    ]);
  });

  const restriction = fc.constantFrom(...DIETARY_RESTRICTIONS);
  const venuesArb = fc.array(
    fc.record({ id: fc.uuid(), accommodates: fc.uniqueArray(restriction, { maxLength: 5 }) }),
    { maxLength: 8 },
  );

  it("never keeps a venue that misses someone's restriction", () => {
    fc.assert(
      fc.property(
        venuesArb,
        fc.array(fc.uniqueArray(restriction, { maxLength: 3 }), { maxLength: 3 }),
        (list, needs) => {
          for (const kept of suitableVenues(list, needs)) {
            const served = accommodated(kept);
            for (const need of needs.flat()) expect(served.has(need)).toBe(true);
          }
        },
      ),
    );
  });

  it("depends only on everyone's needs together, so it cannot tell whose need excluded a venue", () => {
    fc.assert(
      fc.property(
        venuesArb,
        fc.uniqueArray(restriction, { maxLength: 4 }),
        fc.nat(4),
        (list, all, cut) => {
          const split = [all.slice(0, cut), all.slice(cut)];
          expect(suitableVenues(list, split)).toEqual(suitableVenues(list, [all]));
          expect(suitableVenues(list, [split[1] ?? [], split[0] ?? []])).toEqual(
            suitableVenues(list, [all]),
          );
        },
      ),
    );
  });
});
