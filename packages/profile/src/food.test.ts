// Food taste and dietary restrictions (CHG-001 D4): taste is soft, and
// dietary restrictions are private, consent-gated, never guessed and never
// part of what matching reads.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { DIETARY_RESTRICTIONS, FACTS, TASTES, consentFor } from "./catalog.js";
import type { FactKey } from "./catalog.js";
import {
  NO_FACTS,
  applyProposals,
  confirmFact,
  setVisibility,
  snapshotOf,
  unconsentedKeys,
  withConsent,
} from "./rules.js";
import type { GrantedScopes } from "./rules.js";
import { REQUIRED_VALUES, confirmAll, propose } from "./test-support.js";

const NOW = new Date("2026-11-19T08:00:00Z");
const CONSENTED: GrantedScopes = new Set(["dietary_restrictions"]);
const DIET = "date.dietary_restrictions";
const FOOD_KEYS: FactKey[] = [
  "date.cuisines",
  "date.tastes",
  "date.atmosphere",
  "date.price_band",
  "date.dietary_restrictions",
];

describe("the food catalog", () => {
  it("makes food facts soft: none can become a hard rule", () => {
    for (const key of FOOD_KEYS) expect(FACTS[key].hard).toBe(false);
  });

  it("keeps dietary restrictions private, consent-gated and its own key", () => {
    expect(FACTS[DIET].visibilities).toEqual(["private"]);
    expect(consentFor(DIET)).toBe("dietary_restrictions");
    const gated = (Object.keys(FACTS) as FactKey[]).filter((key) => consentFor(key) !== undefined);
    expect(gated).toEqual([DIET]);
  });
});

describe("dietary restrictions need their own consent", () => {
  it("are refused from an extractor without it", () => {
    const outcome = applyProposals(NO_FACTS, [propose(DIET, ["halal"], "explicit")], NOW);
    expect(outcome.refused).toEqual([
      { key: DIET, reason: "needs_consent", detail: "dietary_restrictions" },
    ]);
    expect(outcome.facts.has(DIET)).toBe(false);
  });

  it("are recorded when the person said them and holds the consent", () => {
    const outcome = applyProposals(
      NO_FACTS,
      [propose(DIET, ["halal"], "explicit")],
      NOW,
      CONSENTED,
    );
    expect(outcome.facts.get(DIET)).toMatchObject({ value: ["halal"], visibility: "private" });
  });

  it("are never guessed, even with the consent", () => {
    const outcome = applyProposals(
      NO_FACTS,
      [propose(DIET, ["halal"], "inferred")],
      NOW,
      CONSENTED,
    );
    expect(outcome.refused).toMatchObject([{ key: DIET, reason: "not_a_proposal" }]);
  });

  it("cannot be confirmed without the consent", () => {
    expect(confirmFact(NO_FACTS, DIET, NOW, ["vegan"])).toMatchObject({ ok: false });
    expect(confirmFact(NO_FACTS, DIET, NOW, ["vegan"], CONSENTED)).toMatchObject({ ok: true });
  });

  it("cannot be shared beyond private", () => {
    const facts = applyProposals(
      NO_FACTS,
      [propose(DIET, ["vegan"], "explicit")],
      NOW,
      CONSENTED,
    ).facts;
    expect(setVisibility(facts, DIET, "matching")).toMatchObject({ ok: false });
    expect(setVisibility(facts, DIET, "signal")).toMatchObject({ ok: false });
  });

  it("drop out as soon as the consent is gone", () => {
    const facts = applyProposals(
      NO_FACTS,
      [propose(DIET, ["vegan"], "explicit")],
      NOW,
      CONSENTED,
    ).facts;
    expect(unconsentedKeys(facts, new Set())).toEqual([DIET]);
    expect(withConsent(facts, new Set()).has(DIET)).toBe(false);
    expect(withConsent(facts, CONSENTED)).toBe(facts);
  });

  it("accept only the listed restrictions", () => {
    const outcome = applyProposals(
      NO_FACTS,
      [propose(DIET, ["diabetes"], "explicit")],
      NOW,
      CONSENTED,
    );
    expect(outcome.refused).toMatchObject([{ key: DIET, reason: "invalid_value" }]);
  });
});

describe("what matching reads", () => {
  const base = (): ReturnType<typeof confirmAll> =>
    confirmAll(
      applyProposals(
        NO_FACTS,
        Object.entries(REQUIRED_VALUES).map(([key, value]) => propose(key, value, "explicit")),
        NOW,
      ).facts,
      NOW,
    );

  it("never includes food taste or dietary restrictions in the snapshot", () => {
    fc.assert(
      fc.property(
        fc.subarray([...DIETARY_RESTRICTIONS], { minLength: 1 }),
        fc.subarray([...TASTES], { minLength: 1 }),
        fc.constantFrom("budget", "moderate", "upscale"),
        (diet, tastes, band) => {
          const plain = base();
          const fed = applyProposals(
            plain,
            [
              propose(DIET, diet, "explicit"),
              propose("date.tastes", tastes, "explicit"),
              propose("date.price_band", band, "explicit"),
              propose("date.cuisines", [{ tag: "cantonese", weight: 3 }], "explicit"),
            ],
            NOW,
            CONSENTED,
          ).facts;
          const confirmed = [...FOOD_KEYS].reduce((facts, key) => {
            const next = confirmFact(facts, key, NOW, undefined, CONSENTED);
            return next.ok ? next.facts : facts;
          }, fed);
          expect(confirmed.get(DIET)?.provenance).toBe("confirmed");
          expect(snapshotOf(confirmed)).toEqual(snapshotOf(plain));
        },
      ),
    );
  });
});
