import { describe, expect, it } from "vitest";

import { REQUIRED_RULE_KEYS, longestSharedMinutes, readHardRules } from "./rules.js";
import type { WeeklyWindow } from "./rules.js";
import { BASE_RULES, snapshot } from "./test-support.js";

const window = (day: WeeklyWindow["day"], from: number, to: number): WeeklyWindow => ({
  day,
  from,
  to,
});

describe("readHardRules", () => {
  it("reads a complete snapshot", () => {
    expect(readHardRules(snapshot(BASE_RULES))).toEqual({
      ok: true,
      rules: {
        cityRegion: "GZ_CORE",
        relationshipGoal: "long_term",
        availability: [
          { day: "sat", from: 840, to: 1080 },
          { day: "sun", from: 600, to: 720 },
        ],
        seekingAgeRange: { min: 25, max: 35 },
        seekingRelationshipGoals: ["long_term", "open_to_long_term"],
        seekingMaxDistanceKm: 15,
        seekingDealbreakers: [],
        budgetPerPerson: { currency: "CNY", minor: 12_000 },
      },
    });
  });

  it("reads confirmed dealbreakers when there are some", () => {
    const result = readHardRules(snapshot({ ...BASE_RULES, "seeking.dealbreakers": ["smoking"] }));
    expect(result.ok && result.rules.seekingDealbreakers).toEqual(["smoking"]);
  });

  it.each([null, undefined])("has no approved profile for %s", (value) => {
    expect(readHardRules(value)).toEqual({
      ok: false,
      problems: [{ code: "no_approved_profile" }],
    });
  });

  it.each([
    ["a string", "{}"],
    ["an array", []],
    ["no schema version", { hard_rules: BASE_RULES }],
    ["a newer schema", snapshot(BASE_RULES, 2)],
    ["a schema version as text", snapshot(BASE_RULES, "1")],
    ["no hard rules", { schema_version: 1 }],
    ["hard rules as a list", { schema_version: 1, hard_rules: [] }],
  ])("refuses %s as unreadable", (_name, value) => {
    expect(readHardRules(value)).toEqual({
      ok: false,
      problems: [{ code: "profile_unreadable" }],
    });
  });

  it.each(REQUIRED_RULE_KEYS)("refuses a snapshot without %s", (key) => {
    const rules = Object.fromEntries(Object.entries(BASE_RULES).filter(([name]) => name !== key));
    expect(readHardRules(snapshot(rules))).toEqual({
      ok: false,
      problems: [{ code: "profile_rule_missing", key }],
    });
  });

  it("requires every hard key of the catalog except dealbreakers", () => {
    expect([...REQUIRED_RULE_KEYS].sort()).toEqual([
      "date.budget_per_person",
      "seeking.age_range",
      "seeking.max_distance_km",
      "seeking.relationship_goals",
      "self.availability",
      "self.city_region",
      "self.relationship_goal",
    ]);
  });

  it("refuses a hard rule it cannot enforce instead of ignoring it", () => {
    expect(readHardRules(snapshot({ ...BASE_RULES, "seeking.height_cm": { min: 170 } }))).toEqual({
      ok: false,
      problems: [{ code: "profile_rule_unknown" }],
    });
  });

  it.each([
    ["self.city_region", ""],
    ["self.city_region", 7],
    ["self.relationship_goal", null],
    ["self.availability", []],
    ["self.availability", [{ day: "funday", from: "10:00", to: "12:00" }]],
    ["self.availability", [{ day: "sat", from: "12:00", to: "12:00" }]],
    ["self.availability", [{ day: "sat", from: "18:00", to: "14:00" }]],
    ["self.availability", [{ day: "sat", from: "9:00", to: "12:00" }]],
    ["self.availability", [{ day: "sat", from: "10:00", to: "24:00" }]],
    ["self.availability", ["sat"]],
    ["seeking.age_range", { min: 17, max: 30 }],
    ["seeking.age_range", { min: 30, max: 25 }],
    ["seeking.age_range", { min: 25.5, max: 30 }],
    ["seeking.age_range", { min: "25", max: 30 }],
    ["seeking.age_range", [25, 30]],
    ["seeking.relationship_goals", []],
    ["seeking.relationship_goals", "long_term"],
    ["seeking.relationship_goals", ["long_term", 3]],
    ["seeking.max_distance_km", 0],
    ["seeking.max_distance_km", "15"],
    ["seeking.dealbreakers", "smoking"],
    ["seeking.dealbreakers", [""]],
    ["date.budget_per_person", 12_000],
    ["date.budget_per_person", { currency: "CNY", max_minor: -1 }],
    ["date.budget_per_person", { currency: "CNY", max_minor: 88.5 }],
    ["date.budget_per_person", { currency: "", max_minor: 8_800 }],
    ["date.budget_per_person", { currency: "CNY" }],
  ] as const)("refuses an invalid %s: %j", (key, value) => {
    expect(readHardRules(snapshot({ ...BASE_RULES, [key]: value }))).toEqual({
      ok: false,
      problems: [{ code: "profile_rule_invalid", key }],
    });
  });

  it("reports every problem, not only the first", () => {
    const result = readHardRules(
      snapshot({ "self.city_region": "", "seeking.max_distance_km": 5, extra: 1 }),
    );
    expect(result.ok).toBe(false);
    expect(!result.ok && result.problems.map((problem) => problem.code).sort()).toEqual([
      "profile_rule_invalid",
      "profile_rule_missing",
      "profile_rule_missing",
      "profile_rule_missing",
      "profile_rule_missing",
      "profile_rule_missing",
      "profile_rule_unknown",
    ]);
  });
});

describe("longestSharedMinutes", () => {
  it("is the overlap of two windows on the same day", () => {
    expect(longestSharedMinutes([window("sat", 600, 900)], [window("sat", 840, 1080)])).toBe(60);
  });

  it("is zero on different days", () => {
    expect(longestSharedMinutes([window("sat", 600, 900)], [window("sun", 600, 900)])).toBe(0);
  });

  it("is not positive for windows that only touch", () => {
    expect(
      longestSharedMinutes([window("sat", 600, 720)], [window("sat", 720, 900)]),
    ).toBeLessThanOrEqual(0);
  });

  it("joins one person's touching windows into one stretch", () => {
    const split = [window("sat", 600, 660), window("sat", 660, 720)];
    expect(longestSharedMinutes(split, [window("sat", 600, 720)])).toBe(120);
  });

  it("does not add up separate stretches", () => {
    const morningAndEvening = [window("sat", 540, 600), window("sat", 1080, 1140)];
    expect(longestSharedMinutes(morningAndEvening, [window("sat", 0, 1439)])).toBe(60);
  });

  it("takes the best day", () => {
    const a = [window("mon", 600, 630), window("fri", 1080, 1260)];
    const b = [window("mon", 600, 660), window("fri", 1140, 1320)];
    expect(longestSharedMinutes(a, b)).toBe(120);
  });
});
