import { describe, expect, it } from "vitest";

import { decidePair } from "./pair.js";
import type { Candidate, PairContext, Refusal } from "./pair.js";
import { REQUIRED_RULE_KEYS } from "./rules.js";
import { CONTEXT, person, snapshot, without } from "./test-support.js";

const ANA = person("ana");
const BO = person("bo");

function refusalsOf(a: Candidate, b: Candidate, context: PairContext = CONTEXT): Refusal[] {
  const decision = decidePair(a, b, context);
  return decision.pass ? [] : [...decision.refusals];
}

describe("decidePair", () => {
  it("passes two people who fit each other in every respect", () => {
    expect(decidePair(ANA, BO, CONTEXT)).toEqual({ pass: true });
  });

  it("never pairs a person with themselves", () => {
    expect(refusalsOf(ANA, person("ana"))).toEqual([{ side: "pair", code: "same_person" }]);
  });

  describe("safety gates (layer 1)", () => {
    it.each(["pending", "paused", "suspended", "deleted"] as const)(
      "rejects a %s account on either side",
      (accountStatus) => {
        const other = person("bo", { accountStatus });
        expect(refusalsOf(ANA, other)).toEqual([{ side: "b", code: `account_${accountStatus}` }]);
        expect(refusalsOf(other, ANA)).toEqual([{ side: "a", code: `account_${accountStatus}` }]);
      },
    );

    it("rejects someone who is not identity-eligible", () => {
      expect(refusalsOf(ANA, person("bo", { identityEligible: false }))).toEqual([
        { side: "b", code: "identity_ineligible" },
      ]);
    });

    it("rejects someone with no approved profile", () => {
      expect(refusalsOf({ ...ANA, profileSnapshot: null }, BO)).toEqual([
        { side: "a", code: "no_approved_profile" },
      ]);
    });

    it("rejects someone already in a date", () => {
      expect(refusalsOf(ANA, person("bo", { hasActiveDate: true }))).toEqual([
        { side: "b", code: "active_date" },
      ]);
    });

    it("rejects when either has blocked the other, naming who blocked", () => {
      expect(refusalsOf(person("ana", { blockedIds: ["zed", "bo"] }), BO)).toEqual([
        { side: "a", code: "blocked_the_other" },
      ]);
      expect(refusalsOf(ANA, person("bo", { blockedIds: ["ana"] }))).toEqual([
        { side: "b", code: "blocked_the_other" },
      ]);
    });

    it("is not affected by blocks of other people", () => {
      expect(decidePair(person("ana", { blockedIds: ["zed"] }), BO, CONTEXT).pass).toBe(true);
    });
  });

  describe("hard rules (layer 2)", () => {
    it("rejects different regions", () => {
      expect(refusalsOf(ANA, person("bo", {}, { "self.city_region": "GZ_EAST" }))).toEqual([
        { side: "pair", code: "region_mismatch" },
      ]);
    });

    it("rejects an unknown age", () => {
      expect(refusalsOf(ANA, person("bo", { age: null }))).toEqual([
        { side: "b", code: "age_unknown" },
      ]);
    });

    it.each([17, 0, -30, 30.5, 121, Number.NaN, Number.POSITIVE_INFINITY])(
      "treats the implausible age %s as unknown",
      (age) => {
        expect(refusalsOf(person("ana", { age }), BO)).toEqual([
          { side: "a", code: "age_unknown" },
        ]);
      },
    );

    it("accepts ages at both ends of the range and rejects just outside", () => {
      expect(decidePair(ANA, person("bo", { age: 25 }), CONTEXT).pass).toBe(true);
      expect(decidePair(ANA, person("bo", { age: 35 }), CONTEXT).pass).toBe(true);
      for (const age of [24, 36]) {
        expect(refusalsOf(ANA, person("bo", { age }))).toEqual([
          { side: "a", code: "age_range_excludes" },
        ]);
      }
    });

    it("checks the age range in both directions", () => {
      const picky = person("bo", {}, { "seeking.age_range": { min: 31, max: 40 } });
      expect(refusalsOf(ANA, picky)).toEqual([{ side: "b", code: "age_range_excludes" }]);
    });

    it("rejects a relationship goal the other does not accept", () => {
      const casual = person(
        "bo",
        {},
        {
          "self.relationship_goal": "casual_dating",
          "seeking.relationship_goals": ["long_term", "casual_dating"],
        },
      );
      expect(refusalsOf(ANA, casual)).toEqual([{ side: "a", code: "goal_not_accepted" }]);
      expect(refusalsOf(casual, ANA)).toEqual([{ side: "b", code: "goal_not_accepted" }]);
    });

    it("rejects when one accepts the other's goal but not the reverse", () => {
      const narrow = person("bo", {}, { "seeking.relationship_goals": ["casual_dating"] });
      expect(refusalsOf(ANA, narrow)).toEqual([{ side: "b", code: "goal_not_accepted" }]);
    });

    it("rejects conflicting time", () => {
      const weekdays = person(
        "bo",
        {},
        { "self.availability": [{ day: "tue", from: "19:00", to: "22:00" }] },
      );
      expect(refusalsOf(ANA, weekdays)).toEqual([{ side: "pair", code: "no_shared_time" }]);
    });

    it("needs shared time at least as long as the date", () => {
      const brief = (to: string) =>
        person("bo", {}, { "self.availability": [{ day: "sat", from: "16:30", to }] });
      // Ana is free on Saturday until 18:00; the date lasts 90 minutes.
      expect(decidePair(ANA, brief("18:00"), CONTEXT).pass).toBe(true);
      expect(decidePair(ANA, brief("23:00"), CONTEXT).pass).toBe(true);
      expect(
        refusalsOf(
          ANA,
          person("bo", {}, { "self.availability": [{ day: "sat", from: "16:31", to: "23:00" }] }),
        ),
      ).toEqual([{ side: "pair", code: "no_shared_time" }]);
    });

    it("rejects a budget below the cheapest package, and accepts one equal to it", () => {
      const budget = (minor: number) =>
        person("bo", {}, { "date.budget_per_person": { currency: "CNY", max_minor: minor } });
      expect(decidePair(ANA, budget(8_800), CONTEXT).pass).toBe(true);
      expect(refusalsOf(ANA, budget(8_799))).toEqual([{ side: "b", code: "budget_below_package" }]);
    });

    it("rejects when no package is on offer", () => {
      expect(refusalsOf(ANA, BO, { ...CONTEXT, cheapestPackagePerPerson: null })).toEqual([
        { side: "pair", code: "no_package" },
      ]);
    });

    it("rejects a budget in another currency", () => {
      const dollars = person(
        "bo",
        {},
        { "date.budget_per_person": { currency: "USD", max_minor: 90_000 } },
      );
      expect(refusalsOf(ANA, dollars)).toEqual([
        { side: "pair", code: "budget_currency_mismatch" },
      ]);
    });

    it("rejects a dealbreaker among the other's confirmed self tags", () => {
      const strict = person("bo", {}, { "seeking.dealbreakers": ["smoker", "night_owl"] });
      expect(refusalsOf(ANA, strict)).toEqual([{ side: "b", code: "dealbreaker" }]);
      expect(refusalsOf(strict, ANA)).toEqual([{ side: "a", code: "dealbreaker" }]);
    });

    it("passes when the dealbreakers match nothing the other confirmed", () => {
      const strict = person("bo", {}, { "seeking.dealbreakers": ["smoker"] });
      expect(decidePair(ANA, strict, CONTEXT).pass).toBe(true);
    });
  });

  describe("only the approved snapshot counts", () => {
    it.each(REQUIRED_RULE_KEYS)("rejects when %s is missing on either side", (key) => {
      expect(refusalsOf(without("ana", key), BO)).toEqual([
        { side: "a", code: "profile_rule_missing", key },
      ]);
      expect(refusalsOf(ANA, without("bo", key))).toEqual([
        { side: "b", code: "profile_rule_missing", key },
      ]);
    });

    it("rejects a snapshot from a schema it does not know", () => {
      const future = { ...BO, profileSnapshot: snapshot({}, 2) };
      expect(refusalsOf(ANA, future)).toEqual([{ side: "b", code: "profile_unreadable" }]);
    });

    it("rejects a snapshot with a rule it cannot enforce", () => {
      const extra = person("bo", {}, { ["seeking.height_cm" as never]: 180 });
      expect(refusalsOf(ANA, extra)).toEqual([{ side: "b", code: "profile_rule_unknown" }]);
    });

    it("reads nothing but the candidate's listed fields", () => {
      // An unconfirmed guess has nowhere to go: extra fields change nothing.
      const withGuesses = { ...BO, inferredDealbreakers: ["hiking"], inferredAgeRange: [40, 50] };
      expect(decidePair(ANA, withGuesses, CONTEXT)).toEqual({ pass: true });
    });
  });

  it("returns every refusal, for both people", () => {
    const a = person("ana", { accountStatus: "paused", age: null, blockedIds: ["bo"] });
    const b = person(
      "bo",
      { identityEligible: false, hasActiveDate: true, age: 50 },
      { "self.city_region": "SZ_NANSHAN", "seeking.dealbreakers": ["hiking"] },
    );
    expect(refusalsOf(a, b)).toEqual([
      { side: "a", code: "account_paused" },
      { side: "b", code: "identity_ineligible" },
      { side: "b", code: "active_date" },
      { side: "a", code: "blocked_the_other" },
      { side: "a", code: "age_unknown" },
      { side: "pair", code: "region_mismatch" },
      { side: "a", code: "age_range_excludes" },
      { side: "b", code: "dealbreaker" },
    ]);
  });

  it.each([0, -90, 90.5, Number.NaN])("refuses a date length of %s", (dateLengthMinutes) => {
    expect(refusalsOf(ANA, BO, { ...CONTEXT, dateLengthMinutes })).toEqual([
      { side: "pair", code: "invalid_context" },
    ]);
  });

  it.each([-1, 88.5, Number.NaN])("refuses a package price of %s", (minor) => {
    const context = { ...CONTEXT, cheapestPackagePerPerson: { currency: "CNY", minor } };
    expect(refusalsOf(ANA, BO, context)).toEqual([{ side: "pair", code: "invalid_context" }]);
  });
});
