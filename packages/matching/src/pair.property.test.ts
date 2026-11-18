import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { ACCOUNT_STATUSES, decidePair } from "./pair.js";
import type { Candidate, PairContext, PairDecision, Refusal, Side } from "./pair.js";
import { REQUIRED_RULE_KEYS, WEEKDAYS } from "./rules.js";
import type { RuleKey, Weekday } from "./rules.js";
import { snapshot } from "./test-support.js";
import type { RawRules } from "./test-support.js";

const RUNS = { numRuns: 500 };

// Small domains, so that passes and every kind of refusal both turn up often.
const REGIONS = ["GZ_CORE", "GZ_EAST"];
const GOALS = ["long_term", "open_to_long_term", "casual_dating", "unsure"];
const TAGS = ["hiking", "night_owl", "smoker", "homebody", "early_riser"];
const IDS = ["ana", "bo", "cy"];
const DAYS: readonly Weekday[] = ["fri", "sat", "sun"];

const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

const omit = (rules: RawRules, key: RuleKey): RawRules =>
  Object.fromEntries(Object.entries(rules).filter(([name]) => name !== key));

interface RawWindow {
  day: Weekday;
  from: string;
  to: string;
}

/** A window on a half-hour grid, 30 minutes to 6 hours long. */
const windowArb: fc.Arbitrary<RawWindow> = fc
  .tuple(
    fc.constantFrom(...DAYS),
    fc.integer({ min: 16, max: 40 }),
    fc.integer({ min: 1, max: 12 }),
  )
  .map(([day, start, length]) => ({
    day,
    from: hhmm(start * 30),
    to: hhmm(Math.min(start + length, 47) * 30),
  }));

const rangeArb = fc
  .tuple(fc.integer({ min: 18, max: 40 }), fc.integer({ min: 0, max: 15 }))
  .map(([min, span]) => ({ min, max: min + span }));

const rulesArb: fc.Arbitrary<RawRules> = fc.record({
  "self.city_region": fc.constantFrom(...REGIONS),
  "self.relationship_goal": fc.constantFrom(...GOALS),
  "self.availability": fc.array(windowArb, { minLength: 1, maxLength: 4 }),
  "seeking.age_range": rangeArb,
  "seeking.relationship_goals": fc.subarray(GOALS, { minLength: 1 }),
  "seeking.max_distance_km": fc.integer({ min: 1, max: 100 }),
  "seeking.dealbreakers": fc.subarray(TAGS, { maxLength: 2 }),
  "date.budget_per_person": fc.record({
    currency: fc.constantFrom("CNY", "CNY", "CNY", "USD"),
    max_minor: fc.constantFrom(5_000, 8_800, 12_000),
  }),
});

/** A snapshot that is sometimes absent, from another schema, incomplete or carrying a stray rule. */
const snapshotArb: fc.Arbitrary<unknown> = fc.oneof(
  { weight: 6, arbitrary: rulesArb.map((rules) => snapshot(rules)) },
  { weight: 1, arbitrary: fc.constant(null) },
  { weight: 1, arbitrary: rulesArb.map((rules) => snapshot(rules, 2)) },
  {
    weight: 1,
    arbitrary: fc.tuple(rulesArb, fc.constantFrom(...REQUIRED_RULE_KEYS)).map(([rules, key]) => {
      return snapshot(omit(rules, key));
    }),
  },
  {
    weight: 1,
    arbitrary: rulesArb.map((rules) => snapshot({ ...rules, "seeking.unheard_of": true })),
  },
);

/** Mostly true (or mostly false with `likely: false`). */
const mostly = (likely: boolean) => fc.integer({ min: 0, max: 9 }).map((n) => n < 8 === likely);

const candidateArb = (snapshots: fc.Arbitrary<unknown>): fc.Arbitrary<Candidate> =>
  fc.record({
    id: fc.constantFrom(...IDS),
    accountStatus: fc.oneof(
      { weight: 6, arbitrary: fc.constant("active" as const) },
      { weight: 1, arbitrary: fc.constantFrom(...ACCOUNT_STATUSES) },
    ),
    identityEligible: mostly(true),
    age: fc.oneof(
      { weight: 8, arbitrary: fc.integer({ min: 18, max: 45 }) },
      { weight: 1, arbitrary: fc.constantFrom(null, 17, 30.5, 200) },
    ),
    profileSnapshot: snapshots,
    confirmedSelfTags: fc.subarray(TAGS, { maxLength: 3 }),
    hasActiveDate: mostly(false),
    blockedIds: fc.subarray(IDS, { maxLength: 1 }),
  });

const anyCandidate = candidateArb(snapshotArb);
const readableCandidate = candidateArb(rulesArb.map((rules) => snapshot(rules)));

const contextArb: fc.Arbitrary<PairContext> = fc.record({
  dateLengthMinutes: fc.constantFrom(60, 90, 120),
  cheapestPackagePerPerson: fc.oneof(
    { weight: 9, arbitrary: fc.constant({ currency: "CNY", minor: 8_800 }) },
    { weight: 1, arbitrary: fc.constant(null) },
  ),
});

const otherSide = (side: Side | "pair"): Side | "pair" =>
  side === "a" ? "b" : side === "b" ? "a" : "pair";

const keyOf = (refusal: Refusal) =>
  `${refusal.side}:${refusal.code}:${"key" in refusal ? (refusal.key ?? "") : ""}`;

const sorted = (decision: PairDecision) =>
  decision.pass ? [] : decision.refusals.map(keyOf).sort();

const mirrored = (decision: PairDecision) =>
  decision.pass
    ? []
    : decision.refusals
        .map((refusal) => keyOf({ ...refusal, side: otherSide(refusal.side) } as Refusal))
        .sort();

// --- An independent statement of the rule, written without the implementation's helpers. ---

interface Plain {
  region: string;
  goal: string;
  windows: RawWindow[];
  range: { min: number; max: number };
  goals: string[];
  dealbreakers: string[];
  budget: { currency: string; max_minor: number };
}

function plain(candidate: Candidate): Plain {
  const rules = (candidate.profileSnapshot as { hard_rules: Required<RawRules> }).hard_rules;
  return {
    region: rules["self.city_region"] as string,
    goal: rules["self.relationship_goal"] as string,
    windows: rules["self.availability"] as RawWindow[],
    range: rules["seeking.age_range"] as Plain["range"],
    goals: rules["seeking.relationship_goals"] as string[],
    dealbreakers: rules["seeking.dealbreakers"] as string[],
    budget: rules["date.budget_per_person"] as Plain["budget"],
  };
}

const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

/** Minute by minute: the longest run of minutes on one day in which both are free. */
function sharedMinutes(a: RawWindow[], b: RawWindow[]): number {
  const free = (windows: RawWindow[], day: Weekday, minute: number) =>
    windows.some((w) => w.day === day && toMinutes(w.from) <= minute && minute < toMinutes(w.to));
  let best = 0;
  for (const day of WEEKDAYS) {
    let run = 0;
    for (let minute = 0; minute < 1440; minute += 1) {
      run = free(a, day, minute) && free(b, day, minute) ? run + 1 : 0;
      best = Math.max(best, run);
    }
  }
  return best;
}

const personOk = (p: Candidate) =>
  p.accountStatus === "active" &&
  p.identityEligible &&
  !p.hasActiveDate &&
  typeof p.age === "number" &&
  Number.isInteger(p.age) &&
  p.age >= 18 &&
  p.age <= 120;

/** Does `me` accept `them`? One direction. */
function accepts(me: Candidate, them: Candidate): boolean {
  const mine = plain(me);
  const theirs = plain(them);
  const age = them.age ?? Number.NaN;
  return (
    !me.blockedIds.includes(them.id) &&
    age >= mine.range.min &&
    age <= mine.range.max &&
    mine.goals.includes(theirs.goal) &&
    !mine.dealbreakers.some((tag) => them.confirmedSelfTags.includes(tag))
  );
}

function expected(a: Candidate, b: Candidate, context: PairContext): boolean {
  const pa = plain(a);
  const pb = plain(b);
  const price = context.cheapestPackagePerPerson;
  return (
    a.id !== b.id &&
    personOk(a) &&
    personOk(b) &&
    accepts(a, b) &&
    accepts(b, a) &&
    pa.region === pb.region &&
    sharedMinutes(pa.windows, pb.windows) >= context.dateLengthMinutes &&
    price !== null &&
    pa.budget.currency === price.currency &&
    pb.budget.currency === price.currency &&
    Math.min(pa.budget.max_minor, pb.budget.max_minor) >= price.minor
  );
}

// --- A pair built to fit, and every single way to break it. ---

const CONTEXT: PairContext = {
  dateLengthMinutes: 90,
  cheapestPackagePerPerson: { currency: "CNY", minor: 8_800 },
};

interface Fit {
  a: Candidate;
  b: Candidate;
  rules: Record<Side, Required<RawRules>>;
}

const fitArb: fc.Arbitrary<Fit> = fc
  .record({
    region: fc.constantFrom(...REGIONS),
    goalA: fc.constantFrom(...GOALS),
    goalB: fc.constantFrom(...GOALS),
    extraGoalsA: fc.subarray(GOALS),
    extraGoalsB: fc.subarray(GOALS),
    // From 22, so that 18 is always below the other's range (its slack is at most 2 years).
    ageA: fc.integer({ min: 22, max: 60 }),
    ageB: fc.integer({ min: 22, max: 60 }),
    slackA: fc.tuple(fc.integer({ min: 0, max: 2 }), fc.integer({ min: 0, max: 8 })),
    slackB: fc.tuple(fc.integer({ min: 0, max: 2 }), fc.integer({ min: 0, max: 8 })),
    day: fc.constantFrom(...DAYS),
    start: fc.integer({ min: 16, max: 36 }),
    extraA: fc.integer({ min: 0, max: 4 }),
    extraB: fc.integer({ min: 0, max: 4 }),
    otherWindowsA: fc.array(windowArb, { maxLength: 2 }),
    otherWindowsB: fc.array(windowArb, { maxLength: 2 }),
    budgetA: fc.constantFrom(8_800, 12_000),
    budgetB: fc.constantFrom(8_800, 12_000),
    distanceA: fc.integer({ min: 1, max: 100 }),
    distanceB: fc.integer({ min: 1, max: 100 }),
    split: fc.integer({ min: 1, max: 3 }),
  })
  .map((g) => {
    // Tags are split so that nobody's dealbreaker is among the other's self tags.
    const tagsA = TAGS.slice(0, g.split);
    const tagsB = TAGS.slice(g.split);
    const shared = (extra: number): RawWindow => ({
      day: g.day,
      from: hhmm(g.start * 30),
      to: hhmm((g.start + 3 + extra) * 30),
    });
    const rulesFor = (
      goal: string,
      extraGoals: string[],
      otherGoal: string,
      otherAge: number,
      slack: [number, number],
      windows: RawWindow[],
      budget: number,
      distance: number,
      dealbreakers: string[],
    ): Required<RawRules> => ({
      "self.city_region": g.region,
      "self.relationship_goal": goal,
      "self.availability": windows,
      "seeking.age_range": { min: Math.max(18, otherAge - slack[0]), max: otherAge + slack[1] },
      "seeking.relationship_goals": [...new Set([otherGoal, ...extraGoals])],
      "seeking.max_distance_km": distance,
      "seeking.dealbreakers": dealbreakers,
      "date.budget_per_person": { currency: "CNY", max_minor: budget },
    });
    const rules = {
      a: rulesFor(
        g.goalA,
        g.extraGoalsA,
        g.goalB,
        g.ageB,
        g.slackA,
        [shared(g.extraA), ...g.otherWindowsA],
        g.budgetA,
        g.distanceA,
        tagsA.slice(0, 1),
      ),
      b: rulesFor(
        g.goalB,
        g.extraGoalsB,
        g.goalA,
        g.ageA,
        g.slackB,
        [shared(g.extraB), ...g.otherWindowsB],
        g.budgetB,
        g.distanceB,
        tagsB.slice(0, 1),
      ),
    };
    const make = (id: string, age: number, side: Side, selfTags: string[]): Candidate => ({
      id,
      accountStatus: "active",
      identityEligible: true,
      age,
      profileSnapshot: snapshot(rules[side]),
      confirmedSelfTags: selfTags,
      hasActiveDate: false,
      blockedIds: ["cy"],
    });
    return { a: make("ana", g.ageA, "a", tagsA), b: make("bo", g.ageB, "b", tagsB), rules };
  });

interface Break {
  readonly name: string;
  /** The refusal expected when `side` is the person the break is applied to. */
  readonly expect: (side: Side) => { side: Side | "pair"; code: string; key?: string };
  readonly apply: (fit: Fit, side: Side) => Candidate;
}

const withRules = (fit: Fit, side: Side, change: Record<string, unknown>): Candidate => ({
  ...fit[side],
  profileSnapshot: snapshot({ ...fit.rules[side], ...change }),
});

const withoutRule = (fit: Fit, side: Side, key: RuleKey): Candidate => {
  return { ...fit[side], profileSnapshot: snapshot(omit(fit.rules[side], key)) };
};

const other = (side: Side): Side => (side === "a" ? "b" : "a");
const onPair = (code: string) => () => ({ side: "pair" as const, code });
const onSelf = (code: string) => (side: Side) => ({ side, code });

const BREAKS: readonly Break[] = [
  ...(["pending", "paused", "suspended", "deleted"] as const).map((accountStatus): Break => ({
    name: `account ${accountStatus}`,
    expect: onSelf(`account_${accountStatus}`),
    apply: (fit, side) => ({ ...fit[side], accountStatus }),
  })),
  {
    name: "identity not eligible",
    expect: onSelf("identity_ineligible"),
    apply: (fit, side) => ({ ...fit[side], identityEligible: false }),
  },
  {
    name: "in an active date",
    expect: onSelf("active_date"),
    apply: (fit, side) => ({ ...fit[side], hasActiveDate: true }),
  },
  {
    name: "blocked the other",
    expect: onSelf("blocked_the_other"),
    apply: (fit, side) => ({ ...fit[side], blockedIds: [fit[other(side)].id] }),
  },
  {
    name: "no approved profile",
    expect: onSelf("no_approved_profile"),
    apply: (fit, side) => ({ ...fit[side], profileSnapshot: null }),
  },
  ...REQUIRED_RULE_KEYS.map((key): Break => ({
    name: `missing ${key}`,
    expect: (side) => ({ side, code: "profile_rule_missing", key }),
    apply: (fit, side) => withoutRule(fit, side, key),
  })),
  {
    name: "age unknown",
    expect: onSelf("age_unknown"),
    apply: (fit, side) => ({ ...fit[side], age: null }),
  },
  {
    name: "too old for the other",
    expect: (side) => ({ side: other(side), code: "age_range_excludes" }),
    apply: (fit, side) => ({ ...fit[side], age: 80 }),
  },
  {
    name: "too young for the other",
    expect: (side) => ({ side: other(side), code: "age_range_excludes" }),
    apply: (fit, side) => ({ ...fit[side], age: 18 }),
  },
  {
    name: "age range that excludes the other",
    expect: onSelf("age_range_excludes"),
    apply: (fit, side) => withRules(fit, side, { "seeking.age_range": { min: 61, max: 70 } }),
  },
  {
    name: "another region",
    expect: onPair("region_mismatch"),
    apply: (fit, side) => withRules(fit, side, { "self.city_region": "SZ_NANSHAN" }),
  },
  {
    name: "accepts no goal the other has",
    expect: onSelf("goal_not_accepted"),
    apply: (fit, side) =>
      withRules(fit, side, {
        "seeking.relationship_goals": GOALS.filter(
          (goal) => goal !== fit.rules[other(side)]["self.relationship_goal"],
        ),
      }),
  },
  {
    name: "free only at another time",
    expect: onPair("no_shared_time"),
    apply: (fit, side) =>
      withRules(fit, side, { "self.availability": [{ day: "mon", from: "06:00", to: "07:30" }] }),
  },
  {
    name: "budget below the cheapest package",
    expect: onSelf("budget_below_package"),
    apply: (fit, side) =>
      withRules(fit, side, { "date.budget_per_person": { currency: "CNY", max_minor: 8_799 } }),
  },
  {
    name: "a dealbreaker the other has",
    expect: onSelf("dealbreaker"),
    apply: (fit, side) =>
      withRules(fit, side, {
        "seeking.dealbreakers": fit[other(side)].confirmedSelfTags.slice(0, 1),
      }),
  },
];

/** The breaks that leave the snapshot readable, so the independent rule above can judge them. */
const READABLE_BREAKS = BREAKS.filter(
  (broken) => !broken.name.startsWith("missing ") && broken.name !== "no approved profile",
);

describe("decidePair properties", () => {
  it("is symmetric: swapping the two people mirrors the decision", () => {
    fc.assert(
      fc.property(anyCandidate, anyCandidate, contextArb, (a, b, context) => {
        const forward = decidePair(a, b, context);
        const backward = decidePair(b, a, context);
        expect(backward.pass).toBe(forward.pass);
        expect(sorted(backward)).toEqual(mirrored(forward));
      }),
      RUNS,
    );
  });

  it("passes exactly when every gate and rule holds in both directions", () => {
    // Random pairs seldom fit, so pairs built to fit, whole and broken once, are mixed in.
    const pairArb: fc.Arbitrary<[Candidate, Candidate]> = fc.oneof(
      { weight: 3, arbitrary: fc.tuple(readableCandidate, readableCandidate) },
      { weight: 1, arbitrary: fitArb.map(({ a, b }): [Candidate, Candidate] => [a, b]) },
      {
        weight: 1,
        arbitrary: fc
          .tuple(fitArb, fc.constantFrom(...READABLE_BREAKS))
          .map(([fit, broken]): [Candidate, Candidate] => [broken.apply(fit, "a"), fit.b]),
      },
    );
    let passes = 0;
    let rejections = 0;
    fc.assert(
      fc.property(pairArb, contextArb, ([a, b], context) => {
        const decision = decidePair(a, b, context);
        expect(decision.pass).toBe(expected(a, b, context));
        if (decision.pass) passes += 1;
        else rejections += 1;
      }),
      { numRuns: 3000 },
    );
    expect(passes).toBeGreaterThan(100);
    expect(rejections).toBeGreaterThan(100);
  });

  it("never passes a pair when either profile cannot be read", () => {
    const broken = candidateArb(
      snapshotArb.filter(
        (value) =>
          value === null ||
          (value as { schema_version: unknown }).schema_version !== 1 ||
          REQUIRED_RULE_KEYS.some(
            (key) => !Object.hasOwn((value as { hard_rules: object }).hard_rules, key),
          ) ||
          Object.hasOwn((value as { hard_rules: object }).hard_rules, "seeking.unheard_of"),
      ),
    );
    fc.assert(
      fc.property(broken, anyCandidate, contextArb, fc.boolean(), (bad, good, context, flip) => {
        expect((flip ? decidePair(good, bad, context) : decidePair(bad, good, context)).pass).toBe(
          false,
        );
      }),
      RUNS,
    );
  });

  it("passes a pair built to fit", () => {
    fc.assert(
      fc.property(fitArb, ({ a, b }) => {
        expect(decidePair(a, b, CONTEXT)).toEqual({ pass: true });
        expect(decidePair(b, a, CONTEXT)).toEqual({ pass: true });
      }),
      RUNS,
    );
  });

  describe("any single failure, on either side, rejects a pair that otherwise fits", () => {
    it.each(BREAKS)("$name", (broken) => {
      fc.assert(
        fc.property(fitArb, fc.constantFrom<Side>("a", "b"), (fit, side) => {
          const changed = broken.apply(fit, side);
          const a = side === "a" ? changed : fit.a;
          const b = side === "b" ? changed : fit.b;
          const decision = decidePair(a, b, CONTEXT);
          expect(decision.pass).toBe(false);
          // Exactly the one refusal, attributed to the right person.
          expect(decision.pass ? [] : decision.refusals).toEqual([broken.expect(side)]);
        }),
        { numRuns: 200 },
      );
    });
  });

  it("no package on offer rejects every pair", () => {
    fc.assert(
      fc.property(fitArb, ({ a, b }) => {
        expect(decidePair(a, b, { ...CONTEXT, cheapestPackagePerPerson: null }).pass).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("a longer date than the shared time rejects", () => {
    fc.assert(
      fc.property(fitArb, ({ a, b, rules }) => {
        const shared = sharedMinutes(
          rules.a["self.availability"] as RawWindow[],
          rules.b["self.availability"] as RawWindow[],
        );
        expect(decidePair(a, b, { ...CONTEXT, dateLengthMinutes: shared }).pass).toBe(true);
        expect(decidePair(a, b, { ...CONTEXT, dateLengthMinutes: shared + 1 }).pass).toBe(false);
      }),
      RUNS,
    );
  });
});
