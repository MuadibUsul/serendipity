// Fictional people for the matching tests. Never real data.
import type { Candidate, PairContext } from "./pair.js";
import type { RuleKey } from "./rules.js";

export type RawRules = Partial<Record<RuleKey, unknown>>;

/** A snapshot as ser-p02-04a stores it in `profile_versions.structured_json`. */
export const snapshot = (hardRules: Record<string, unknown>, schemaVersion: unknown = 1) => ({
  schema_version: schemaVersion,
  hard_rules: hardRules,
});

export const BASE_RULES: RawRules = {
  "self.city_region": "GZ_CORE",
  "self.relationship_goal": "long_term",
  "self.availability": [
    { day: "sat", from: "14:00", to: "18:00" },
    { day: "sun", from: "10:00", to: "12:00" },
  ],
  "seeking.age_range": { min: 25, max: 35 },
  "seeking.relationship_goals": ["long_term", "open_to_long_term"],
  "seeking.max_distance_km": 15,
  "date.budget_per_person": { currency: "CNY", max_minor: 12_000 },
};

export const CONTEXT: PairContext = {
  dateLengthMinutes: 90,
  cheapestPackagePerPerson: { currency: "CNY", minor: 8_800 },
};

export function person(
  id: string,
  overrides: Partial<Omit<Candidate, "id" | "profileSnapshot">> = {},
  rules: RawRules = {},
): Candidate {
  return {
    id,
    accountStatus: "active",
    identityEligible: true,
    age: 30,
    profileSnapshot: snapshot({ ...BASE_RULES, ...rules }),
    confirmedSelfTags: ["hiking", "night_owl"],
    hasActiveDate: false,
    blockedIds: [],
    ...overrides,
  };
}

/** The same person with one rule removed from the snapshot. */
export function without(id: string, key: RuleKey): Candidate {
  const rules = Object.fromEntries(Object.entries(BASE_RULES).filter(([name]) => name !== key));
  return { ...person(id), profileSnapshot: snapshot(rules) };
}
