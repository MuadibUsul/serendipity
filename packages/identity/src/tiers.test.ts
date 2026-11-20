import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { eligibility } from "./eligibility.js";
import type { Attestation } from "./eligibility.js";
import { ageOn, birthDateRefusal, requiredLevel } from "./tiers.js";
import type { LivenessVerdict, TierFacts } from "./tiers.js";

const NOW = new Date("2026-11-20T18:00:00Z");
const LATER = new Date("2027-11-20T18:00:00Z");
const POLICY = { provider: "vendor", requireRealPerson: true };
const facts: TierFacts = {
  declaredAge: 30,
  region: "SFB_BAYAREA",
  impersonationReported: false,
  minorSuspected: false,
};
const passed: LivenessVerdict = { realPersonVerified: true, faceMatch: true, estimatedAge: 31 };

const attestation = (over: Partial<Attestation>): Attestation => ({
  provider: "vendor",
  providerRef: `ref_${Math.random().toString(36).slice(2, 10)}`,
  ageVerified: false,
  realPersonVerified: true,
  verifiedAt: new Date("2026-11-20T10:00:00Z"),
  expiresAt: LATER,
  level: "liveness",
  estimatedAge: 31,
  faceMatch: true,
  ...over,
});

describe("requiredLevel", () => {
  it("starts with a liveness check, and stops there when everything fits", () => {
    expect(requiredLevel(null, facts)).toEqual({ level: "liveness" });
    expect(requiredLevel(passed, facts)).toEqual({ level: "liveness" });
  });

  it.each([
    [{ ...passed, realPersonVerified: false }, facts, "liveness_failed"],
    [{ ...passed, faceMatch: false }, facts, "face_mismatch"],
    [{ ...passed, estimatedAge: null }, facts, "age_unknown"],
    [passed, { ...facts, declaredAge: null }, "age_unknown"],
    [{ ...passed, estimatedAge: 22 }, { ...facts, declaredAge: 22 }, "age_estimate_low"],
    [{ ...passed, estimatedAge: 45 }, facts, "age_mismatch"],
    [passed, { ...facts, impersonationReported: true }, "impersonation_reported"],
    [null, { ...facts, minorSuspected: true }, "minor_suspected"],
  ] as const)("asks for an ID when %o / %o", (liveness, f, because) => {
    expect(requiredLevel(liveness, f)).toEqual({ level: "document", because });
  });

  it("asks everyone for an ID where the region requires it", () => {
    expect(
      requiredLevel(passed, facts, {
        minEstimatedAge: 25,
        maxAgeGap: 8,
        documentRegions: ["SFB_BAYAREA"],
      }),
    ).toEqual({ level: "document", because: "region_requires_document" });
  });

  it("never settles for liveness alone when the estimate is under 25 or the face does not match", () => {
    fc.assert(
      fc.property(
        fc.record({
          realPersonVerified: fc.boolean(),
          faceMatch: fc.option(fc.boolean(), { nil: null }),
          estimatedAge: fc.option(fc.integer({ min: 10, max: 90 }), { nil: null }),
        }),
        fc.option(fc.integer({ min: 18, max: 90 }), { nil: null }),
        (liveness, declaredAge) => {
          const need = requiredLevel(liveness, { ...facts, declaredAge });
          if (
            !liveness.realPersonVerified ||
            liveness.faceMatch === false ||
            liveness.estimatedAge === null ||
            liveness.estimatedAge < 25
          ) {
            expect(need.level).toBe("document");
          }
        },
      ),
    );
  });
});

describe("tiered eligibility", () => {
  it("is eligible after a passed liveness check when no ID is needed", () => {
    expect(eligibility([attestation({})], NOW, POLICY, facts)).toEqual({
      eligible: true,
      until: LATER,
    });
  });

  it("asks for an ID, with the reason, when liveness is not enough", () => {
    expect(
      eligibility([attestation({ estimatedAge: 20 })], NOW, POLICY, { ...facts, declaredAge: 20 }),
    ).toEqual({
      eligible: false,
      reason: "document_required",
      because: "age_estimate_low",
    });
  });

  it("lets a passed ID check settle it, and a failed one block it", () => {
    const low = attestation({ estimatedAge: 20 });
    const id = attestation({
      level: "document",
      ageVerified: true,
      verifiedAt: new Date("2026-11-20T11:00:00Z"),
    });
    expect(eligibility([low, id], NOW, POLICY, { ...facts, declaredAge: 20 })).toEqual({
      eligible: true,
      until: LATER,
    });
    const failed = { ...id, ageVerified: false };
    expect(eligibility([attestation({}), failed], NOW, POLICY, facts)).toMatchObject({
      eligible: false,
      reason: "age_not_verified",
    });
  });

  it("never lets a liveness check prove adulthood when a report suspects a minor", () => {
    expect(
      eligibility([attestation({})], NOW, POLICY, { ...facts, minorSuspected: true }),
    ).toMatchObject({
      eligible: false,
      reason: "document_required",
      because: "minor_suspected",
    });
  });

  it("refuses anyone under 18 by the date of birth they gave, whatever else holds", () => {
    const id = attestation({ level: "document", ageVerified: true });
    expect(eligibility([id], NOW, POLICY, { ...facts, declaredAge: 17 })).toEqual({
      eligible: false,
      reason: "under_age",
    });
  });

  it("needs a check at all, and a current one", () => {
    expect(eligibility([], NOW, POLICY, facts)).toEqual({
      eligible: false,
      reason: "not_verified",
    });
    expect(
      eligibility(
        [attestation({ expiresAt: new Date("2026-11-20T12:00:00Z") })],
        NOW,
        POLICY,
        facts,
      ),
    ).toEqual({
      eligible: false,
      reason: "expired",
    });
  });

  it("keeps the old strict reading when no facts are given: liveness alone never counts", () => {
    expect(eligibility([attestation({})], NOW, POLICY)).toEqual({
      eligible: false,
      reason: "age_not_verified",
    });
  });
});

describe("dates of birth", () => {
  it("counts whole years, birthday included", () => {
    expect(ageOn("2008-11-20", "2026-11-20")).toBe(18);
    expect(ageOn("2008-11-21", "2026-11-20")).toBe(17);
    expect(ageOn("2000-02-29", "2026-02-28")).toBe(25);
    expect(ageOn("2026-02-30", "2026-11-20")).toBeNull();
    expect(ageOn("not a date", "2026-11-20")).toBeNull();
  });

  it("accepts 18 and over only", () => {
    expect(birthDateRefusal("2008-11-20", "2026-11-20")).toBeNull();
    expect(birthDateRefusal("2008-11-21", "2026-11-20")).toBe("under_age");
    expect(birthDateRefusal("1890-01-01", "2026-11-20")).toBe("invalid");
  });
});
