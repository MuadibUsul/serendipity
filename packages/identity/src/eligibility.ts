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
export interface Attestation {
  readonly provider: string;
  readonly providerRef: string;
  readonly ageVerified: boolean;
  readonly realPersonVerified: boolean;
  /** When the provider checked. */
  readonly verifiedAt: Date;
  readonly expiresAt: Date | null;
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
  | "unavailable";

export type Eligibility =
  | { readonly eligible: true; readonly until: Date | null }
  | { readonly eligible: false; readonly reason: IneligibleReason };

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
): Eligibility {
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
