import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { ACCOUNT_STATES } from "./account.js";
import { PROFILE_REVIEW_AFTER_DAYS, pauseRefusal, resumeCheck } from "./pause.js";
import type { ResumeState } from "./pause.js";

const NOW = new Date("2026-11-19T09:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const ready: ResumeState = {
  status: "paused",
  deletionRequested: false,
  matchingConsent: true,
  profileApprovedAt: new Date(NOW.getTime() - 30 * DAY),
  confirmed: true,
};

describe("pauseRefusal", () => {
  it("lets a pending, active or already paused account pause", () => {
    expect(pauseRefusal("pending", false)).toBeNull();
    expect(pauseRefusal("active", false)).toBeNull();
    expect(pauseRefusal("paused", false)).toBeNull();
  });

  it("refuses a suspended or deleted account, and one being deleted", () => {
    expect(pauseRefusal("suspended", false)).toBe("suspended");
    expect(pauseRefusal("deleted", false)).toBe("deleted");
    expect(pauseRefusal("paused", true)).toBe("deletion_requested");
  });
});

describe("resumeCheck", () => {
  it("is ready once everything holds and the person confirmed", () => {
    expect(resumeCheck(ready, NOW)).toEqual({ kind: "ready" });
  });

  it("only resumes a paused account", () => {
    for (const status of ACCOUNT_STATES.filter((s) => s !== "paused")) {
      expect(resumeCheck({ ...ready, status }, NOW)).toEqual({ kind: "not_paused" });
    }
  });

  it("never resumes an account being deleted, whatever else holds", () => {
    expect(resumeCheck({ ...ready, deletionRequested: true }, NOW)).toEqual({
      kind: "needs",
      needs: ["deletion_requested"],
    });
  });

  it("asks for everything missing, in order", () => {
    expect(
      resumeCheck(
        { ...ready, matchingConsent: false, profileApprovedAt: null, confirmed: false },
        NOW,
      ),
    ).toEqual({ kind: "needs", needs: ["matching_consent", "approved_profile", "confirmation"] });
  });

  it("asks for a profile review after the review period, not before", () => {
    const at = (days: number) => new Date(NOW.getTime() - days * DAY);
    expect(
      resumeCheck({ ...ready, profileApprovedAt: at(PROFILE_REVIEW_AFTER_DAYS) }, NOW),
    ).toEqual({
      kind: "ready",
    });
    expect(
      resumeCheck({ ...ready, profileApprovedAt: at(PROFILE_REVIEW_AFTER_DAYS + 1) }, NOW),
    ).toEqual({ kind: "needs", needs: ["profile_review"] });
  });

  it("is ready only when every condition holds", () => {
    fc.assert(
      fc.property(
        fc.record({
          status: fc.constantFrom(...ACCOUNT_STATES),
          deletionRequested: fc.boolean(),
          matchingConsent: fc.boolean(),
          profileApprovedAt: fc.option(fc.integer({ min: 0, max: 400 }), { nil: null }),
          confirmed: fc.boolean(),
        }),
        (s) => {
          const state: ResumeState = {
            ...s,
            profileApprovedAt:
              s.profileApprovedAt === null
                ? null
                : new Date(NOW.getTime() - s.profileApprovedAt * DAY),
          };
          const fresh =
            s.profileApprovedAt !== null && s.profileApprovedAt <= PROFILE_REVIEW_AFTER_DAYS;
          const all =
            s.status === "paused" &&
            !s.deletionRequested &&
            s.matchingConsent &&
            fresh &&
            s.confirmed;
          expect(resumeCheck(state, NOW).kind === "ready").toBe(all);
        },
      ),
    );
  });
});
