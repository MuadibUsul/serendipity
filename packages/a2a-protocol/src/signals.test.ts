import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { LEVELS, SIGNAL_KINDS, signalsFor } from "./signals.js";
import type { DisclosableFact, Wishes } from "./signals.js";

const wishes: Wishes = {
  interests: ["hiking", "jazz"],
  communication: ["direct"],
  lifestyle: ["early_riser", "no_smoking", "cooks"],
};

const fact = (
  kind: DisclosableFact["kind"],
  tags: string[],
  visibility: DisclosableFact["visibility"] = "signal",
): DisclosableFact => ({ kind, tags, visibility });

describe("signalsFor", () => {
  it("grades fit as none, some or strong", () => {
    const signals = signalsFor(wishes, {
      consented: true,
      facts: [fact("interests", ["jazz", "chess"]), fact("lifestyle", ["cooks"])],
    });
    expect(signals).toEqual({ interests: "strong", communication: "none", lifestyle: "some" });
  });

  it("discloses nothing without the other person's consent", () => {
    const signals = signalsFor(wishes, { consented: false, facts: [fact("interests", ["jazz"])] });
    expect(signals).toEqual({ interests: "none", communication: "none", lifestyle: "none" });
  });

  it("ignores facts not marked as signals", () => {
    const signals = signalsFor(wishes, {
      consented: true,
      facts: [
        fact("interests", ["jazz"], "private"),
        fact("communication", ["direct"], "matching"),
      ],
    });
    expect(signals).toEqual({ interests: "none", communication: "none", lifestyle: "none" });
  });

  it("carries no tag, only a level for each kind", () => {
    const tag = fc.string({ minLength: 1, maxLength: 8 });
    fc.assert(
      fc.property(
        fc.record({
          interests: fc.array(tag),
          communication: fc.array(tag),
          lifestyle: fc.array(tag),
        }),
        fc.array(
          fc.record({
            kind: fc.constantFrom(...SIGNAL_KINDS),
            tags: fc.array(tag),
            visibility: fc.constantFrom("private" as const, "matching" as const, "signal" as const),
          }),
        ),
        fc.boolean(),
        (viewer, facts, consented) => {
          const signals = signalsFor(viewer, { facts, consented });
          expect(Object.keys(signals).sort()).toEqual([...SIGNAL_KINDS].sort());
          for (const level of Object.values(signals)) expect(LEVELS).toContain(level);
        },
      ),
    );
  });

  it("does not depend on facts the other person kept private", () => {
    const tag = fc.constantFrom("jazz", "hiking", "direct", "cooks", "x");
    fc.assert(
      fc.property(
        fc.array(fc.record({ kind: fc.constantFrom(...SIGNAL_KINDS), tags: fc.array(tag) })),
        fc.array(fc.record({ kind: fc.constantFrom(...SIGNAL_KINDS), tags: fc.array(tag) })),
        (shared, hidden) => {
          const open = shared.map((f) => ({ ...f, visibility: "signal" as const }));
          const closed = hidden.map((f) => ({ ...f, visibility: "matching" as const }));
          expect(signalsFor(wishes, { consented: true, facts: [...open, ...closed] })).toEqual(
            signalsFor(wishes, { consented: true, facts: open }),
          );
        },
      ),
    );
  });
});
