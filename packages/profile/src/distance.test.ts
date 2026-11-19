// Distance is soft (ADR-0017): the home area and commute are private, never
// hard rules, and the retired distance rule never reaches matching again.
import { describe, expect, it } from "vitest";

import { FACTS } from "./catalog.js";
import {
  NO_FACTS,
  applyProposals,
  confirmFact,
  hardRules,
  setVisibility,
  snapshotOf,
} from "./rules.js";

const NOW = new Date("2026-11-19T08:00:00Z");

describe("home area and commute", () => {
  it.each(["self.home_area", "date.max_commute_minutes", "seeking.max_distance_km"] as const)(
    "%s is soft, optional and private only",
    (key) => {
      expect(FACTS[key]).toMatchObject({ hard: false, required: false, visibilities: ["private"] });
    },
  );

  it("cannot be shared with matching or turned into a signal for the other agent", () => {
    const facts = applyProposals(
      NO_FACTS,
      [{ key: "self.home_area", value: "GZ_TIANHE", provenance: "explicit", certainty: "high" }],
      NOW,
    ).facts;
    expect(setVisibility(facts, "self.home_area", "matching")).toMatchObject({ ok: false });
    expect(setVisibility(facts, "self.home_area", "signal")).toMatchObject({ ok: false });
  });

  it("is a coarse area code, never an address", () => {
    const outcome = applyProposals(
      NO_FACTS,
      [
        {
          key: "self.home_area",
          value: "Room 1203, 88 Tianhe Rd",
          provenance: "explicit",
          certainty: "high",
        },
      ],
      NOW,
    );
    expect(outcome.refused).toMatchObject([{ key: "self.home_area", reason: "invalid_value" }]);
  });

  it("never becomes a hard rule or part of the matching snapshot, even confirmed", () => {
    let facts = NO_FACTS;
    for (const [key, value] of [
      ["self.home_area", "GZ_TIANHE"],
      ["date.max_commute_minutes", 40],
      ["seeking.max_distance_km", 15],
    ] as const) {
      const confirmed = confirmFact(facts, key, NOW, value);
      if (!confirmed.ok) throw new Error(confirmed.problem);
      facts = confirmed.facts;
    }
    expect(hardRules(facts)).toEqual([]);
    expect(snapshotOf(facts).hard_rules).toEqual({});
  });
});
