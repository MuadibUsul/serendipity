import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_WEIGHTS,
  MAX_APPEARANCE_SHARE,
  NEUTRAL,
  directional,
  rankCandidates,
  scorePair,
} from "./rank.js";
import type { Candidate, RankProfile, Wish } from "./rank.js";

const TAGS = ["hiking", "films", "cooking", "music", "reading", "direct", "playful", "quiet"];
const LOOKS = ["natural_style", "short_hair", "glasses", "sporty"];

const tagsArb = (pool: readonly string[]) => fc.subarray([...pool], { maxLength: 4 });
const wishesArb = (pool: readonly string[]): fc.Arbitrary<Wish[]> =>
  fc
    .subarray([...pool], { maxLength: 4 })
    .chain((tags) =>
      fc
        .tuple(...tags.map(() => fc.constantFrom<1 | 2 | 3>(1, 2, 3)))
        .map((weights) => tags.map((tag, i) => ({ tag, weight: weights[i] ?? 1 }))),
    );

const profileArb = (userId: string): fc.Arbitrary<RankProfile> =>
  fc.record({
    userId: fc.constant(userId),
    self: fc.record({
      interests: tagsArb(TAGS),
      communication: tagsArb(TAGS),
      appearance: tagsArb(LOOKS),
    }),
    seeking: fc.record({
      interests: wishesArb(TAGS),
      communication: wishesArb(TAGS),
      appearance: wishesArb(LOOKS),
    }),
  });

const similarityArb = fc.oneof(fc.constant(null), fc.double({ min: -1, max: 1, noNaN: true }));
const exposuresArb = fc.record({ a: fc.nat(10), b: fc.nat(10) });

describe("scorePair", () => {
  it("is symmetric and never above either direction", () => {
    fc.assert(
      fc.property(profileArb("a"), profileArb("b"), similarityArb, exposuresArb, (a, b, s, e) => {
        const ab = scorePair(a, b, { similarity: s, recentExposures: e });
        const ba = scorePair(b, a, { similarity: s, recentExposures: { a: e.b, b: e.a } });
        expect(ba.score).toBeCloseTo(ab.score, 12);
        expect(ab.score).toBeLessThanOrEqual(Math.min(ab.aToB, ab.bToA) + 1e-12);
        expect(ab.score).toBeGreaterThanOrEqual(0);
        expect(ab.score).toBeLessThanOrEqual(1);
      }),
    );
  });

  it("never drops when the other person gains a tag that was wished for", () => {
    fc.assert(
      fc.property(
        profileArb("a"),
        profileArb("b"),
        similarityArb,
        fc.constantFrom(...TAGS),
        (a, b, s, tag) => {
          const before = directional(a, b, s);
          const richer: RankProfile = {
            ...b,
            self: { ...b.self, interests: [...new Set([...b.self.interests, tag])] },
          };
          expect(directional(a, richer, s)).toBeGreaterThanOrEqual(before - 1e-12);
        },
      ),
    );
  });

  it("lets appearance move S by at most its share, and not at all when off", () => {
    fc.assert(
      fc.property(
        profileArb("a"),
        profileArb("b"),
        profileArb("c"),
        similarityArb,
        (a, b, c, s) => {
          // b and c differ only in appearance.
          const lookAlike: RankProfile = {
            ...c,
            self: { ...b.self, appearance: c.self.appearance },
          };
          const gap = Math.abs(directional(a, b, s) - directional(a, lookAlike, s));
          expect(gap).toBeLessThanOrEqual(MAX_APPEARANCE_SHARE + 1e-12);
          const off = { ...DEFAULT_WEIGHTS, appearance: 0 };
          expect(directional(a, b, s, off)).toBeCloseTo(directional(a, lookAlike, s, off), 12);
          // A configured weight above the cap is held to it.
          const greedy = { ...DEFAULT_WEIGHTS, appearance: 0.9 };
          expect(
            Math.abs(directional(a, b, s, greedy) - directional(a, lookAlike, s, greedy)),
          ).toBeLessThanOrEqual(MAX_APPEARANCE_SHARE + 1e-12);
        },
      ),
    );
  });

  it("treats a person who wished for nothing as neutral, not as a poor fit", () => {
    const blank: RankProfile = {
      userId: "a",
      self: { interests: [], communication: [], appearance: [] },
      seeking: { interests: [], communication: [], appearance: [] },
    };
    fc.assert(
      fc.property(profileArb("b"), (b) => {
        expect(directional(blank, b, null)).toBe(NEUTRAL);
      }),
    );
  });
});

describe("rankCandidates", () => {
  const candidatesArb = fc
    .array(fc.tuple(profileArb("x"), similarityArb, fc.nat(8)), { maxLength: 30 })
    .map((rows) =>
      rows.map(([profile, similarity, recentExposures], i): Candidate => ({
        profile: { ...profile, userId: `u${String(i)}` },
        similarity,
        recentExposures,
      })),
    );
  const optionsArb = fc.record({
    k: fc.integer({ min: 0, max: 12 }),
    floor: fc.double({ min: 0, max: 0.8, noNaN: true }),
    exploration: fc.double({ min: 0, max: 1, noNaN: true }),
    seed: fc.string({ maxLength: 8 }),
  });

  it("returns at most k distinct candidates, none below the floor, the same for the same seed", () => {
    fc.assert(
      fc.property(profileArb("me"), candidatesArb, optionsArb, (me, candidates, options) => {
        const ranked = rankCandidates(me, candidates, options);
        expect(ranked.length).toBeLessThanOrEqual(options.k);
        expect(new Set(ranked.map((r) => r.userId)).size).toBe(ranked.length);
        for (const r of ranked) expect(r.pair.score).toBeGreaterThanOrEqual(options.floor);
        expect(rankCandidates(me, candidates, options)).toEqual(ranked);
      }),
    );
  });

  it("without exploration, is the best pairs in order", () => {
    fc.assert(
      fc.property(profileArb("me"), candidatesArb, optionsArb, (me, candidates, options) => {
        const ranked = rankCandidates(me, candidates, { ...options, exploration: 0 });
        const scores = ranked.map((r) => r.pair.score);
        expect(scores).toEqual([...scores].sort((x, y) => y - x));
        expect(ranked.every((r) => !r.explored)).toBe(true);
        const eligible = candidates.filter(
          (c) =>
            scorePair(me, c.profile, {
              similarity: c.similarity,
              recentExposures: { a: 0, b: c.recentExposures },
            }).score >= options.floor,
        ).length;
        expect(ranked.length).toBe(Math.min(options.k, eligible));
      }),
    );
  });

  it("never puts the person forward to themselves", () => {
    fc.assert(
      fc.property(profileArb("me"), optionsArb, (me, options) => {
        const ranked = rankCandidates(me, [{ profile: me, similarity: 1, recentExposures: 0 }], {
          ...options,
          floor: 0,
        });
        expect(ranked).toEqual([]);
      }),
    );
  });
});
