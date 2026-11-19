/**
 * Pausing and resuming matching (PRD-001 §7; PLAN-001 P05-04).
 *
 * - The person may pause at any time, for a break or because they are in a
 *   relationship. A paused account keeps its profile, consent and history;
 *   it is simply not matched (recall and `decidePair` take active accounts
 *   only), and no new invitation reaches it.
 * - Resuming is not a switch back. The person confirms that they want to be
 *   matched again and that their key preferences still hold. If their
 *   matching consent is gone, they have no approved profile, or the profile
 *   was last reviewed too long ago, those come first. An account that asked
 *   to be deleted is never resumed here.
 * - Nothing is inferred: the app never decides someone's relationship ended
 *   because they went quiet.
 */
import type { AccountState } from "./account.js";

export const PAUSE_REASONS = ["break", "relationship"] as const;
export type PauseReason = (typeof PAUSE_REASONS)[number];

/** A profile approved longer ago than this is reviewed again before matching resumes. */
export const PROFILE_REVIEW_AFTER_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;

export type PauseRefusal = "suspended" | "deleted" | "deletion_requested";

/** Whether the account may be paused now; pausing again just updates the reason. */
export function pauseRefusal(
  status: AccountState,
  deletionRequested: boolean,
): PauseRefusal | null {
  if (deletionRequested) return "deletion_requested";
  if (status === "suspended" || status === "deleted") return status;
  return null;
}

/** What still has to happen before matching resumes, in the order the app asks for it. */
export type ResumeNeed =
  /** Deleting the account is under way: it cannot be resumed. */
  | "deletion_requested"
  /** The matching consent (`profile_matching`) is not held. */
  | "matching_consent"
  /** No approved profile. */
  | "approved_profile"
  /** The approved profile was reviewed more than `PROFILE_REVIEW_AFTER_DAYS` ago. */
  | "profile_review"
  /** The person has not yet confirmed they want matching back and their key preferences hold. */
  | "confirmation";

export interface ResumeState {
  readonly status: AccountState;
  readonly deletionRequested: boolean;
  readonly matchingConsent: boolean;
  /** When the approved profile version was approved, or `null` without one. */
  readonly profileApprovedAt: Date | null;
  /** The person confirmed, on the resume screen, that they want matching back as shown. */
  readonly confirmed: boolean;
}

export type ResumeCheck =
  | { readonly kind: "not_paused" }
  | { readonly kind: "needs"; readonly needs: readonly ResumeNeed[] }
  | { readonly kind: "ready" };

export function resumeCheck(state: ResumeState, now: Date): ResumeCheck {
  if (state.status !== "paused") return { kind: "not_paused" };
  if (state.deletionRequested) return { kind: "needs", needs: ["deletion_requested"] };
  const needs: ResumeNeed[] = [];
  if (!state.matchingConsent) needs.push("matching_consent");
  if (state.profileApprovedAt === null) {
    needs.push("approved_profile");
  } else if (
    now.getTime() - state.profileApprovedAt.getTime() >
    PROFILE_REVIEW_AFTER_DAYS * DAY_MS
  ) {
    needs.push("profile_review");
  }
  if (!state.confirmed) needs.push("confirmation");
  return needs.length === 0 ? { kind: "ready" } : { kind: "needs", needs };
}
