import { describe, expect, it } from "vitest";

import { FACTS, FACT_KEYS } from "./catalog.js";
import type { FactKey } from "./catalog.js";
import { sameValue, validateValue } from "./values.js";

const check = (key: FactKey, value: unknown) => validateValue(FACTS[key], value);

describe("the catalog", () => {
  it("keeps 'about me', 'looking for' and the date apart by key", () => {
    for (const key of FACT_KEYS) {
      expect(key.split(".")[0]).toBe(FACTS[key].subject);
    }
  });

  it("makes every required fact hard-capable and matchable by default", () => {
    for (const key of FACT_KEYS.filter((k) => FACTS[k].required)) {
      expect(FACTS[key].hard, key).toBe(true);
      expect(FACTS[key].visibilities[0], key).toBe("matching");
    }
  });

  it("holds no sensitive category", () => {
    const sensitive =
      /religion|ethnic|race|health|medical|orientation|sexual|disab|political|income/;
    for (const key of FACT_KEYS) expect(key).not.toMatch(sensitive);
  });
});

describe("validateValue", () => {
  it.each<[FactKey, unknown, unknown]>([
    ["self.city_region", "GZ_CORE", "GZ_CORE"],
    ["self.relationship_goal", "long_term", "long_term"],
    ["seeking.relationship_goals", ["unsure", "long_term"], ["long_term", "unsure"]],
    ["self.interests", ["hiking", "board_games"], ["board_games", "hiking"]],
    [
      "seeking.interests",
      [
        { tag: "music", weight: 3 },
        { tag: "art", weight: 1 },
      ],
      [
        { tag: "art", weight: 1 },
        { tag: "music", weight: 3 },
      ],
    ],
    ["seeking.age_range", { min: 25, max: 32 }, { min: 25, max: 32 }],
    ["seeking.max_distance_km", 15, 15],
    [
      "self.availability",
      [
        { day: "sat", from: "14:00", to: "18:00" },
        { day: "fri", from: "19:00", to: "22:00" },
      ],
      [
        { day: "fri", from: "19:00", to: "22:00" },
        { day: "sat", from: "14:00", to: "18:00" },
      ],
    ],
    [
      "date.budget_per_person",
      { currency: "CNY", max_minor: 8800 },
      { currency: "CNY", max_minor: 8800 },
    ],
  ])("accepts and normalises %s", (key, value, normalised) => {
    expect(check(key, value)).toEqual({ ok: true, value: normalised });
  });

  it.each<[FactKey, unknown]>([
    ["self.city_region", "Tianhe Road 18"],
    ["self.relationship_goal", "marriage_next_month"],
    ["seeking.relationship_goals", []],
    ["seeking.relationship_goals", ["long_term", "long_term"]],
    ["self.interests", ["Hiking"]],
    ["self.interests", ["call_13800"]],
    ["self.interests", ["alice@example.com"]],
    [
      "self.interests",
      Array.from({ length: 21 }, (_, i) => `tag_${String.fromCharCode(97 + (i % 26))}${String(i)}`),
    ],
    ["seeking.interests", [{ tag: "music", weight: 5 }]],
    [
      "seeking.interests",
      [
        { tag: "music", weight: 1 },
        { tag: "music", weight: 2 },
      ],
    ],
    ["seeking.age_range", { min: 17, max: 30 }],
    ["seeking.age_range", { min: 40, max: 30 }],
    ["seeking.age_range", { min: 25.5, max: 30 }],
    ["seeking.max_distance_km", 0],
    ["seeking.max_distance_km", "15"],
    ["self.availability", [{ day: "sat", from: "18:00", to: "14:00" }]],
    ["self.availability", [{ day: "someday", from: "10:00", to: "11:00" }]],
    ["self.availability", [{ day: "sat", from: "9:00", to: "11:00" }]],
    [
      "self.availability",
      [
        { day: "sat", from: "10:00", to: "12:00" },
        { day: "sat", from: "11:00", to: "13:00" },
      ],
    ],
    ["date.budget_per_person", { currency: "USD", max_minor: 100 }],
    ["date.budget_per_person", { currency: "CNY", max_minor: -1 }],
    ["date.budget_per_person", { currency: "CNY", max_minor: 100_001 }],
  ])("refuses %s = %j", (key, value) => {
    expect(check(key, value).ok).toBe(false);
  });
});

describe("sameValue", () => {
  it("compares normalised values by meaning, not key order", () => {
    expect(sameValue({ min: 20, max: 30 }, { max: 30, min: 20 })).toBe(true);
    expect(sameValue(["a", "b"], ["a", "b"])).toBe(true);
    expect(sameValue(["a", "b"], ["a"])).toBe(false);
  });
});
