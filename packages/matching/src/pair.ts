/**
 * May these two people be put forward to each other at all? (PRD-001 §5.1
 * layers 1 and 2, ARCH-001 §7.1 steps 0–2.)
 *
 * Deterministic and pure: no I/O, no model, no score. A pair passes only when
 * every gate holds for both people and every hard rule holds in both
 * directions. Anything missing, unknown or unreadable is a refusal.
 *
 * The reasons are internal (audit, `candidate_pairs.filter_reason`, tuning).
 * They are never shown to either person or to an agent: a reason such as
 * `blocked_the_other` or `dealbreaker` would disclose the other person.
 */
import { longestSharedMinutes, readHardRules } from "./rules.js";
import type { HardRules, Money, ProfileProblem } from "./rules.js";

export const ACCOUNT_STATUSES = ["pending", "active", "paused", "suspended", "deleted"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/** What the caller knows about one person; every field comes from another module. */
export interface Candidate {
  /** Opaque user id. */
  readonly id: string;
  /** `users.status`: only `active` can be matched (paused people keep their account). */
  readonly accountStatus: AccountStatus;
  /** `identity.eligible(user)`: adult and real person, current (ser-p01-04a). */
  readonly identityEligible: boolean;
  /**
   * Age in whole years, or `null` when it is not known. Where it comes from
   * (the verification vendor's verdict or a confirmed profile fact) is an
   * open owner decision; unknown always rejects.
   */
  readonly age: number | null;
  /**
   * The approved profile version's snapshot (`profile_versions.structured_json`),
   * as stored; `null` when no version is approved. Read with `readHardRules`.
   */
  readonly profileSnapshot: unknown;
  /**
   * Tags the person confirmed about themselves in that approved version
   * (`self.interests`, `self.lifestyle`, `self.communication_style`). The
   * other person's dealbreakers are matched against these, and only these.
   */
  readonly confirmedSelfTags: readonly string[];
  /** The person is in a date that holds their time (invited through to feedback). */
  readonly hasActiveDate: boolean;
  /** Ids of people this person has blocked. */
  readonly blockedIds: readonly string[];
}

export interface PairContext {
  /** How long a date lasts: the shared weekly time must be at least this long. */
  readonly dateLengthMinutes: number;
  /**
   * The cheapest package each person would pay for in the pair's region, or
   * `null` when no package is on offer there (then nobody can be matched).
   */
  readonly cheapestPackagePerPerson: Money | null;
}

export type Side = "a" | "b";

/**
 * Why a pair was refused. `side` names the person whose gate or rule refused;
 * `pair` reasons belong to neither person.
 */
export type Refusal =
  | { readonly side: "pair"; readonly code: PairCode }
  | { readonly side: Side; readonly code: PersonCode }
  | { readonly side: Side; readonly code: ProfileProblem["code"]; readonly key?: string };

export type PairCode =
  | "same_person"
  | "invalid_context"
  | "region_mismatch"
  | "no_shared_time"
  | "no_package"
  | "budget_currency_mismatch";

export type PersonCode =
  | `account_${Exclude<AccountStatus, "active">}`
  | "identity_ineligible"
  | "active_date"
  /** This person blocked the other. */
  | "blocked_the_other"
  /** This person's age is not known (or is not a plausible adult age). */
  | "age_unknown"
  /** This person's age range excludes the other. */
  | "age_range_excludes"
  /** This person does not accept the other's relationship goal. */
  | "goal_not_accepted"
  /** This person's budget ceiling is below the cheapest package. */
  | "budget_below_package"
  /** One of this person's dealbreakers is among the other's confirmed self tags. */
  | "dealbreaker";

export type PairDecision =
  { readonly pass: true } | { readonly pass: false; readonly refusals: readonly Refusal[] };

const MAX_AGE = 120;

function knownAge(age: number | null): number | undefined {
  return age !== null && Number.isInteger(age) && age >= 18 && age <= MAX_AGE ? age : undefined;
}

/** Layer 1 for one person, without looking at the other (ARCH-001 §7.1 step 0). */
function personGates(person: Candidate, side: Side): Refusal[] {
  const refusals: Refusal[] = [];
  if (person.accountStatus !== "active") {
    refusals.push({ side, code: `account_${person.accountStatus}` });
  }
  if (!person.identityEligible) refusals.push({ side, code: "identity_ineligible" });
  if (person.hasActiveDate) refusals.push({ side, code: "active_date" });
  return refusals;
}

function profileRefusals(problems: readonly ProfileProblem[], side: Side): Refusal[] {
  return problems.map((problem) =>
    "key" in problem
      ? { side, code: problem.code, key: problem.key }
      : { side, code: problem.code },
  );
}

/** What `mine` demands of `theirs`: one direction of layer 2. */
function directed(
  mine: HardRules,
  theirs: HardRules,
  them: Candidate,
  theirAge: number | undefined,
  side: Side,
): Refusal[] {
  const refusals: Refusal[] = [];
  if (
    theirAge !== undefined &&
    (theirAge < mine.seekingAgeRange.min || theirAge > mine.seekingAgeRange.max)
  ) {
    refusals.push({ side, code: "age_range_excludes" });
  }
  if (!mine.seekingRelationshipGoals.includes(theirs.relationshipGoal)) {
    refusals.push({ side, code: "goal_not_accepted" });
  }
  if (mine.seekingDealbreakers.some((tag) => them.confirmedSelfTags.includes(tag))) {
    refusals.push({ side, code: "dealbreaker" });
  }
  return refusals;
}

function validContext(context: PairContext): boolean {
  const price = context.cheapestPackagePerPerson;
  return (
    Number.isInteger(context.dateLengthMinutes) &&
    context.dateLengthMinutes > 0 &&
    (price === null || (Number.isInteger(price.minor) && price.minor >= 0))
  );
}

/**
 * The decision for one pair. Symmetric: swapping `a` and `b` gives the same
 * verdict, with the sides of the refusals swapped. Every refusal that can be
 * established is returned, not only the first.
 */
export function decidePair(a: Candidate, b: Candidate, context: PairContext): PairDecision {
  if (a.id === b.id) return { pass: false, refusals: [{ side: "pair", code: "same_person" }] };
  if (!validContext(context)) {
    return { pass: false, refusals: [{ side: "pair", code: "invalid_context" }] };
  }

  const refusals: Refusal[] = [...personGates(a, "a"), ...personGates(b, "b")];
  if (a.blockedIds.includes(b.id)) refusals.push({ side: "a", code: "blocked_the_other" });
  if (b.blockedIds.includes(a.id)) refusals.push({ side: "b", code: "blocked_the_other" });

  const ageA = knownAge(a.age);
  const ageB = knownAge(b.age);
  if (ageA === undefined) refusals.push({ side: "a", code: "age_unknown" });
  if (ageB === undefined) refusals.push({ side: "b", code: "age_unknown" });

  const rulesA = readHardRules(a.profileSnapshot);
  const rulesB = readHardRules(b.profileSnapshot);
  if (!rulesA.ok) refusals.push(...profileRefusals(rulesA.problems, "a"));
  if (!rulesB.ok) refusals.push(...profileRefusals(rulesB.problems, "b"));

  // The hard rules can only be compared when both profiles can be read.
  if (rulesA.ok && rulesB.ok) {
    const ra = rulesA.rules;
    const rb = rulesB.rules;
    if (ra.cityRegion !== rb.cityRegion) refusals.push({ side: "pair", code: "region_mismatch" });
    if (longestSharedMinutes(ra.availability, rb.availability) < context.dateLengthMinutes) {
      refusals.push({ side: "pair", code: "no_shared_time" });
    }
    refusals.push(...budgetRefusals(ra, rb, context.cheapestPackagePerPerson));
    refusals.push(...directed(ra, rb, b, ageB, "a"), ...directed(rb, ra, a, ageA, "b"));
  }

  return refusals.length === 0 ? { pass: true } : { pass: false, refusals };
}

/** Each pays their own share, so the shared ceiling is the lower of the two budgets. */
function budgetRefusals(a: HardRules, b: HardRules, cheapest: Money | null): Refusal[] {
  if (cheapest === null) return [{ side: "pair", code: "no_package" }];
  const refusals: Refusal[] = [];
  if (
    a.budgetPerPerson.currency !== cheapest.currency ||
    b.budgetPerPerson.currency !== cheapest.currency
  ) {
    refusals.push({ side: "pair", code: "budget_currency_mismatch" });
    return refusals;
  }
  if (a.budgetPerPerson.minor < cheapest.minor) {
    refusals.push({ side: "a", code: "budget_below_package" });
  }
  if (b.budgetPerPerson.minor < cheapest.minor) {
    refusals.push({ side: "b", code: "budget_below_package" });
  }
  return refusals;
}
