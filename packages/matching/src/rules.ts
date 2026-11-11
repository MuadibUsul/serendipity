// Reading the hard rules of an approved profile snapshot
// (`profile_versions.structured_json`, written by ser-p02-04a). The snapshot
// comes out of a jsonb column, so nothing about its shape is taken on trust:
// anything this filter cannot read and enforce is a refusal, never a rule
// that is quietly skipped.

/** The snapshot schema this filter understands. */
export const SUPPORTED_PROFILE_SCHEMA = 1;

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export interface WeeklyWindow {
  readonly day: Weekday;
  /** Minutes after local midnight, `from < to <= 1439`. */
  readonly from: number;
  readonly to: number;
}

export interface Money {
  readonly currency: string;
  readonly minor: number;
}

/** The hard rules of one person, typed. */
export interface HardRules {
  readonly cityRegion: string;
  readonly relationshipGoal: string;
  readonly availability: readonly WeeklyWindow[];
  readonly seekingAgeRange: { readonly min: number; readonly max: number };
  readonly seekingRelationshipGoals: readonly string[];
  /** Enforced when a venue is chosen (ser-p03-02); required here so a broken snapshot is refused. */
  readonly seekingMaxDistanceKm: number;
  /** Optional in the catalog: empty when the person confirmed none. */
  readonly seekingDealbreakers: readonly string[];
  readonly budgetPerPerson: Money;
}

/** Every hard-capable key of schema 1; `true` means an approved profile always has it. */
export const RULE_KEYS = {
  "self.city_region": true,
  "self.relationship_goal": true,
  "self.availability": true,
  "seeking.age_range": true,
  "seeking.relationship_goals": true,
  "seeking.max_distance_km": true,
  "seeking.dealbreakers": false,
  "date.budget_per_person": true,
} as const;
export type RuleKey = keyof typeof RULE_KEYS;

export const REQUIRED_RULE_KEYS = (Object.keys(RULE_KEYS) as RuleKey[]).filter(
  (key) => RULE_KEYS[key],
);

export type ProfileProblem =
  /** No approved profile version. */
  | { readonly code: "no_approved_profile" }
  /** Not an object with a schema version and hard rules, or a schema this filter does not know. */
  | { readonly code: "profile_unreadable" }
  | { readonly code: "profile_rule_missing"; readonly key: RuleKey }
  | { readonly code: "profile_rule_invalid"; readonly key: RuleKey }
  /** A hard rule this filter cannot enforce: refused, never ignored. */
  | { readonly code: "profile_rule_unknown" };

export type RulesResult =
  | { readonly ok: true; readonly rules: HardRules }
  | { readonly ok: false; readonly problems: readonly ProfileProblem[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

const isWholeNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value);

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function strings(value: unknown, allowEmpty: boolean): readonly string[] | undefined {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) return undefined;
  const items: string[] = [];
  for (const item of value as unknown[]) {
    const text = nonEmptyString(item);
    if (text === undefined) return undefined;
    items.push(text);
  }
  return items;
}

function windows(value: unknown): readonly WeeklyWindow[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const result: WeeklyWindow[] = [];
  for (const item of value as unknown[]) {
    if (!isRecord(item)) return undefined;
    const { day, from, to } = item;
    const weekday = WEEKDAYS.find((name) => name === day);
    if (weekday === undefined) return undefined;
    if (typeof from !== "string" || typeof to !== "string") return undefined;
    if (!TIME.test(from) || !TIME.test(to)) return undefined;
    if (minutesOf(from) >= minutesOf(to)) return undefined;
    result.push({ day: weekday, from: minutesOf(from), to: minutesOf(to) });
  }
  return result;
}

function ageRange(value: unknown): { min: number; max: number } | undefined {
  if (!isRecord(value)) return undefined;
  const { min, max } = value;
  if (!isWholeNumber(min) || !isWholeNumber(max) || min < 18 || min > max) return undefined;
  return { min, max };
}

function money(value: unknown): Money | undefined {
  if (!isRecord(value)) return undefined;
  const currency = nonEmptyString(value["currency"]);
  const minor = value["max_minor"];
  if (currency === undefined || !isWholeNumber(minor) || minor < 0) return undefined;
  return { currency, minor };
}

function distance(value: unknown): number | undefined {
  return isWholeNumber(value) && value >= 1 ? value : undefined;
}

/**
 * The typed hard rules of an approved profile snapshot, or every reason it
 * cannot be used. `null` or `undefined` means the person has no approved
 * profile.
 */
export function readHardRules(snapshot: unknown): RulesResult {
  if (snapshot === null || snapshot === undefined) {
    return { ok: false, problems: [{ code: "no_approved_profile" }] };
  }
  if (
    !isRecord(snapshot) ||
    snapshot["schema_version"] !== SUPPORTED_PROFILE_SCHEMA ||
    !isRecord(snapshot["hard_rules"])
  ) {
    return { ok: false, problems: [{ code: "profile_unreadable" }] };
  }
  const raw = snapshot["hard_rules"];
  const problems: ProfileProblem[] = [];
  if (Object.keys(raw).some((key) => !Object.hasOwn(RULE_KEYS, key))) {
    problems.push({ code: "profile_rule_unknown" });
  }

  function read<T>(key: RuleKey, parse: (value: unknown) => T | undefined): T | undefined {
    if (!Object.hasOwn(raw, key)) {
      if (RULE_KEYS[key]) problems.push({ code: "profile_rule_missing", key });
      return undefined;
    }
    const parsed = parse(raw[key]);
    if (parsed === undefined) problems.push({ code: "profile_rule_invalid", key });
    return parsed;
  }

  const cityRegion = read("self.city_region", nonEmptyString);
  const relationshipGoal = read("self.relationship_goal", nonEmptyString);
  const availability = read("self.availability", windows);
  const seekingAgeRange = read("seeking.age_range", ageRange);
  const seekingRelationshipGoals = read("seeking.relationship_goals", (value) =>
    strings(value, false),
  );
  const seekingMaxDistanceKm = read("seeking.max_distance_km", distance);
  const dealbreakers = read("seeking.dealbreakers", (value) => strings(value, true));
  const budgetPerPerson = read("date.budget_per_person", money);

  if (
    problems.length > 0 ||
    cityRegion === undefined ||
    relationshipGoal === undefined ||
    availability === undefined ||
    seekingAgeRange === undefined ||
    seekingRelationshipGoals === undefined ||
    seekingMaxDistanceKm === undefined ||
    budgetPerPerson === undefined
  ) {
    return { ok: false, problems };
  }
  return {
    ok: true,
    rules: {
      cityRegion,
      relationshipGoal,
      availability,
      seekingAgeRange,
      seekingRelationshipGoals,
      seekingMaxDistanceKm,
      seekingDealbreakers: dealbreakers ?? [],
      budgetPerPerson,
    },
  };
}

/** The longest stretch, in minutes, that two people's weekly windows share on one day. */
export function longestSharedMinutes(
  a: readonly WeeklyWindow[],
  b: readonly WeeklyWindow[],
): number {
  let longest = 0;
  for (const day of WEEKDAYS) {
    const mine = mergedDay(a, day);
    const theirs = mergedDay(b, day);
    for (const x of mine) {
      for (const y of theirs) {
        longest = Math.max(longest, Math.min(x.to, y.to) - Math.max(x.from, y.from));
      }
    }
  }
  return longest;
}

/** One day's windows as disjoint stretches: overlapping or touching windows are joined. */
function mergedDay(all: readonly WeeklyWindow[], day: Weekday): { from: number; to: number }[] {
  const sorted = all
    .filter((window) => window.day === day)
    .map(({ from, to }) => ({ from, to }))
    .sort((x, y) => x.from - y.from);
  const merged: { from: number; to: number }[] = [];
  for (const window of sorted) {
    const last = merged.at(-1);
    if (last !== undefined && window.from <= last.to) last.to = Math.max(last.to, window.to);
    else merged.push(window);
  }
  return merged;
}
