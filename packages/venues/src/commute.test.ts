import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { DEFAULT_COMMUTE_MINUTES, fairVenues, pairCommuteCost, toleranceFor } from "./commute.js";
import type { CommuteEstimate, Traveller } from "./commute.js";

// Journey times in minutes from two fictional areas.
const TIMES: Record<string, Record<string, number>> = {
  SFB_TIANHE: { north: 10, middle: 25, south: 50, far: 80 },
  SFB_HAIZHU: { north: 55, middle: 25, south: 15, far: 90 },
};
const estimate: CommuteEstimate = (area, venue) => TIMES[area]?.[venue] ?? null;
const VENUES = ["north", "middle", "south", "far", "unrouted"].map((id) => ({ id }));
const ana: Traveller = { area: "SFB_TIANHE", maxCommuteMinutes: 40 };
const bo: Traveller = { area: "SFB_HAIZHU", maxCommuteMinutes: 40 };
const ids = (venues: readonly { id: string }[]) => venues.map((venue) => venue.id);

describe("toleranceFor", () => {
  it("is the stated tolerance at no fit, and up to half as much again at a perfect fit", () => {
    expect(toleranceFor(40, 0)).toBe(40);
    expect(toleranceFor(40, 1)).toBe(60);
    expect(toleranceFor(null, 0)).toBe(DEFAULT_COMMUTE_MINUTES);
  });

  it("treats fit outside 0..1, or not a number, as its nearest sane value", () => {
    expect(toleranceFor(40, 7)).toBe(60);
    expect(toleranceFor(40, -1)).toBe(40);
    expect(toleranceFor(40, Number.NaN)).toBe(40);
  });
});

describe("pairCommuteCost", () => {
  it("is the longer journey, when both are within tolerance", () => {
    expect(pairCommuteCost(10, 30, 40, 40)).toBe(30);
    expect(pairCommuteCost(41, 10, 40, 40)).toBeNull();
    expect(pairCommuteCost(undefined, 30, 40, 40)).toBe(30);
  });
});

describe("fairVenues", () => {
  it("keeps the longer journey short: the middle venue before the one near either person", () => {
    expect(ids(fairVenues(VENUES, ana, bo, 0, estimate))).toEqual(["middle"]);
  });

  it("stretches what both will travel for a pair that fits well", () => {
    expect(ids(fairVenues(VENUES, ana, bo, 1, estimate))).toEqual(["middle", "south", "north"]);
  });

  it("leaves out a venue with no known route", () => {
    expect(ids(fairVenues(VENUES, ana, bo, 1, estimate))).not.toContain("unrouted");
  });

  it("returns the venues themselves and nothing about where anyone lives or how far they travel", () => {
    const chosen = fairVenues(VENUES, ana, bo, 1, estimate);
    for (const venue of chosen) expect(VENUES).toContain(venue);
    const text = JSON.stringify(chosen);
    expect(text).not.toMatch(/SFB_|TIANHE|HAIZHU|\d/);
  });

  const area = fc.constantFrom("A1_ZONE", "B2_ZONE", "C3_ZONE", null);
  const traveller = fc.record({
    area,
    maxCommuteMinutes: fc.option(fc.integer({ min: 10, max: 120 }), { nil: null }),
  });
  const table = fc.dictionary(
    fc.constantFrom("A1_ZONE", "B2_ZONE", "C3_ZONE"),
    fc.dictionary(fc.constantFrom("v1", "v2", "v3", "v4", "v5"), fc.integer({ min: 1, max: 150 })),
  );
  const venues = fc
    .uniqueArray(fc.constantFrom("v1", "v2", "v3", "v4", "v5"), { minLength: 1 })
    .map((list) => list.map((id) => ({ id })));
  const fit = fc.double({ min: 0, max: 1, noNaN: true });
  const from =
    (t: Record<string, Record<string, number>>): CommuteEstimate =>
    (a, v) =>
      t[a]?.[v] ?? null;

  it("is symmetric: swapping the two people gives the same venues in the same order", () => {
    fc.assert(
      fc.property(venues, traveller, traveller, fit, table, (list, a, b, f, t) => {
        expect(fairVenues(list, a, b, f, from(t))).toEqual(fairVenues(list, b, a, f, from(t)));
      }),
    );
  });

  it("is monotone in fit: a better fit never loses a venue", () => {
    fc.assert(
      fc.property(venues, traveller, traveller, fit, fit, table, (list, a, b, f1, f2, t) => {
        const [low, high] = f1 <= f2 ? [f1, f2] : [f2, f1];
        const fewer = ids(fairVenues(list, a, b, low, from(t)));
        const more = ids(fairVenues(list, a, b, high, from(t)));
        for (const id of fewer) expect(more).toContain(id);
      }),
    );
  });

  it("puts first a venue whose longer journey is no longer than any other's", () => {
    fc.assert(
      fc.property(venues, traveller, traveller, fit, table, (list, a, b, f, t) => {
        const est = from(t);
        const longer = (id: string) =>
          Math.max(
            a.area === null ? 0 : (est(a.area, id) ?? Infinity),
            b.area === null ? 0 : (est(b.area, id) ?? Infinity),
          );
        const chosen = ids(fairVenues(list, a, b, f, est));
        for (let i = 1; i < chosen.length; i += 1) {
          expect(longer(chosen[i - 1] ?? "")).toBeLessThanOrEqual(longer(chosen[i] ?? ""));
        }
        for (const id of chosen) {
          if (a.area !== null)
            expect(est(a.area, id)).toBeLessThanOrEqual(toleranceFor(a.maxCommuteMinutes, f));
          if (b.area !== null)
            expect(est(b.area, id)).toBeLessThanOrEqual(toleranceFor(b.maxCommuteMinutes, f));
        }
      }),
    );
  });
});
