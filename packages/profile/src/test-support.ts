// Helpers for the profile test suites.
import { confirmFact } from "./rules.js";
import type { Facts, Proposal } from "./rules.js";

export const propose = (
  key: string,
  value: unknown,
  provenance: "explicit" | "inferred",
  certainty: "high" | "medium" | "low" = "medium",
): Proposal => ({ key, value, provenance, certainty });

/** A valid value for every required fact. */
export const REQUIRED_VALUES: Readonly<Record<string, unknown>> = {
  "self.city_region": "GZ_CORE",
  "self.relationship_goal": "long_term",
  "self.availability": [{ day: "sat", from: "14:00", to: "18:00" }],
  "seeking.age_range": { min: 25, max: 35 },
  "seeking.relationship_goals": ["open_to_long_term", "long_term"],
  "seeking.max_distance_km": 15,
  "date.budget_per_person": { currency: "CNY", max_minor: 8800 },
};

/** Every fact confirmed by the person, as shown. */
export function confirmAll(facts: Facts, now: Date): Facts {
  let result = facts;
  for (const key of facts.keys()) {
    const confirmed = confirmFact(result, key, now);
    if (!confirmed.ok) throw new Error(confirmed.problem);
    result = confirmed.facts;
  }
  return result;
}
