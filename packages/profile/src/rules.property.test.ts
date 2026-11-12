// Properties over random histories: an extractor proposing anything (valid or
// not, claiming any provenance), the person confirming, correcting and
// deleting, and time passing. After every step:
// - a fact is confirmed only if the person confirmed it, with that value, and
//   nothing has outdated or removed it since;
// - no proposal changes a confirmed fact;
// - hard rules are exactly the confirmed facts of hard-capable keys;
// - every stored value fits the catalog.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { FACTS, FACT_KEYS, RELATIONSHIP_GOALS, WEEKDAYS, isFactKey } from "./catalog.js";
import type { FactKey, ValueSpec } from "./catalog.js";
import {
  NO_FACTS,
  applyProposals,
  confirmFact,
  hardRules,
  markOutdated,
  removeFact,
} from "./rules.js";
import type { Facts, Proposal } from "./rules.js";
import { sameValue, validateValue } from "./values.js";
import type { FactValue } from "./values.js";

const tag = fc.stringMatching(/^[a-z][a-z_]{0,8}$/);

function validValue(spec: ValueSpec): fc.Arbitrary<unknown> {
  switch (spec.kind) {
    case "choice":
      return fc.constantFrom(...spec.options);
    case "choices":
      return fc.uniqueArray(fc.constantFrom(...spec.options), {
        minLength: 1,
        maxLength: spec.maxItems,
      });
    case "tags":
      return fc.uniqueArray(tag, { minLength: 1, maxLength: Math.min(spec.maxItems, 4) });
    case "weighted_tags":
      return fc.uniqueArray(fc.record({ tag, weight: fc.constantFrom(1, 2, 3) }), {
        minLength: 1,
        maxLength: Math.min(spec.maxItems, 4),
        selector: (item) => item.tag,
      });
    case "region":
      return fc.constantFrom("GZ_CORE", "SZ_NANSHAN", "SH_XUHUI");
    case "int":
      return fc.integer({ min: spec.min, max: spec.max });
    case "range":
      return fc
        .tuple(
          fc.integer({ min: spec.min, max: spec.max }),
          fc.integer({ min: spec.min, max: spec.max }),
        )
        .map(([a, b]) => ({ min: Math.min(a, b), max: Math.max(a, b) }));
    case "weekly_windows":
      return fc
        .uniqueArray(fc.constantFrom(...WEEKDAYS), { minLength: 1, maxLength: 3 })
        .chain((days) =>
          fc.tuple(
            ...days.map((day) =>
              fc.integer({ min: 8, max: 20 }).map((h) => ({
                day,
                from: `${String(h).padStart(2, "0")}:00`,
                to: `${String(h + 2).padStart(2, "0")}:00`,
              })),
            ),
          ),
        );
    case "money":
      return fc
        .integer({ min: 0, max: spec.maxMinor })
        .map((maxMinor) => ({ currency: "CNY", max_minor: maxMinor }));
  }
}

const anyKey = fc.oneof(
  { weight: 5, arbitrary: fc.constantFrom(...FACT_KEYS) },
  {
    weight: 1,
    arbitrary: fc.constantFrom("self.religion", "seeking.orientation", "self.health", "admin"),
  },
);

const proposal: fc.Arbitrary<Proposal> = anyKey.chain((key) =>
  fc.record({
    key: fc.constant(key),
    value: fc.oneof(
      {
        weight: 4,
        arbitrary: isFactKey(key) ? validValue(FACTS[key].value) : fc.anything(),
      },
      { weight: 1, arbitrary: fc.oneof(fc.anything(), fc.constantFrom(...RELATIONSHIP_GOALS)) },
    ),
    provenance: fc.oneof(
      { weight: 6, arbitrary: fc.constantFrom("explicit", "inferred") },
      { weight: 1, arbitrary: fc.constantFrom("confirmed", "outdated", "user_said_so") },
    ),
    certainty: fc.oneof(
      { weight: 6, arbitrary: fc.constantFrom("high", "medium", "low") },
      { weight: 1, arbitrary: fc.string() },
    ),
  }),
);

type Step =
  | { readonly kind: "propose"; readonly proposals: Proposal[] }
  | { readonly kind: "confirm"; readonly key: FactKey; readonly corrected?: unknown }
  | { readonly kind: "remove"; readonly key: FactKey }
  | { readonly kind: "wait"; readonly days: number };

const factKey = fc.constantFrom(...FACT_KEYS);
const step: fc.Arbitrary<Step> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc
      .array(proposal, { minLength: 1, maxLength: 5 })
      .map((proposals) => ({ kind: "propose" as const, proposals })),
  },
  {
    weight: 3,
    arbitrary: factKey.chain((key) =>
      fc.oneof(
        fc.constant({ kind: "confirm" as const, key }),
        validValue(FACTS[key].value).map((corrected) => ({
          kind: "confirm" as const,
          key,
          corrected,
        })),
      ),
    ),
  },
  { weight: 1, arbitrary: factKey.map((key) => ({ kind: "remove" as const, key })) },
  {
    weight: 1,
    arbitrary: fc.integer({ min: 1, max: 200 }).map((days) => ({ kind: "wait" as const, days })),
  },
);

const DAY = 24 * 60 * 60 * 1000;

describe("profile properties", () => {
  it("only the person confirms; proposals never change a confirmed fact; hard rules follow confirmation", () => {
    fc.assert(
      fc.property(fc.array(step, { minLength: 1, maxLength: 40 }), (steps) => {
        let facts: Facts = NO_FACTS;
        let now = new Date("2026-01-01T00:00:00Z");
        // What the person confirmed and is still in force: key -> value.
        const confirmedByPerson = new Map<FactKey, FactValue>();

        for (const s of steps) {
          const before = facts;
          switch (s.kind) {
            case "propose": {
              const outcome = applyProposals(facts, s.proposals, now);
              facts = outcome.facts;
              for (const [key, fact] of before) {
                if (fact.provenance === "confirmed") expect(facts.get(key)).toEqual(fact);
              }
              break;
            }
            case "confirm": {
              const result = confirmFact(facts, s.key, now, s.corrected);
              if (result.ok) {
                facts = result.facts;
                const value = facts.get(s.key)?.value;
                if (value !== undefined) confirmedByPerson.set(s.key, value);
              }
              break;
            }
            case "remove":
              facts = removeFact(facts, s.key);
              confirmedByPerson.delete(s.key);
              break;
            case "wait": {
              now = new Date(now.getTime() + s.days * DAY);
              facts = markOutdated(facts, now);
              for (const [key, fact] of facts) {
                if (fact.provenance === "outdated") confirmedByPerson.delete(key);
              }
              break;
            }
          }

          for (const [key, fact] of facts) {
            const check = validateValue(FACTS[key], fact.value);
            expect(check.ok && sameValue(check.value, fact.value)).toBe(true);
            if (fact.provenance === "confirmed") {
              const confirmed = confirmedByPerson.get(key);
              expect(confirmed !== undefined && sameValue(confirmed, fact.value)).toBe(true);
            }
          }
          const expected = FACT_KEYS.filter(
            (key) => FACTS[key].hard && facts.get(key)?.provenance === "confirmed",
          );
          const rules = hardRules(facts);
          expect(rules.map((rule) => rule.key)).toEqual(expected);
          for (const rule of rules) expect(rule.value).toEqual(facts.get(rule.key)?.value);
        }
      }),
      { numRuns: 300 },
    );
  });

  it("never stores a proposal as confirmed, whatever it claims", () => {
    fc.assert(
      fc.property(fc.array(proposal, { maxLength: 20 }), (proposals) => {
        const { facts } = applyProposals(NO_FACTS, proposals, new Date("2026-01-01T00:00:00Z"));
        for (const fact of facts.values())
          expect(["explicit", "inferred"]).toContain(fact.provenance);
        expect(hardRules(facts)).toEqual([]);
      }),
      { numRuns: 300 },
    );
  });
});
