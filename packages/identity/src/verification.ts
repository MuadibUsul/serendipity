/**
 * Starting a check, and forgetting it (ADR-0025, following ADR-0024).
 *
 * A check starts only once the person has given a date of birth and the
 * separate biometric consent, at most a few times a day (each check is paid
 * for, and repeated attempts are how people probe a vendor). Which check is
 * asked for follows tiering: a selfie liveness check, or an ID + selfie check
 * when eligibility says one is needed.
 *
 * The vendor keeps the selfie video and any ID; we keep only its verdict and
 * reference. When the person withdraws the consent or deletes their account,
 * every reference they had is queued, and a worker asks the vendor to delete
 * what it holds until the vendor confirms.
 */
import type { Eligibility } from "./eligibility.js";
import type { Level } from "./tiers.js";

/** Checks a person may start in one day (in the market's time zone). */
export const STARTS_PER_DAY = 3;

export type StartRefusal =
  /** The date of birth comes first: an under-18 never reaches a vendor. */
  | "no_birth_date"
  /** The biometric consent comes first, and is asked for on its own. */
  | "no_consent"
  /** Nothing to check: they are eligible already. */
  | "already_verified"
  | "daily_limit"
  /** Suspended, deleted, or being deleted. */
  | "account_closed";

export interface StartFacts {
  readonly hasBirthDate: boolean;
  readonly biometricConsent: boolean;
  readonly startsToday: number;
  readonly accountOpen: boolean;
  readonly eligibility: Eligibility;
}

/** Why a check cannot start now, or `null`. The first unmet step wins. */
export function startRefusal(facts: StartFacts): StartRefusal | null {
  if (!facts.accountOpen) return "account_closed";
  if (!facts.hasBirthDate) return "no_birth_date";
  if (!facts.biometricConsent) return "no_consent";
  if (facts.eligibility.eligible) return "already_verified";
  if (facts.startsToday >= STARTS_PER_DAY) return "daily_limit";
  return null;
}

/**
 * The check to ask for: an ID + selfie check when tiering asks for one, a
 * selfie liveness check otherwise. Under-18 never gets here (no vendor is
 * asked to check a declared minor).
 */
export function levelFor(eligibility: Eligibility): Level {
  return !eligibility.eligible && eligibility.reason === "document_required"
    ? "document"
    : "liveness";
}

/** One reference a vendor still has to delete. */
export interface VendorDeletion {
  readonly provider: string;
  readonly providerRef: string;
}

export interface VendorDeletionQueue {
  pending(limit: number): Promise<readonly VendorDeletion[]>;
  /** The vendor confirmed: the request is done. */
  done(deletion: VendorDeletion): Promise<void>;
  /** The vendor could not be reached or refused: try again later. */
  failed(deletion: VendorDeletion): Promise<void>;
}

/** What a vendor adapter offers for deletion. */
export interface VendorEraser {
  readonly name: string;
  deleteData(providerRef: string): Promise<void>;
}

/**
 * Asks each vendor to delete what it holds, one reference at a time. A
 * reference for a vendor that is not configured stays queued: it is never
 * marked done without the vendor saying so.
 */
export async function drainVendorDeletions(
  queue: VendorDeletionQueue,
  vendors: readonly VendorEraser[],
  limit = 100,
): Promise<{ readonly done: number; readonly failed: number; readonly skipped: number }> {
  const byName = new Map(vendors.map((vendor) => [vendor.name, vendor]));
  let done = 0;
  let failed = 0;
  let skipped = 0;
  for (const deletion of await queue.pending(limit)) {
    const vendor = byName.get(deletion.provider);
    if (vendor === undefined) {
      skipped += 1;
      continue;
    }
    try {
      await vendor.deleteData(deletion.providerRef);
    } catch {
      await queue.failed(deletion);
      failed += 1;
      continue;
    }
    await queue.done(deletion);
    done += 1;
  }
  return { done, failed, skipped };
}
