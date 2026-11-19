// The bilateral ranking baseline (ARCH-001 §7.1 step 4, §7.2; PRD-001 §5.2).
//
// Recall says who could match; ranking says, among them, who to try first.
// Each direction is scored separately: S(A, B) is how well B fits what A
// said they hope for, from B's confirmed self tags and, when both have one,
// how close their approved summaries are. A pair is only as good as its
// weaker direction:
//
//   score_pair = min(S(A,B), S(B,A)) − uncertainty − exposure
//
// These are heuristic ordering scores, not a chance of anything. They are
// internal: never shown to a person or given to an agent. Only pairs are
// compared; no person is rated on their own.

/** A weighted preference: 1 nice to have, 3 important (profile `weighted_tags`). */
export interface Wish {
  readonly tag: string;
  readonly weight: 1 | 2 | 3;
}

/** What ranking reads about one person; the caller builds it from confirmed facts. */
export interface RankProfile {
  readonly userId: string;
  /** Confirmed self tags, by kind. */
  readonly self: {
    readonly interests: readonly string[];
    readonly communication: readonly string[];
    /** Visual style tags from consented visual features; empty without that consent. */
    readonly appearance: readonly string[];
  };
  /** What the person hopes for, weighted. */
  readonly seeking: {
    readonly interests: readonly Wish[];
    readonly communication: readonly Wish[];
    readonly appearance: readonly Wish[];
  };
}

/** How the parts of S(A, B) are weighed. */
export interface RankWeights {
  readonly interests: number;
  readonly communication: number;
  readonly semantic: number;
  /**
   * The share of S appearance may take, at most `MAX_APPEARANCE_SHARE`
   * whatever is configured; 0 turns it off. Appearance is soft and never
   * decisive (ARCH-001 §7.2).
   */
  readonly appearance: number;
}

export const DEFAULT_WEIGHTS: RankWeights = {
  interests: 0.45,
  communication: 0.3,
  semantic: 0.25,
  appearance: 0.1,
};

export const MAX_APPEARANCE_SHARE = 0.15;

/** S when a person said nothing they hope for: neither a reward nor a penalty. */
export const NEUTRAL = 0.5;

/** The most that thin information can cost a pair. */
export const UNCERTAINTY_WEIGHT = 0.1;
/** The most that being put forward often can cost a pair. */
export const EXPOSURE_WEIGHT = 0.05;
/** Recent exposures at which the exposure penalty is full. */
export const EXPOSURE_SATURATION = 5;

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/** The share of `wishes` (by weight) that `tags` meet; `null` when there is no wish. */
function met(wishes: readonly Wish[], tags: readonly string[]): number | null {
  const total = wishes.reduce((sum, wish) => sum + wish.weight, 0);
  if (total === 0) return null;
  const have = new Set(tags);
  return wishes.reduce((sum, wish) => sum + (have.has(wish.tag) ? wish.weight : 0), 0) / total;
}

/** The non-visual parts A expressed, as [value, weight]. */
function parts(
  a: RankProfile,
  b: RankProfile,
  similarity: number | null,
  weights: RankWeights,
): [number, number][] {
  const found: [number | null, number][] = [
    [met(a.seeking.interests, b.self.interests), weights.interests],
    [met(a.seeking.communication, b.self.communication), weights.communication],
    [similarity === null ? null : clamp(similarity), weights.semantic],
  ];
  return found.filter((part): part is [number, number] => part[0] !== null && part[1] > 0);
}

/**
 * S(A, B) in [0, 1]. The interest, communication and summary parts A
 * expressed are averaged by weight (`NEUTRAL` when there are none);
 * appearance, if A expressed any, then takes a fixed share of at most
 * `MAX_APPEARANCE_SHARE`, so it can never move S by more than that.
 */
export function directional(
  a: RankProfile,
  b: RankProfile,
  similarity: number | null,
  weights: RankWeights = DEFAULT_WEIGHTS,
): number {
  const found = parts(a, b, similarity, weights);
  const total = found.reduce((sum, [, weight]) => sum + weight, 0);
  const base = total === 0 ? NEUTRAL : found.reduce((sum, [v, w]) => sum + v * w, 0) / total;
  const look = met(a.seeking.appearance, b.self.appearance);
  const share = Math.min(Math.max(weights.appearance, 0), MAX_APPEARANCE_SHARE);
  return look === null || share === 0 ? base : base * (1 - share) + look * share;
}

export interface PairInput {
  /** Cosine similarity of the two approved summaries, or `null` when either has none. */
  readonly similarity: number | null;
  /** Times each person was put forward recently. */
  readonly recentExposures: { readonly a: number; readonly b: number };
}

/** A pair's score and its parts, for audit and tuning only. */
export interface PairScore {
  readonly aToB: number;
  readonly bToA: number;
  readonly uncertainty: number;
  readonly exposure: number;
  /** min(aToB, bToA) − uncertainty − exposure, kept in [0, 1]. */
  readonly score: number;
}

/** How much of what could be compared, in both directions, was. */
function coverage(a: RankProfile, b: RankProfile, similarity: number | null): number {
  const known = (p: RankProfile, q: RankProfile) =>
    parts(p, q, similarity, { interests: 1, communication: 1, semantic: 1, appearance: 0 }).length;
  return (known(a, b) + known(b, a)) / 6;
}

/** The pair's score. Symmetric: swapping the two people swaps the directions only. */
export function scorePair(
  a: RankProfile,
  b: RankProfile,
  input: PairInput,
  weights: RankWeights = DEFAULT_WEIGHTS,
): PairScore {
  const aToB = directional(a, b, input.similarity, weights);
  const bToA = directional(b, a, input.similarity, weights);
  const uncertainty = UNCERTAINTY_WEIGHT * (1 - coverage(a, b, input.similarity));
  const most = Math.max(input.recentExposures.a, input.recentExposures.b, 0);
  const exposure = EXPOSURE_WEIGHT * Math.min(1, most / EXPOSURE_SATURATION);
  return {
    aToB,
    bToA,
    uncertainty,
    exposure,
    score: clamp(Math.min(aToB, bToA) - uncertainty - exposure),
  };
}

export interface Candidate {
  readonly profile: RankProfile;
  readonly similarity: number | null;
  /** Times this candidate was put forward recently. */
  readonly recentExposures: number;
}

export interface RankOptions {
  /** At most this many (ARCH-001 §7.1 step 4: 5–20 pairs a round). */
  readonly k: number;
  /** Candidates whose pair score is below this are never chosen. */
  readonly floor: number;
  /** The chance that a slot goes to a random candidate above the floor instead of the next best. */
  readonly exploration: number;
  /** Same seed, same choice; a new seed each round varies the exploration. */
  readonly seed: string;
  readonly weights?: RankWeights;
  /** Times the person ranking was put forward recently. */
  readonly myExposures?: number;
}

export interface Ranked {
  readonly userId: string;
  readonly pair: PairScore;
  /** Chosen for exploration rather than by score. */
  readonly explored: boolean;
}

/** A seeded generator in [0, 1) (mulberry32 over a string hash). */
function seeded(seed: string): () => number {
  let state = 2166136261;
  for (const char of seed) state = Math.imul(state ^ char.charCodeAt(0), 16777619) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Up to `k` candidates for `me`, best pairs first, with bounded exploration
 * (ARCH-001 §7.1 step 4): each slot goes to the next best pair, or, with
 * probability `exploration`, to a random one still above the floor. Nobody
 * below the floor is ever chosen, and nobody twice.
 */
export function rankCandidates(
  me: RankProfile,
  candidates: readonly Candidate[],
  options: RankOptions,
): Ranked[] {
  const weights = options.weights ?? DEFAULT_WEIGHTS;
  const pool = candidates
    .filter((candidate) => candidate.profile.userId !== me.userId)
    .map((candidate) => ({
      userId: candidate.profile.userId,
      pair: scorePair(
        me,
        candidate.profile,
        {
          similarity: candidate.similarity,
          recentExposures: { a: options.myExposures ?? 0, b: candidate.recentExposures },
        },
        weights,
      ),
    }))
    .filter((entry) => entry.pair.score >= options.floor)
    .sort((x, y) => y.pair.score - x.pair.score || (x.userId < y.userId ? -1 : 1));
  const random = seeded(options.seed);
  const chosen: Ranked[] = [];
  const left = [...pool];
  while (chosen.length < options.k && left.length > 0) {
    const explore = random() < options.exploration;
    const index = explore ? Math.floor(random() * left.length) : 0;
    const [picked] = left.splice(index, 1);
    if (picked !== undefined) chosen.push({ ...picked, explored: explore && index !== 0 });
  }
  return chosen;
}
