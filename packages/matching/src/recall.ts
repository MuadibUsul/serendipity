// Recall entries and the recall prefilter (ARCH-001 §7.1 steps 0–3, ADR-0012).
//
// Recall narrows a city to the people who could possibly pass the bilateral
// filter with someone, using only what PostgreSQL can index. It is a
// superset: it may put forward a pair that decidePair then refuses, but it
// must never leave out a pair decidePair would pass. decidePair, and the
// decision verifier after it (ser-p03-07), stay the authority.
//
// This module is the TypeScript statement of the rule that the SQL in
// @serendipity/db runs; the two are tested against each other.
import { WEEKDAYS, mergedDay, readHardRules } from "./rules.js";
import type { Money, WeeklyWindow } from "./rules.js";

/** Availability is kept in quarter hours. */
export const QUARTER_MINUTES = 15;
const QUARTERS_PER_DAY = (24 * 60) / QUARTER_MINUTES;
/** Bits in an availability mask: one week of quarter hours, Monday first. */
export const AVAILABILITY_BITS = WEEKDAYS.length * QUARTERS_PER_DAY;
/** Recall cannot vouch for dates shorter than two quarter hours. */
export const MIN_DATE_MINUTES = 2 * QUARTER_MINUTES;

/** One person, as recall stores them (`app.recall_entries`). Hard-rule data only. */
export interface RecallEntry {
  readonly userId: string;
  readonly region: string;
  readonly age: number;
  readonly ageMin: number;
  readonly ageMax: number;
  readonly goal: string;
  readonly acceptsGoals: readonly string[];
  /** `AVAILABILITY_BITS` characters of `0`/`1`: `1` when the whole quarter hour is free. */
  readonly availability: string;
  readonly budget: Money;
  readonly dealbreakers: readonly string[];
  readonly selfTags: readonly string[];
  /** When the identity verdict the entry was built on runs out; `null` when it does not. */
  readonly eligibleUntil: Date | null;
}

/** What building an entry needs; the same facts decidePair is given. */
export interface RecallSource {
  readonly userId: string;
  /** Whole years, or `null` while the age source is undecided (ADR-0009): no entry. */
  readonly age: number | null;
  /** The approved `profile_versions.structured_json`, or `null`. */
  readonly profileSnapshot: unknown;
  readonly confirmedSelfTags: readonly string[];
  /** `identity.eligibility(...)` for the person now. */
  readonly identity:
    { readonly eligible: true; readonly until: Date | null } | { readonly eligible: false };
}

export type NoEntryReason =
  | "identity_ineligible"
  | "age_unknown"
  /** The approved profile is missing or cannot be read (decidePair says which). */
  | "profile_unusable";

export type EntryResult =
  | { readonly ok: true; readonly entry: RecallEntry }
  | { readonly ok: false; readonly reason: NoEntryReason };

/**
 * The recall entry for a person, or why they cannot be recalled at all. Every
 * refusal here is one decidePair would also make, so leaving the person out
 * loses no pair.
 */
export function recallEntryOf(source: RecallSource): EntryResult {
  if (!source.identity.eligible) return { ok: false, reason: "identity_ineligible" };
  const { age } = source;
  if (age === null || !Number.isInteger(age) || age < 18 || age > 120) {
    return { ok: false, reason: "age_unknown" };
  }
  const read = readHardRules(source.profileSnapshot);
  if (!read.ok) return { ok: false, reason: "profile_unusable" };
  const rules = read.rules;
  return {
    ok: true,
    entry: {
      userId: source.userId,
      region: rules.cityRegion,
      age,
      ageMin: rules.seekingAgeRange.min,
      ageMax: rules.seekingAgeRange.max,
      goal: rules.relationshipGoal,
      acceptsGoals: [...rules.seekingRelationshipGoals],
      availability: availabilityMask(rules.availability),
      budget: rules.budgetPerPerson,
      dealbreakers: [...rules.seekingDealbreakers],
      selfTags: [...source.confirmedSelfTags],
      eligibleUntil: source.identity.until,
    },
  };
}

/**
 * The quarter hours a person is free for in full: windows of one day are
 * joined first, so touching windows count as one stretch, as in decidePair.
 */
export function availabilityMask(windows: readonly WeeklyWindow[]): string {
  const bits = new Array<string>(AVAILABILITY_BITS).fill("0");
  WEEKDAYS.forEach((day, dayIndex) => {
    for (const { from, to } of mergedDay(windows, day)) {
      const first = Math.ceil(from / QUARTER_MINUTES);
      const end = Math.floor(to / QUARTER_MINUTES);
      for (let quarter = first; quarter < end; quarter += 1) {
        bits[dayIndex * QUARTERS_PER_DAY + quarter] = "1";
      }
    }
  });
  return bits.join("");
}

/**
 * How many consecutive whole quarter hours any shared stretch of
 * `dateLengthMinutes` must contain, however it falls against the quarter
 * hours: a stretch [s, e) holds the quarters from ⌈s/15⌉ to ⌊e/15⌋, at least
 * ⌈(e − s − 28) / 15⌉ of them since s and e are whole minutes.
 */
export function requiredQuarters(dateLengthMinutes: number): number {
  if (!Number.isInteger(dateLengthMinutes) || dateLengthMinutes < MIN_DATE_MINUTES) {
    throw new RangeError(
      `recall needs a whole date length of at least ${String(MIN_DATE_MINUTES)} minutes`,
    );
  }
  return Math.ceil((dateLengthMinutes - 2 * (QUARTER_MINUTES - 1)) / QUARTER_MINUTES);
}

/** Whether two masks share `run` consecutive set bits. */
export function sharesRun(a: string, b: string, run: number): boolean {
  let length = 0;
  for (let index = 0; index < AVAILABILITY_BITS; index += 1) {
    length = a[index] === "1" && b[index] === "1" ? length + 1 : 0;
    if (length >= run) return true;
  }
  return false;
}

export interface RecallContext {
  readonly dateLengthMinutes: number;
  /** The cheapest package per person in the region. Recall needs one: without it nobody matches. */
  readonly cheapestPackagePerPerson: Money;
}

/** Whether a person's own budget reaches the package; checked once for the requester. */
export function affords(entry: RecallEntry, cheapest: Money): boolean {
  return entry.budget.currency === cheapest.currency && entry.budget.minor >= cheapest.minor;
}

/**
 * Whether `them` passes the recall prefilter for `me`: the rules both people
 * set, in both directions, as far as the entries carry them. Symmetric.
 * Account status, consent, a held date and the profile still being the
 * approved one are checked live in the database, not here.
 */
export function mayRecall(
  me: RecallEntry,
  them: RecallEntry,
  context: RecallContext,
  now: Date,
): boolean {
  const run = requiredQuarters(context.dateLengthMinutes);
  const current = (entry: RecallEntry) =>
    entry.eligibleUntil === null || entry.eligibleUntil.getTime() > now.getTime();
  return (
    me.userId !== them.userId &&
    current(me) &&
    current(them) &&
    me.region === them.region &&
    them.age >= me.ageMin &&
    them.age <= me.ageMax &&
    me.age >= them.ageMin &&
    me.age <= them.ageMax &&
    me.acceptsGoals.includes(them.goal) &&
    them.acceptsGoals.includes(me.goal) &&
    affords(me, context.cheapestPackagePerPerson) &&
    affords(them, context.cheapestPackagePerPerson) &&
    !me.dealbreakers.some((tag) => them.selfTags.includes(tag)) &&
    !them.dealbreakers.some((tag) => me.selfTags.includes(tag)) &&
    sharesRun(me.availability, them.availability, run)
  );
}
