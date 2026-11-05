import { assertNever } from "../assert-never.js";
import type { Party } from "./state.js";

/** The parts of the system that send date events on their own. */
export type SystemSource =
  /** The deterministic match verifier (ser-p03-07). */
  | "verifier"
  /** The invite / payment / venue saga (ser-p04-06). */
  | "booking"
  /** Verified payment-provider callbacks and reconciliation (ser-p04-05). */
  | "payments"
  /** Time-based jobs: expiry, end of the date window, feedback window. */
  | "scheduler"
  /** Automatic risk controls; their decisions are reviewed by a person (ARCH-001 §4). */
  | "risk";

/** Who sends an event. Authorisation of the actor itself happens before this layer. */
export type Actor =
  | { readonly kind: "user"; readonly party: Party }
  | { readonly kind: "merchant" }
  | { readonly kind: "staff"; readonly role: "ops" | "safety" }
  | { readonly kind: "system"; readonly source: SystemSource }
  /**
   * A model or agent. It may propose, never decide: no date event accepts an
   * agent (ARCH-001 §10.3, ADR-003).
   */
  | { readonly kind: "agent" };

/** How a person resolves a no-show review or a dispute. */
export type MoneyResolution = "refund" | "partial_refund" | "no_refund";

/** How the safety team resolves a hold. `close` ends the date without a refund. */
export type SafetyResolution = "resume" | "cancel" | "partial_refund" | "close";

export type DateEvent =
  | { readonly type: "VERIFIER_PASSED" }
  | { readonly type: "VERIFIER_REJECTED" }
  | { readonly type: "INVITES_SENT" }
  | { readonly type: "PARTY_ACCEPTED"; readonly party: Party }
  | { readonly type: "PAYMENTS_OPENED" }
  | { readonly type: "PARTY_PAID"; readonly party: Party }
  | { readonly type: "VENUE_CONFIRMED" }
  | { readonly type: "VENUE_FAILED" }
  | { readonly type: "BOOKING_CONFIRMED" }
  | { readonly type: "PARTY_CHECKED_IN"; readonly party: Party }
  | { readonly type: "REVEAL" }
  | { readonly type: "DATE_ENDED" }
  | { readonly type: "FEEDBACK_OPENED" }
  | { readonly type: "FEEDBACK_CLOSED" }
  | { readonly type: "EXPIRE" }
  | { readonly type: "CANCEL" }
  | { readonly type: "NO_SHOW_REPORTED" }
  | { readonly type: "SAFETY_HOLD_PLACED" }
  | { readonly type: "SAFETY_RESOLVED"; readonly resolution: SafetyResolution }
  | { readonly type: "REVIEW_RESOLVED"; readonly resolution: MoneyResolution }
  | { readonly type: "DISPUTE_OPENED" }
  | { readonly type: "DISPUTE_RESOLVED"; readonly resolution: MoneyResolution }
  | { readonly type: "REFUND_SETTLED" };

export type DateEventType = DateEvent["type"];

const isSystem = (actor: Actor, source: SystemSource): boolean =>
  actor.kind === "system" && actor.source === source;

const isStaff = (actor: Actor, role: "ops" | "safety"): boolean =>
  actor.kind === "staff" && actor.role === role;

const isVenueSide = (actor: Actor): boolean => actor.kind === "merchant" || isStaff(actor, "ops");

/**
 * Whether `actor` may send `event` at all, whatever the state.
 *
 * Money and booking facts come only from the systems that observe them
 * (payments from verified provider callbacks, the venue from the venue); a
 * person accepts only for themselves; holds and their outcomes are human
 * decisions. Agents never pass.
 */
export function mayDispatch(actor: Actor, event: DateEvent): boolean {
  switch (event.type) {
    case "VERIFIER_PASSED":
    case "VERIFIER_REJECTED":
      return isSystem(actor, "verifier");
    case "INVITES_SENT":
    case "PAYMENTS_OPENED":
    case "BOOKING_CONFIRMED":
      return isSystem(actor, "booking");
    case "PARTY_ACCEPTED":
      return actor.kind === "user" && actor.party === event.party;
    case "PARTY_PAID":
    case "REFUND_SETTLED":
      return isSystem(actor, "payments");
    case "VENUE_CONFIRMED":
    case "PARTY_CHECKED_IN":
    case "REVEAL":
      return isVenueSide(actor);
    case "VENUE_FAILED":
      return isVenueSide(actor) || isSystem(actor, "booking");
    case "DATE_ENDED":
    case "NO_SHOW_REPORTED":
      return isVenueSide(actor) || isSystem(actor, "scheduler");
    case "FEEDBACK_OPENED":
    case "FEEDBACK_CLOSED":
    case "EXPIRE":
      return isSystem(actor, "scheduler");
    case "CANCEL":
      return actor.kind === "user" || actor.kind === "staff" || isSystem(actor, "risk");
    case "SAFETY_HOLD_PLACED":
      return isStaff(actor, "safety") || isSystem(actor, "risk");
    case "SAFETY_RESOLVED":
      return isStaff(actor, "safety");
    case "REVIEW_RESOLVED":
    case "DISPUTE_RESOLVED":
      return isStaff(actor, "ops");
    case "DISPUTE_OPENED":
      return actor.kind === "user" || isStaff(actor, "ops") || isSystem(actor, "payments");
    default:
      return assertNever(event, "date event");
  }
}
