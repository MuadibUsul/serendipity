/**
 * Who may be invited to a date or pay for one (PRD-001 §8.1, ARCH-001 §4
 * Identity: `eligible(user_id)`). Deny by default: a person is eligible only
 * with a current attestation from the configured provider that proves both
 * that they are an adult and that they are a real person.
 *
 * An attestation is what a verification provider told us: booleans, a
 * reference into the provider's records and two times. Never an ID image, a
 * document number or a birthdate (ARCH-001 §10.2).
 */
import { DEFAULT_TIER_POLICY, MINIMUM_AGE, requiredLevel } from "./tiers.js";
import type { DocumentReason, Level, TierFacts, TierPolicy } from "./tiers.js";

export interface Attestation {
  readonly provider: string;
  readonly providerRef: string;
  readonly ageVerified: boolean;
  readonly realPersonVerified: boolean;
  /** When the provider checked. */
  readonly verifiedAt: Date;
  readonly expiresAt: Date | null;
  /**
   * Which check this was (ADR-0024). Older rows, and vendors that only do ID
   * checks, are `document`: the strictest reading.
   */
  readonly level?: Level;
  /** A liveness check's age estimate; never proof of adulthood alone. */
  readonly estimatedAge?: number | null;
  /** Whether the selfie matched the profile photos; `null` when not compared. */
  readonly faceMatch?: boolean | null;
}

export type IneligibleReason =
  /** No attestation at all. */
  | "not_verified"
  /** The latest check did not establish adult age. */
  | "age_not_verified"
  /** Adult, but not shown to be a real person. */
  | "real_person_not_verified"
  /** Every attestation has expired. */
  | "expired"
  /** The answer could not be found out: provider or database failing. */
  | "unavailable"
  /** The date of birth given says under 18. */
  | "under_age"
  /** An ID + selfie check is needed before matching (ADR-0024). */
  | "document_required";

export type Eligibility =
  | { readonly eligible: true; readonly until: Date | null }
  | {
      readonly eligible: false;
      readonly reason: IneligibleReason;
      /** Why an ID check is needed, when it is (for the audit and an appeal). */
      readonly because?: DocumentReason;
    };

export interface EligibilityPolicy {
  /** Only attestations from this provider count (a fake one never counts in production). */
  readonly provider: string;
  /** PRD-001 §8.1 asks for real-person checks; on unless a later decision says otherwise. */
  readonly requireRealPerson: boolean;
}

const isCurrent = (attestation: Attestation, now: Date) =>
  attestation.verifiedAt.getTime() <= now.getTime() &&
  (attestation.expiresAt === null || attestation.expiresAt.getTime() > now.getTime());

/**
 * The latest current attestation decides, so a later failed re-check (a
 * revocation) wins over an earlier success.
 */
export function eligibility(
  attestations: readonly Attestation[],
  now: Date,
  policy: EligibilityPolicy,
  facts?: TierFacts,
  tierPolicy: TierPolicy = DEFAULT_TIER_POLICY,
): Eligibility {
  if (facts !== undefined) return tieredEligibility(attestations, now, policy, facts, tierPolicy);
  const fromProvider = attestations.filter((a) => a.provider === policy.provider);
  if (fromProvider.length === 0) return { eligible: false, reason: "not_verified" };
  const current = fromProvider.filter((a) => isCurrent(a, now));
  if (current.length === 0) return { eligible: false, reason: "expired" };
  const latest = current.reduce((a, b) =>
    b.verifiedAt.getTime() > a.verifiedAt.getTime() ? b : a,
  );
  if (!latest.ageVerified) return { eligible: false, reason: "age_not_verified" };
  if (policy.requireRealPerson && !latest.realPersonVerified) {
    return { eligible: false, reason: "real_person_not_verified" };
  }
  return { eligible: true, until: latest.expiresAt };
}

const levelOf = (attestation: Attestation): Level => attestation.level ?? "document";

const latestOf = (attestations: readonly Attestation[]): Attestation | null =>
  attestations.reduce<Attestation | null>(
    (latest, a) =>
      latest === null || a.verifiedAt.getTime() > latest.verifiedAt.getTime() ? a : latest,
    null,
  );

/**
 * The tiered decision (ADR-0024):
 * - Under 18 by the date of birth given: never.
 * - A failed ID check blocks; a passed one is enough on its own.
 * - Otherwise the latest liveness verdict and the facts decide which check
 *   is needed: a passed liveness check is enough when no ID check is.
 */
function tieredEligibility(
  attestations: readonly Attestation[],
  now: Date,
  policy: EligibilityPolicy,
  facts: TierFacts,
  tierPolicy: TierPolicy,
): Eligibility {
  if (facts.declaredAge !== null && facts.declaredAge < MINIMUM_AGE) {
    return { eligible: false, reason: "under_age" };
  }
  const fromProvider = attestations.filter((a) => a.provider === policy.provider);
  const current = fromProvider.filter((a) => isCurrent(a, now));
  const document = latestOf(current.filter((a) => levelOf(a) === "document"));
  const liveness = latestOf(current.filter((a) => levelOf(a) === "liveness"));

  if (document !== null) {
    if (!document.ageVerified) return { eligible: false, reason: "age_not_verified" };
    if (policy.requireRealPerson && !document.realPersonVerified) {
      return { eligible: false, reason: "real_person_not_verified" };
    }
    return { eligible: true, until: document.expiresAt };
  }
  const need = requiredLevel(
    liveness === null
      ? null
      : {
          realPersonVerified: liveness.realPersonVerified,
          faceMatch: liveness.faceMatch ?? null,
          estimatedAge: liveness.estimatedAge ?? null,
        },
    facts,
    tierPolicy,
  );
  if (need.level === "document") {
    return { eligible: false, reason: "document_required", because: need.because };
  }
  if (liveness === null) {
    return { eligible: false, reason: fromProvider.length > 0 ? "expired" : "not_verified" };
  }
  return { eligible: true, until: liveness.expiresAt };
}
