/**
 * Tiered age and real-person checks (ADR-0024, owner decision 2026-11-20).
 *
 * 1. At sign-up the person gives a date of birth; under 18 is refused.
 * 2. Before matching: a selfie liveness check, matched against their photos,
 *    with an age estimate. Passing liveness shows a real person; it does not
 *    by itself prove they are an adult.
 * 3. An ID + selfie check is required only when it is needed: the age is
 *    uncertain or does not fit what they declared, the face does not match,
 *    someone reported them for impersonation or as a suspected minor, or the
 *    region requires it. Until it passes they cannot match or message.
 * 4. Refusals can be appealed to a person (the safety flow, ADR-0022).
 *
 * Every rule here is pure and configurable per market; a vendor does the
 * checks, and only its verdicts reach this code.
 */

export const LEVELS = ["liveness", "document"] as const;
export type Level = (typeof LEVELS)[number];

export const MINIMUM_AGE = 18;

export interface TierPolicy {
  /** An estimated age below this asks for an ID ("Challenge 25"). */
  readonly minEstimatedAge: number;
  /** An estimate further than this from the declared age asks for an ID. */
  readonly maxAgeGap: number;
  /** Regions where the law asks for an ID check for everyone. */
  readonly documentRegions: readonly string[];
}

export const DEFAULT_TIER_POLICY: TierPolicy = {
  minEstimatedAge: 25,
  maxAgeGap: 8,
  documentRegions: [],
};

/** What we know about the person besides the vendor's verdicts. */
export interface TierFacts {
  /** From the date of birth given at sign-up; `null` when not given yet. */
  readonly declaredAge: number | null;
  readonly region: string | null;
  /** An open or upheld report says they may not be who they say. */
  readonly impersonationReported: boolean;
  /** An open or upheld report says they may be under 18. */
  readonly minorSuspected: boolean;
}

/** The liveness verdict tiering looks at. */
export interface LivenessVerdict {
  readonly realPersonVerified: boolean;
  /** `false` when the selfie does not match the profile photos; `null` when not compared. */
  readonly faceMatch: boolean | null;
  readonly estimatedAge: number | null;
}

export type DocumentReason =
  | "impersonation_reported"
  | "minor_suspected"
  | "region_requires_document"
  | "liveness_failed"
  | "face_mismatch"
  | "age_unknown"
  | "age_estimate_low"
  | "age_mismatch";

export type Requirement =
  { readonly level: "liveness" } | { readonly level: "document"; readonly because: DocumentReason };

/**
 * Which check the person needs, given their latest liveness verdict (or none
 * yet). The first reason that applies is given, for the audit and appeal.
 */
export function requiredLevel(
  liveness: LivenessVerdict | null,
  facts: TierFacts,
  policy: TierPolicy = DEFAULT_TIER_POLICY,
): Requirement {
  const document = (because: DocumentReason): Requirement => ({ level: "document", because });
  if (facts.impersonationReported) return document("impersonation_reported");
  if (facts.minorSuspected) return document("minor_suspected");
  if (facts.region !== null && policy.documentRegions.includes(facts.region)) {
    return document("region_requires_document");
  }
  if (liveness === null) return { level: "liveness" };
  if (!liveness.realPersonVerified) return document("liveness_failed");
  if (liveness.faceMatch === false) return document("face_mismatch");
  if (liveness.estimatedAge === null || facts.declaredAge === null) return document("age_unknown");
  if (liveness.estimatedAge < policy.minEstimatedAge) return document("age_estimate_low");
  if (Math.abs(liveness.estimatedAge - facts.declaredAge) > policy.maxAgeGap) {
    return document("age_mismatch");
  }
  return { level: "liveness" };
}

/** Whole years between a date of birth (YYYY-MM-DD) and `today` (YYYY-MM-DD). */
export function ageOn(birthDate: string, today: string): number | null {
  const born = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate);
  const now = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
  if (born === null || now === null) return null;
  const [by, bm, bd] = [Number(born[1]), Number(born[2]), Number(born[3])];
  const [ny, nm, nd] = [Number(now[1]), Number(now[2]), Number(now[3])];
  const check = new Date(Date.UTC(by, bm - 1, bd));
  if (
    check.getUTCFullYear() !== by ||
    check.getUTCMonth() !== bm - 1 ||
    check.getUTCDate() !== bd
  ) {
    return null;
  }
  const age = ny - by - (nm < bm || (nm === bm && nd < bd) ? 1 : 0);
  return age >= 0 && age <= 120 ? age : null;
}

export type BirthDateRefusal = "invalid" | "under_age";

/** Whether a date of birth may be accepted at sign-up. */
export function birthDateRefusal(birthDate: string, today: string): BirthDateRefusal | null {
  const age = ageOn(birthDate, today);
  if (age === null) return "invalid";
  return age < MINIMUM_AGE ? "under_age" : null;
}
