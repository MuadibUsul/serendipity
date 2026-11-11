/**
 * The profile fact catalog (PRD-001 §4.2, ARCH-001 §6.1): every fact a
 * profile may hold, what its value looks like, whether it must be confirmed
 * before the person can be matched, and whether it may become a hard rule.
 *
 * Only keys listed here exist. Sensitive categories (ethnicity, religion,
 * health, sexual orientation, …; PRD-001 §1.8, §8.2) are left out by design:
 * adding one is a catalog change that needs compliance review and its own
 * consent, never something an extractor can do.
 *
 * "About me" (`self.*`) and "looking for" (`seeking.*`) are kept strictly
 * apart; `date.*` holds the terms of a date.
 */
export const PROFILE_SCHEMA_VERSION = 1;

/**
 * Where a fact came from (PRD-001 §4.2):
 * - `explicit`: the person said it; the extractor recorded it.
 * - `confirmed`: the person confirmed it on the review screen.
 * - `inferred`: the agent's assumption.
 * - `outdated`: due to be checked again.
 * Only `confirmed` facts can become hard rules.
 */
export const PROVENANCES = ["explicit", "confirmed", "inferred", "outdated"] as const;
export type Provenance = (typeof PROVENANCES)[number];

/** How reliable the record of a fact is: never a forecast of romantic success. */
export const CERTAINTIES = ["high", "medium", "low"] as const;
export type Certainty = (typeof CERTAINTIES)[number];

/**
 * Who may use a fact, at most; the consent engine still decides each use.
 * - `private`: the person and their own agent only.
 * - `matching`: also the matching service, to filter and rank.
 * - `signal`: also reduced to a coarse compatibility signal for a candidate's
 *   agent. Never the fact itself (packages/consent).
 */
export const VISIBILITIES = ["private", "matching", "signal"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const SUBJECTS = ["self", "seeking", "date"] as const;
export type Subject = (typeof SUBJECTS)[number];

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const RELATIONSHIP_GOALS = [
  "long_term",
  "open_to_long_term",
  "casual_dating",
  "unsure",
] as const;

export type ValueSpec =
  | { readonly kind: "choice"; readonly options: readonly string[] }
  | { readonly kind: "choices"; readonly options: readonly string[]; readonly maxItems: number }
  | { readonly kind: "tags"; readonly maxItems: number }
  | { readonly kind: "weighted_tags"; readonly maxItems: number }
  | { readonly kind: "region"; readonly pattern: RegExp }
  | { readonly kind: "int"; readonly min: number; readonly max: number; readonly unit: string }
  | { readonly kind: "range"; readonly min: number; readonly max: number; readonly unit: string }
  | { readonly kind: "weekly_windows"; readonly maxItems: number }
  | { readonly kind: "money"; readonly currencies: readonly string[]; readonly maxMinor: number };

export interface FactSpec {
  readonly subject: Subject;
  readonly value: ValueSpec;
  /** Must be confirmed before a profile version can be approved (made matchable). */
  readonly required: boolean;
  /** May become a hard rule, once confirmed: a bilateral filter (PRD-001 §5.1 layer 2). */
  readonly hard: boolean;
  /** Allowed visibilities; the first is the default for a new fact. */
  readonly visibilities: readonly Visibility[];
  readonly about: string;
}

const MATCHING_FIRST: readonly Visibility[] = ["matching", "private", "signal"];
const PRIVATE_FIRST: readonly Visibility[] = ["private", "matching"];

export const FACTS = {
  "self.city_region": {
    subject: "self",
    value: { kind: "region", pattern: /^[A-Z]{2,4}_[A-Z0-9_]{2,16}$/ },
    required: true,
    hard: true,
    visibilities: ["matching", "private"],
    about: "The service area the person meets in, as a region code (GZ_CORE); never an address.",
  },
  "self.relationship_goal": {
    subject: "self",
    value: { kind: "choice", options: RELATIONSHIP_GOALS },
    required: true,
    hard: true,
    visibilities: MATCHING_FIRST,
    about: "What the person is looking for in a relationship.",
  },
  "self.availability": {
    subject: "self",
    value: { kind: "weekly_windows", maxItems: 14 },
    required: true,
    hard: true,
    visibilities: ["matching", "private"],
    about: "Weekly windows the person can meet in, local time.",
  },
  "self.interests": {
    subject: "self",
    value: { kind: "tags", maxItems: 20 },
    required: false,
    hard: false,
    visibilities: MATCHING_FIRST,
    about: "Interests the person confirmed as their own.",
  },
  "self.communication_style": {
    subject: "self",
    value: { kind: "tags", maxItems: 8 },
    required: false,
    hard: false,
    visibilities: MATCHING_FIRST,
    about: "How the person likes to talk: thoughtful, direct, playful, …",
  },
  "self.lifestyle": {
    subject: "self",
    value: { kind: "tags", maxItems: 12 },
    required: false,
    hard: false,
    visibilities: MATCHING_FIRST,
    about: "Rhythm of life and habits: early_riser, night_owl, homebody, …",
  },
  "self.occupation_category": {
    subject: "self",
    value: {
      kind: "choice",
      options: ["student", "employed", "self_employed", "between_jobs", "other"],
    },
    required: false,
    hard: false,
    visibilities: PRIVATE_FIRST,
    about: "A broad category only, optional; never an employer or a job title (PRD-001 §4.1 S1).",
  },
  "seeking.age_range": {
    subject: "seeking",
    value: { kind: "range", min: 18, max: 99, unit: "years" },
    required: true,
    hard: true,
    visibilities: ["matching", "private"],
    about: "The ages the person would date, both ends included.",
  },
  "seeking.relationship_goals": {
    subject: "seeking",
    value: { kind: "choices", options: RELATIONSHIP_GOALS, maxItems: RELATIONSHIP_GOALS.length },
    required: true,
    hard: true,
    visibilities: MATCHING_FIRST,
    about: "Relationship goals the person can accept in someone else.",
  },
  "seeking.max_distance_km": {
    subject: "seeking",
    value: { kind: "int", min: 1, max: 100, unit: "km" },
    required: true,
    hard: true,
    visibilities: ["matching", "private"],
    about: "How far the person will travel to a date.",
  },
  "seeking.dealbreakers": {
    subject: "seeking",
    value: { kind: "tags", maxItems: 10 },
    required: false,
    hard: true,
    visibilities: ["matching", "private"],
    about: "Non-negotiables (PRD-001 §4.1 S3). Hard once confirmed; a guess never is.",
  },
  "seeking.interests": {
    subject: "seeking",
    value: { kind: "weighted_tags", maxItems: 20 },
    required: false,
    hard: false,
    visibilities: MATCHING_FIRST,
    about: "Interests the person hopes to share, each weighted 1 (nice) to 3 (important).",
  },
  "seeking.communication_style": {
    subject: "seeking",
    value: { kind: "weighted_tags", maxItems: 8 },
    required: false,
    hard: false,
    visibilities: MATCHING_FIRST,
    about: "Ways of talking the person gets on with, weighted.",
  },
  "seeking.appearance_style": {
    subject: "seeking",
    value: { kind: "weighted_tags", maxItems: 10 },
    required: false,
    hard: false,
    visibilities: PRIVATE_FIRST,
    about:
      "Style preferences the person stated (natural_style, short_hair, …), soft only and private by default (PRD-001 §4.3).",
  },
  "date.budget_per_person": {
    subject: "date",
    value: { kind: "money", currencies: ["CNY"], maxMinor: 100_000 },
    required: true,
    hard: true,
    visibilities: ["matching", "private"],
    about: "The most the person will pay for one date, in minor units (fen).",
  },
} as const satisfies Record<string, FactSpec>;

export type FactKey = keyof typeof FACTS;

export const FACT_KEYS = Object.keys(FACTS) as FactKey[];

export function isFactKey(key: string): key is FactKey {
  return Object.hasOwn(FACTS, key);
}

export function specOf(key: FactKey): FactSpec {
  return FACTS[key];
}
