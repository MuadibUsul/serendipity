import { describe, expect, it } from "vitest";

import { mayRecall, recallEntryOf, requiredQuarters } from "./recall.js";
import type { RecallContext, RecallEntry } from "./recall.js";
import { BASE_RULES, snapshot } from "./test-support.js";

const NOW = new Date("2026-11-18T04:00:00Z");
const CONTEXT: RecallContext = {
  dateLengthMinutes: 90,
  cheapestPackagePerPerson: { currency: "CNY", minor: 8_800 },
};

function entry(userId: string, until: Date | null = null): RecallEntry {
  const result = recallEntryOf({
    userId,
    age: 30,
    profileSnapshot: snapshot({ ...BASE_RULES }),
    confirmedSelfTags: [],
    identity: { eligible: true, until },
  });
  if (!result.ok) throw new Error(result.reason);
  return result.entry;
}

describe("mayRecall", () => {
  it("keeps two compatible people", () => {
    expect(mayRecall(entry("ana"), entry("bo"), CONTEXT, NOW)).toBe(true);
  });

  it("drops a person whose identity verdict has run out, on either side", () => {
    const expired = entry("bo", new Date(NOW.getTime() - 1));
    expect(mayRecall(entry("ana"), expired, CONTEXT, NOW)).toBe(false);
    expect(mayRecall(expired, entry("ana"), CONTEXT, NOW)).toBe(false);
  });

  it("treats the expiry moment itself as expired", () => {
    expect(mayRecall(entry("ana"), entry("bo", NOW), CONTEXT, NOW)).toBe(false);
    const later = new Date(NOW.getTime() + 1);
    expect(mayRecall(entry("ana"), entry("bo", later), CONTEXT, NOW)).toBe(true);
  });
});

describe("recallEntryOf", () => {
  it("builds no entry without identity, a known adult age or a readable profile", () => {
    const base = {
      userId: "ana",
      age: 30,
      profileSnapshot: snapshot({ ...BASE_RULES }),
      confirmedSelfTags: [],
      identity: { eligible: true, until: null },
    } as const;
    expect(recallEntryOf({ ...base, identity: { eligible: false } })).toEqual({
      ok: false,
      reason: "identity_ineligible",
    });
    for (const age of [null, 17, 121, 30.5]) {
      expect(recallEntryOf({ ...base, age })).toEqual({ ok: false, reason: "age_unknown" });
    }
    expect(recallEntryOf({ ...base, profileSnapshot: null })).toEqual({
      ok: false,
      reason: "profile_unusable",
    });
  });
});

describe("requiredQuarters", () => {
  it("refuses date lengths recall cannot vouch for", () => {
    for (const length of [0, 29, 45.5, Number.NaN]) {
      expect(() => requiredQuarters(length)).toThrow(RangeError);
    }
    expect(requiredQuarters(30)).toBe(1);
    expect(requiredQuarters(90)).toBe(5);
  });
});
