/**
 * The filter against the real profile catalog (ser-p02-04a), so neither can
 * drift from the other: every hard-capable fact is a rule this filter knows,
 * and a snapshot made the way an approval makes it reads back intact.
 */
import { FACTS, FACT_KEYS, NO_FACTS, confirmFact, snapshotOf } from "@serendipity/profile";
import type { Facts } from "@serendipity/profile";
import { describe, expect, it } from "vitest";

import { decidePair } from "./pair.js";
import type { Candidate } from "./pair.js";
import { REQUIRED_RULE_KEYS, RULE_KEYS, readHardRules } from "./rules.js";

const NOW = new Date("2026-11-12T00:00:00Z");

/** The person confirms each value on the review screen. */
function confirmed(values: Readonly<Record<string, unknown>>): Facts {
  let facts = NO_FACTS;
  for (const key of FACT_KEYS) {
    if (!(key in values)) continue;
    const result = confirmFact(facts, key, NOW, values[key]);
    if (!result.ok) throw new Error(result.problem);
    facts = result.facts;
  }
  return facts;
}

const VALUES = {
  "self.city_region": "GZ_CORE",
  "self.relationship_goal": "long_term",
  "self.availability": [{ day: "sat", from: "14:00", to: "18:00" }],
  "self.interests": ["hiking"],
  "seeking.age_range": { min: 25, max: 35 },
  "seeking.relationship_goals": ["long_term", "open_to_long_term"],
  "seeking.max_distance_km": 15,
  "seeking.dealbreakers": ["smoker"],
  "date.budget_per_person": { currency: "CNY", max_minor: 12_000 },
};

describe("the profile catalog and this filter", () => {
  it("know exactly the same hard rules", () => {
    const hard = FACT_KEYS.filter((key) => FACTS[key].hard).sort();
    expect(Object.keys(RULE_KEYS).sort()).toEqual(hard);
  });

  it("agree on which hard rules every approved profile has", () => {
    const required = FACT_KEYS.filter((key) => FACTS[key].hard && FACTS[key].required).sort();
    expect([...REQUIRED_RULE_KEYS].sort()).toEqual(required);
  });

  it("read back an approval snapshot exactly", () => {
    const result = readHardRules(snapshotOf(confirmed(VALUES)));
    expect(result).toEqual({
      ok: true,
      rules: {
        cityRegion: "GZ_CORE",
        relationshipGoal: "long_term",
        availability: [{ day: "sat", from: 840, to: 1080 }],
        seekingAgeRange: { min: 25, max: 35 },
        seekingRelationshipGoals: ["long_term", "open_to_long_term"],
        seekingMaxDistanceKm: 15,
        seekingDealbreakers: ["smoker"],
        budgetPerPerson: { currency: "CNY", minor: 12_000 },
      },
    });
  });

  it("leaves an unconfirmed fact out of the snapshot, so the pair is refused", () => {
    const rest = Object.fromEntries(
      Object.entries(VALUES).filter(([key]) => key !== "seeking.age_range"),
    );
    const snapshot = snapshotOf(confirmed(rest));
    expect(readHardRules(snapshot)).toEqual({
      ok: false,
      problems: [{ code: "profile_rule_missing", key: "seeking.age_range" }],
    });
  });

  it("passes two approved profiles that fit", () => {
    const person = (id: string): Candidate => ({
      id,
      accountStatus: "active",
      identityEligible: true,
      age: 30,
      profileSnapshot: snapshotOf(confirmed(VALUES)),
      confirmedSelfTags: ["hiking"],
      hasActiveDate: false,
      blockedIds: [],
    });
    const context = {
      dateLengthMinutes: 90,
      cheapestPackagePerPerson: { currency: "CNY", minor: 8_800 },
    };
    expect(decidePair(person("ana"), person("bo"), context)).toEqual({ pass: true });
  });
});
