import { describe, expect, it } from "vitest";

import { FACTS, FACT_KEYS } from "./catalog.js";
import type { FactKey } from "./catalog.js";
import {
  NO_FACTS,
  applyProposals,
  confirmFact,
  hardRules,
  markOutdated,
  missingRequired,
  removeFact,
  setVisibility,
  snapshotOf,
} from "./rules.js";
import type { Facts, Proposal } from "./rules.js";
import { REQUIRED_VALUES, confirmAll, propose } from "./test-support.js";

const T0 = new Date("2026-11-01T00:00:00Z");
const T1 = new Date("2026-11-02T00:00:00Z");

describe("applyProposals", () => {
  it("records new facts as the extractor said them, never as confirmed", () => {
    const outcome = applyProposals(
      NO_FACTS,
      [
        propose("seeking.max_distance_km", 10, "explicit"),
        propose("self.interests", ["music"], "inferred"),
      ],
      T0,
    );
    expect(outcome.applied).toEqual(["seeking.max_distance_km", "self.interests"]);
    expect(outcome.facts.get("seeking.max_distance_km")).toMatchObject({
      value: 10,
      provenance: "explicit",
      visibility: "matching",
    });
    expect(outcome.facts.get("self.interests")?.provenance).toBe("inferred");
  });

  it("refuses unknown keys, invalid values, claimed confirmations and repeats", () => {
    const proposals: Proposal[] = [
      { key: "self.religion", value: "x", provenance: "explicit", certainty: "high" },
      { key: "self.orientation", value: "x", provenance: "inferred", certainty: "low" },
      propose("seeking.max_distance_km", 1000, "explicit"),
      { key: "self.interests", value: ["music"], provenance: "confirmed", certainty: "high" },
      { key: "self.lifestyle", value: ["night_owl"], provenance: "outdated", certainty: "high" },
      {
        key: "self.relationship_goal",
        value: "long_term",
        provenance: "explicit",
        certainty: "sure",
      },
      propose("self.communication_style", ["direct"], "explicit"),
      propose("self.communication_style", ["playful"], "explicit"),
    ];
    const outcome = applyProposals(NO_FACTS, proposals, T0);
    expect(outcome.refused.map((r) => [r.key, r.reason])).toEqual([
      ["self.religion", "unknown_key"],
      ["self.orientation", "unknown_key"],
      ["seeking.max_distance_km", "invalid_value"],
      ["self.interests", "not_a_proposal"],
      ["self.lifestyle", "not_a_proposal"],
      ["self.relationship_goal", "invalid_certainty"],
      ["self.communication_style", "duplicate_key"],
    ]);
    expect([...outcome.facts.keys()]).toEqual(["self.communication_style"]);
    expect(outcome.facts.get("self.communication_style")?.value).toEqual(["direct"]);
  });

  it("never replaces a confirmed fact: the clash is returned instead", () => {
    const confirmed = confirmAll(
      applyProposals(NO_FACTS, [propose("seeking.max_distance_km", 10, "explicit")], T0).facts,
      T0,
    );
    const outcome = applyProposals(
      confirmed,
      [propose("seeking.max_distance_km", 30, "explicit")],
      T1,
    );
    expect(outcome.facts).toEqual(confirmed);
    expect(outcome.conflicts).toEqual([
      {
        key: "seeking.max_distance_km",
        current: confirmed.get("seeking.max_distance_km"),
        proposed: 30,
      },
    ]);
  });

  it("does not let a guess replace what the person said", () => {
    const said = applyProposals(
      NO_FACTS,
      [propose("self.relationship_goal", "long_term", "explicit")],
      T0,
    ).facts;
    const outcome = applyProposals(
      said,
      [propose("self.relationship_goal", "casual_dating", "inferred")],
      T1,
    );
    expect(outcome.facts.get("self.relationship_goal")?.value).toBe("long_term");
    expect(outcome.conflicts.map((c) => c.key)).toEqual(["self.relationship_goal"]);
  });

  it("lets the person change what they said, and a statement replace a guess", () => {
    const guessed = applyProposals(
      NO_FACTS,
      [propose("self.relationship_goal", "unsure", "inferred")],
      T0,
    ).facts;
    const said = applyProposals(
      guessed,
      [propose("self.relationship_goal", "long_term", "explicit")],
      T1,
    );
    expect(said.facts.get("self.relationship_goal")).toMatchObject({
      value: "long_term",
      provenance: "explicit",
    });
    const changed = applyProposals(
      said.facts,
      [propose("self.relationship_goal", "open_to_long_term", "explicit")],
      T1,
    );
    expect(changed.facts.get("self.relationship_goal")?.value).toBe("open_to_long_term");
  });

  it("strengthens a guess the person then states, and ignores weaker repeats", () => {
    const guessed = applyProposals(
      NO_FACTS,
      [propose("self.interests", ["music"], "inferred")],
      T0,
    ).facts;
    const stated = applyProposals(guessed, [propose("self.interests", ["music"], "explicit")], T1);
    expect(stated.applied).toEqual(["self.interests"]);
    expect(stated.facts.get("self.interests")?.provenance).toBe("explicit");
    const again = applyProposals(
      stated.facts,
      [propose("self.interests", ["music"], "inferred")],
      T1,
    );
    expect(again.unchanged).toEqual(["self.interests"]);
    expect(again.facts).toEqual(stated.facts);
  });

  it("keeps the person's visibility choice when a value is replaced", () => {
    const first = applyProposals(
      NO_FACTS,
      [propose("self.interests", ["music"], "explicit")],
      T0,
    ).facts;
    const hidden = setVisibility(first, "self.interests", "private");
    if (!hidden.ok) throw new Error(hidden.problem);
    const next = applyProposals(
      hidden.facts,
      [propose("self.interests", ["art"], "explicit")],
      T1,
    ).facts;
    expect(next.get("self.interests")).toMatchObject({ value: ["art"], visibility: "private" });
  });
});

describe("the person's edits", () => {
  it("confirm a shown value or a corrected one, and only valid ones", () => {
    const facts = applyProposals(
      NO_FACTS,
      [propose("seeking.age_range", { min: 25, max: 35 }, "inferred")],
      T0,
    ).facts;
    const shown = confirmFact(facts, "seeking.age_range", T1);
    expect(shown.ok && shown.facts.get("seeking.age_range")).toMatchObject({
      value: { min: 25, max: 35 },
      provenance: "confirmed",
      certainty: "high",
      updatedAt: T1,
    });
    const corrected = confirmFact(facts, "seeking.age_range", T1, { min: 27, max: 33 });
    expect(corrected.ok && corrected.facts.get("seeking.age_range")?.value).toEqual({
      min: 27,
      max: 33,
    });
    expect(confirmFact(facts, "seeking.age_range", T1, { min: 10, max: 33 }).ok).toBe(false);
    expect(confirmFact(facts, "self.interests", T1).ok).toBe(false);
  });

  it("remove a fact, and keep visibility within what the catalog allows", () => {
    const facts = applyProposals(
      NO_FACTS,
      [propose("self.city_region", "GZ_CORE", "explicit")],
      T0,
    ).facts;
    expect(removeFact(facts, "self.city_region").size).toBe(0);
    expect(setVisibility(facts, "self.city_region", "signal").ok).toBe(false);
    expect(setVisibility(facts, "self.interests", "private").ok).toBe(false);
  });
});

describe("approval and hard rules", () => {
  const complete = (): Facts =>
    confirmAll(
      applyProposals(
        NO_FACTS,
        Object.entries(REQUIRED_VALUES).map(([key, value]) => propose(key, value, "explicit")),
        T0,
      ).facts,
      T0,
    );

  it("lists every required fact until each is confirmed", () => {
    expect(missingRequired(NO_FACTS)).toEqual(FACT_KEYS.filter((k) => FACTS[k].required));
    const stated = applyProposals(
      NO_FACTS,
      Object.entries(REQUIRED_VALUES).map(([key, value]) => propose(key, value, "explicit")),
      T0,
    ).facts;
    expect(missingRequired(stated)).toHaveLength(Object.keys(REQUIRED_VALUES).length);
    expect(missingRequired(complete())).toEqual([]);
  });

  it("derives hard rules from confirmed hard facts only", () => {
    const withSoft = applyProposals(
      complete(),
      [
        propose("self.interests", ["music"], "explicit"),
        propose("seeking.dealbreakers", ["smoking"], "inferred"),
      ],
      T1,
    ).facts;
    const keys = hardRules(withSoft).map((rule) => rule.key);
    expect(keys).toEqual(
      Object.keys(REQUIRED_VALUES).sort(
        (a, b) => FACT_KEYS.indexOf(a as FactKey) - FACT_KEYS.indexOf(b as FactKey),
      ),
    );
    expect(keys).not.toContain("seeking.dealbreakers");
    const confirmedDealbreaker = confirmFact(withSoft, "seeking.dealbreakers", T1);
    expect(
      confirmedDealbreaker.ok && hardRules(confirmedDealbreaker.facts).map((r) => r.key),
    ).toContain("seeking.dealbreakers");
  });

  it("drops facts left for 180 days from the hard rules until reconfirmed", () => {
    const facts = complete();
    const later = new Date(T0.getTime() + 181 * 24 * 60 * 60 * 1000);
    const stale = markOutdated(facts, later);
    expect([...stale.values()].every((fact) => fact.provenance === "outdated")).toBe(true);
    expect(hardRules(stale)).toEqual([]);
    expect(missingRequired(stale)).toHaveLength(Object.keys(REQUIRED_VALUES).length);
    expect(markOutdated(facts, new Date(T0.getTime() + 179 * 24 * 60 * 60 * 1000))).toEqual(facts);
    const reconfirmed = confirmFact(stale, "seeking.max_distance_km", later);
    expect(reconfirmed.ok && hardRules(reconfirmed.facts).map((r) => r.key)).toEqual([
      "seeking.max_distance_km",
    ]);
  });

  it("snapshots the hard rules for matching", () => {
    expect(snapshotOf(complete())).toEqual({
      schema_version: 1,
      hard_rules: REQUIRED_VALUES_NORMALISED,
    });
  });
});

const REQUIRED_VALUES_NORMALISED = {
  "self.city_region": "GZ_CORE",
  "self.relationship_goal": "long_term",
  "self.availability": [{ day: "sat", from: "14:00", to: "18:00" }],
  "seeking.age_range": { min: 25, max: 35 },
  "seeking.relationship_goals": ["long_term", "open_to_long_term"],
  "seeking.max_distance_km": 15,
  "date.budget_per_person": { currency: "CNY", max_minor: 8800 },
};
