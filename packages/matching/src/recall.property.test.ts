// Recall is a superset of decidePair: it may keep a pair decidePair refuses,
// never the other way round. Windows here fall on any minute, so quarter-hour
// alignment is exercised hard.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { decidePair } from "./pair.js";
import type { Candidate, PairContext } from "./pair.js";
import {
  MIN_DATE_MINUTES,
  QUARTER_MINUTES,
  availabilityMask,
  mayRecall,
  recallEntryOf,
  requiredQuarters,
  sharesRun,
} from "./recall.js";
import type { RecallContext, RecallEntry, RecallSource } from "./recall.js";
import { WEEKDAYS, longestSharedMinutes, readHardRules } from "./rules.js";
import type { WeeklyWindow } from "./rules.js";
import { snapshot } from "./test-support.js";

const RUNS = { numRuns: 2_000 };
/** Few random pairs pass decidePair; enough runs that at least a hundred do. */
const SUPERSET_RUNS = { numRuns: 5_000 };
const NOW = new Date("2026-11-18T00:00:00Z");

const REGIONS = ["GZ_CORE", "GZ_EAST"];
const GOALS = ["long_term", "open_to_long_term", "casual_dating", "unsure"];
const TAGS = ["hiking", "night_owl", "smoker", "homebody", "early_riser"];
const DAYS = ["fri", "sat", "sun"] as const;

const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** A window starting on any minute, 1 minute to 8 hours long. */
const windowArb = fc
  .tuple(
    fc.constantFrom(...DAYS),
    fc.integer({ min: 6 * 60, max: 22 * 60 }),
    fc.integer({ min: 1, max: 8 * 60 }),
  )
  .map(([day, from, length]) => ({ day, from, to: Math.min(from + length, 1439) }));

const windowsArb = fc.array(windowArb, { minLength: 1, maxLength: 4 });

const toRaw = (windows: readonly WeeklyWindow[]) =>
  windows.map(({ day, from, to }) => ({ day, from: hhmm(from), to: hhmm(to) }));

/** A long Saturday afternoon most people share, so that passing pairs are common. */
const commonWindowArb = fc
  .tuple(fc.integer({ min: 0, max: 59 }), fc.integer({ min: 0, max: 59 }))
  .map(([early, late]) => ({ day: "sat" as const, from: 13 * 60 + early, to: 18 * 60 + late }));

const biasedWindowsArb = fc.oneof(
  { weight: 3, arbitrary: fc.tuple(commonWindowArb, windowsArb).map(([w, rest]) => [w, ...rest]) },
  { weight: 1, arbitrary: windowsArb },
);

// Biased towards compatible people, so passing pairs and every kind of
// refusal both turn up often.
const candidateArb = (id: string): fc.Arbitrary<Candidate> =>
  fc
    .record({
      age: fc.oneof(
        { weight: 9, arbitrary: fc.integer({ min: 24, max: 34 }) },
        { weight: 1, arbitrary: fc.constant(null) },
      ),
      region: fc.constantFrom("GZ_CORE", "GZ_CORE", "GZ_CORE", ...REGIONS),
      goal: fc.constantFrom(...GOALS),
      windows: biasedWindowsArb,
      min: fc.integer({ min: 18, max: 28 }),
      span: fc.integer({ min: 5, max: 20 }),
      accepts: fc.oneof(
        { weight: 2, arbitrary: fc.constant(GOALS) },
        { weight: 1, arbitrary: fc.subarray(GOALS, { minLength: 1 }) },
      ),
      dealbreakers: fc.oneof(
        { weight: 3, arbitrary: fc.constant<string[]>([]) },
        { weight: 1, arbitrary: fc.subarray(TAGS, { maxLength: 2 }) },
      ),
      tags: fc.subarray(TAGS, { maxLength: 3 }),
      currency: fc.constantFrom("CNY", "CNY", "CNY", "USD"),
      budget: fc.constantFrom(5_000, 8_800, 12_000, 12_000),
      eligible: fc.oneof(
        { weight: 9, arbitrary: fc.constant(true) },
        { weight: 1, arbitrary: fc.constant(false) },
      ),
    })
    .map((p) => ({
      id,
      accountStatus: "active",
      identityEligible: p.eligible,
      age: p.age,
      profileSnapshot: snapshot({
        "self.city_region": p.region,
        "self.relationship_goal": p.goal,
        "self.availability": toRaw(p.windows),
        "seeking.age_range": { min: p.min, max: p.min + p.span },
        "seeking.relationship_goals": p.accepts,
        "seeking.max_distance_km": 10,
        "seeking.dealbreakers": p.dealbreakers,
        "date.budget_per_person": { currency: p.currency, max_minor: p.budget },
      }),
      confirmedSelfTags: p.tags,
      hasActiveDate: false,
      blockedIds: [],
    }));

const contextArb: fc.Arbitrary<RecallContext> = fc.record({
  dateLengthMinutes: fc.integer({ min: MIN_DATE_MINUTES, max: 240 }),
  cheapestPackagePerPerson: fc.record({
    currency: fc.constant("CNY"),
    minor: fc.constantFrom(5_000, 8_800, 10_000),
  }),
});

function sourceOf(candidate: Candidate): RecallSource {
  return {
    userId: candidate.id,
    age: candidate.age,
    profileSnapshot: candidate.profileSnapshot,
    confirmedSelfTags: candidate.confirmedSelfTags,
    identity: candidate.identityEligible ? { eligible: true, until: null } : { eligible: false },
  };
}

function entryOf(candidate: Candidate): RecallEntry | undefined {
  const result = recallEntryOf(sourceOf(candidate));
  return result.ok ? result.entry : undefined;
}

describe("recall never loses a pair decidePair passes", () => {
  it("both people get an entry and the prefilter keeps them", () => {
    let passes = 0;
    fc.assert(
      fc.property(candidateArb("ana"), candidateArb("bo"), contextArb, (a, b, context) => {
        const pairContext: PairContext = context;
        if (!decidePair(a, b, pairContext).pass) return;
        passes += 1;
        const ea = entryOf(a);
        const eb = entryOf(b);
        expect(ea).toBeDefined();
        expect(eb).toBeDefined();
        if (ea === undefined || eb === undefined) return;
        expect(mayRecall(ea, eb, context, NOW)).toBe(true);
      }),
      SUPERSET_RUNS,
    );
    // The generator must actually produce passing pairs, or the test proves nothing.
    expect(passes).toBeGreaterThan(100);
  });

  it("a person with no entry is refused by decidePair with anyone", () => {
    fc.assert(
      fc.property(candidateArb("ana"), candidateArb("bo"), contextArb, (a, b, context) => {
        if (entryOf(a) !== undefined) return;
        expect(decidePair(a, b, context).pass).toBe(false);
      }),
      RUNS,
    );
  });
});

describe("the prefilter", () => {
  it("is symmetric", () => {
    fc.assert(
      fc.property(candidateArb("ana"), candidateArb("bo"), contextArb, (a, b, context) => {
        const ea = entryOf(a);
        const eb = entryOf(b);
        if (ea === undefined || eb === undefined) return;
        expect(mayRecall(ea, eb, context, NOW)).toBe(mayRecall(eb, ea, context, NOW));
      }),
      RUNS,
    );
  });

  it("never recalls a person for themselves", () => {
    fc.assert(
      fc.property(candidateArb("ana"), contextArb, (a, context) => {
        const ea = entryOf(a);
        if (ea !== undefined) expect(mayRecall(ea, ea, context, NOW)).toBe(false);
      }),
      RUNS,
    );
  });
});

describe("availability masks", () => {
  const lengthArb = fc.integer({ min: MIN_DATE_MINUTES, max: 300 });

  it("keep every pair whose windows share a long enough stretch", () => {
    fc.assert(
      fc.property(windowsArb, windowsArb, lengthArb, (a, b, length) => {
        if (longestSharedMinutes(a, b) < length) return;
        expect(sharesRun(availabilityMask(a), availabilityMask(b), requiredQuarters(length))).toBe(
          true,
        );
      }),
      RUNS,
    );
  });

  it("are not loose by more than the quarter-hour rounding", () => {
    fc.assert(
      fc.property(windowsArb, windowsArb, lengthArb, (a, b, length) => {
        const run = requiredQuarters(length);
        if (!sharesRun(availabilityMask(a), availabilityMask(b), run)) return;
        expect(longestSharedMinutes(a, b)).toBeGreaterThanOrEqual(run * QUARTER_MINUTES);
      }),
      RUNS,
    );
  });

  it("set exactly the quarter hours that lie wholly inside the joined windows", () => {
    fc.assert(
      fc.property(windowsArb, (windows) => {
        const mask = availabilityMask(windows);
        expect(mask).toMatch(/^[01]{672}$/);
        WEEKDAYS.forEach((day, dayIndex) => {
          for (let quarter = 0; quarter < 96; quarter += 1) {
            const from = quarter * QUARTER_MINUTES;
            const slot = [{ day, from, to: from + QUARTER_MINUTES }];
            const inside = longestSharedMinutes(slot, windows) === QUARTER_MINUTES;
            expect(mask[dayIndex * 96 + quarter]).toBe(inside ? "1" : "0");
          }
        });
      }),
      { numRuns: 200 },
    );
  });
});

describe("entries", () => {
  it("carry the approved hard rules and nothing else", () => {
    fc.assert(
      fc.property(candidateArb("ana"), (a) => {
        const entry = entryOf(a);
        if (entry === undefined) return;
        const rules = readHardRules(a.profileSnapshot);
        if (!rules.ok) throw new Error("an entry from an unreadable profile");
        expect(Object.keys(entry).sort()).toEqual(
          [
            "acceptsGoals",
            "age",
            "ageMax",
            "ageMin",
            "availability",
            "budget",
            "dealbreakers",
            "eligibleUntil",
            "goal",
            "region",
            "selfTags",
            "userId",
          ].sort(),
        );
        expect(entry.region).toBe(rules.rules.cityRegion);
        expect(entry.dealbreakers).toEqual(rules.rules.seekingDealbreakers);
      }),
      { numRuns: 300 },
    );
  });
});
