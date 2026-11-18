// A synthetic city for candidate recall (ser-p03-02a): fictional people with
// approved profiles in one region, for correctness tests and the 10k
// benchmark (PLAN-001 G2-B: 10k is a load-test size, not a user count).
// Deterministic from the seed; no real person, place or model output.
import { FIXTURE } from "./dataset.js";
import { createRng } from "./rng.js";
import type { Rng } from "./rng.js";

/** Attestations in the city come from this provider; nothing else accepts it. */
export const CITY_IDENTITY_PROVIDER = "fixture-identity";

const GOALS = ["long_term", "open_to_long_term", "casual_dating", "unsure"] as const;
const INTERESTS = ["hiking", "films", "cooking", "board_games", "running", "music", "reading"];
const LIFESTYLE = ["early_riser", "night_owl", "homebody", "smoker", "pet_owner", "traveller"];
const STYLES = ["thoughtful", "direct", "playful", "quiet"];
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

export interface CityPerson {
  readonly id: string;
  /** Whole years; the age source is an open owner decision, so the city supplies one. */
  readonly age: number;
  /** As `profile_versions.structured_json` holds an approved snapshot (schema 1). */
  readonly snapshot: {
    readonly schema_version: 1;
    readonly hard_rules: Record<string, unknown>;
  };
  /** Confirmed tag facts of the approved version, by key. */
  readonly selfTags: Readonly<Record<string, readonly string[]>>;
  /** Unit-length vector of the stated size: people of one taste cluster point the same way. */
  readonly embedding: readonly number[];
}

export interface CityOptions {
  readonly seed: number;
  readonly people: number;
  /** Embedding size; 1024 for app.recall_entries. */
  readonly dimensions: number;
  /** How many taste clusters the embeddings form. */
  readonly clusters?: number;
  /** The region everyone is in; the fixture region unless a test wants a separate town. */
  readonly region?: string;
}

const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

function some<T>(rng: Rng, items: readonly T[], max: number): T[] {
  const chosen = new Set<T>();
  const count = rng.int(0, max);
  while (chosen.size < count) chosen.add(rng.pick(items));
  return [...chosen];
}

function availability(rng: Rng) {
  const windows: { day: string; from: string; to: string }[] = [];
  // Most people have a weekend afternoon or two, some weekday evenings.
  for (const day of ["sat", "sun"] as const) {
    if (rng.next() < 0.6) {
      const from = rng.int(10 * 4, 16 * 4) * 15;
      windows.push({
        day,
        from: hhmm(from),
        to: hhmm(Math.min(from + rng.int(2, 6) * 60, 22 * 60)),
      });
    }
  }
  for (const day of DAYS.slice(0, 5)) {
    if (rng.next() < 0.2) {
      const from = rng.int(18 * 4, 20 * 4) * 15;
      windows.push({ day, from: hhmm(from), to: hhmm(from + rng.int(2, 3) * 60) });
    }
  }
  if (windows.length === 0) windows.push({ day: "sat", from: "14:00", to: "17:00" });
  return windows;
}

function unit(values: number[]): number[] {
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  return values.map((value) => value / norm);
}

/** Roughly normal noise from the sequence (sum of uniforms). */
const noise = (rng: Rng) => rng.next() + rng.next() + rng.next() - 1.5;

/** The city, in a stable order. */
export function buildCity(options: CityOptions): CityPerson[] {
  const rng = createRng(options.seed);
  const clusterCount = options.clusters ?? 12;
  const centroids = Array.from({ length: clusterCount }, () =>
    unit(Array.from({ length: options.dimensions }, () => noise(rng))),
  );
  return Array.from({ length: options.people }, (): CityPerson => {
    const id = rng.uuid();
    const age = rng.int(22, 40);
    const lower = Math.max(18, age - rng.int(2, 8));
    const goal = rng.pick(GOALS);
    const accepts =
      goal === "casual_dating"
        ? ["casual_dating", "unsure"]
        : rng.next() < 0.5
          ? ["long_term", "open_to_long_term"]
          : ["long_term", "open_to_long_term", "unsure"];
    const centroid = rng.pick(centroids);
    // Noise about as large as the centroid itself: cosine ≈ 0.7 to the centroid.
    const spread = 2 / Math.sqrt(options.dimensions);
    return {
      id,
      age,
      snapshot: {
        schema_version: 1,
        hard_rules: {
          "self.city_region": options.region ?? FIXTURE.region,
          "self.relationship_goal": goal,
          "self.availability": availability(rng),
          "seeking.age_range": { min: lower, max: Math.max(lower, age + rng.int(2, 8)) },
          "seeking.relationship_goals": accepts,
          "seeking.max_distance_km": rng.int(3, 20),
          "seeking.dealbreakers": rng.next() < 0.3 ? some(rng, ["smoker", "night_owl"], 1) : [],
          "date.budget_per_person": { currency: "CNY", max_minor: rng.int(6, 25) * 1_000 },
        },
      },
      selfTags: {
        "self.interests": some(rng, INTERESTS, 3),
        "self.lifestyle": some(rng, LIFESTYLE, 2),
        "self.communication_style": some(rng, STYLES, 1),
      },
      embedding: unit(centroid.map((value) => value + noise(rng) * spread)),
    };
  });
}
