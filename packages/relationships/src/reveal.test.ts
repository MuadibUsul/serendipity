import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  CARDS_PER_DAY,
  DEFAULT_SETTINGS,
  deckOf,
  faceDown,
  flipRefusal,
  startOfDay,
  stillShown,
} from "./reveal.js";
import type { FlipState } from "./reveal.js";

const facts = new Map<string, unknown>([
  ["self.interests", ["jazz", "hiking"]],
  ["date.cuisines", [{ tag: "cantonese", weight: 3 }]],
  ["date.price_band", "moderate"],
  ["self.home_area", "GZ_TIANHE"],
  ["seeking.age_range", { min: 25, max: 35 }],
  ["date.dietary_restrictions", ["halal"]],
]);

describe("deckOf", () => {
  it("holds one card per soft item, never sensitive or practical facts", () => {
    expect(deckOf(facts, DEFAULT_SETTINGS)).toEqual([
      { category: "self.interests", item: "hiking" },
      { category: "self.interests", item: "jazz" },
      { category: "date.cuisines", item: "cantonese" },
    ]);
  });

  it("adds dietary restrictions only when the owner puts them in and holds the dietary consent", () => {
    const opted = { ...DEFAULT_SETTINGS, included: ["date.dietary_restrictions" as const] };
    expect(deckOf(facts, opted)).not.toContainEqual(
      expect.objectContaining({ category: "date.dietary_restrictions" }),
    );
    expect(deckOf(facts, { ...opted, dietaryConsent: true })).toContainEqual({
      category: "date.dietary_restrictions",
      item: "halal",
    });
  });

  it("lets the owner take a category out", () => {
    const deck = deckOf(facts, { ...DEFAULT_SETTINGS, excluded: ["self.interests"] });
    expect(deck.map((card) => card.category)).toEqual(["date.cuisines"]);
  });

  it("never contains a fact outside the allowed categories, whatever the profile holds", () => {
    const allowed = new Set([
      "self.interests",
      "self.communication_style",
      "self.lifestyle",
      "date.cuisines",
      "date.tastes",
      "date.atmosphere",
      "date.dietary_restrictions",
    ]);
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.string({ maxLength: 30 }),
          fc.array(fc.string({ maxLength: 8 }), { maxLength: 4 }),
        ),
        fc.boolean(),
        (raw, diet) => {
          const deck = deckOf(new Map(Object.entries(raw)), {
            excluded: [],
            included: ["date.dietary_restrictions"],
            dietaryConsent: diet,
          });
          for (const card of deck) expect(allowed.has(card.category)).toBe(true);
        },
      ),
    );
  });
});

describe("what the viewer sees", () => {
  const deck = deckOf(facts, DEFAULT_SETTINGS);
  const seen = [{ category: "self.interests" as const, item: "jazz" }];

  it("shows only how many cards are left face down in each category, never their items", () => {
    expect(faceDown(deck, seen)).toEqual([
      { category: "self.interests", remaining: 1 },
      { category: "date.cuisines", remaining: 1 },
    ]);
    expect(JSON.stringify(faceDown(deck, seen))).not.toMatch(/hiking|cantonese/);
  });

  it("hides a card again once its owner takes it out of the deck", () => {
    expect(stillShown(deck, seen)).toEqual(seen);
    const smaller = deckOf(facts, { ...DEFAULT_SETTINGS, excluded: ["self.interests"] });
    expect(stillShown(smaller, seen)).toEqual([]);
  });
});

describe("flipRefusal", () => {
  const ready: FlipState = {
    open: true,
    bothConsent: true,
    flippedToday: 0,
    mine: 2,
    theirs: 2,
    myDeckSize: 5,
    remainingInCategory: 3,
  };

  it("allows one card a day while chat is open and both agreed", () => {
    expect(flipRefusal(ready)).toBeNull();
    expect(flipRefusal({ ...ready, flippedToday: CARDS_PER_DAY })).toBe("daily_limit");
    expect(flipRefusal({ ...ready, open: false })).toBe("closed");
    expect(flipRefusal({ ...ready, bothConsent: false })).toBe("no_consent");
    expect(flipRefusal({ ...ready, remainingInCategory: 0 })).toBe("category_empty");
  });

  it("keeps the two in step, at most one card apart", () => {
    expect(flipRefusal({ ...ready, mine: 2, theirs: 1 })).toBe("wait_for_them");
    expect(flipRefusal({ ...ready, mine: 1, theirs: 2 })).toBeNull();
  });

  it("lifts the step once the other has seen the whole of the viewer's deck", () => {
    expect(flipRefusal({ ...ready, mine: 4, theirs: 2, myDeckSize: 2 })).toBeNull();
  });

  it("never lets anyone get two cards ahead while the other can still catch up", () => {
    fc.assert(
      fc.property(fc.nat(10), fc.nat(10), fc.integer({ min: 1, max: 10 }), (mine, theirs, size) => {
        const allowed =
          flipRefusal({ ...ready, mine, theirs: Math.min(theirs, size), myDeckSize: size }) ===
          null;
        if (allowed && Math.min(theirs, size) < size)
          expect(mine).toBeLessThanOrEqual(Math.min(theirs, size));
      }),
    );
  });
});

describe("startOfDay", () => {
  it("is local midnight in China (UTC+8)", () => {
    expect(startOfDay(new Date("2026-11-19T15:59:00Z")).toISOString()).toBe(
      "2026-11-18T16:00:00.000Z",
    );
    expect(startOfDay(new Date("2026-11-19T16:00:00Z")).toISOString()).toBe(
      "2026-11-19T16:00:00.000Z",
    );
  });
});
