import { assertNever } from "../assert-never.js";
import { mayDispatch } from "./events.js";
import type {
  Actor,
  DateEvent,
  DateEventType,
  MoneyResolution,
  SafetyResolution,
} from "./events.js";
import { DATE_MACHINE_VERSION, both, either, withParty } from "./state.js";
import type { DateRecord, DateState, Party } from "./state.js";

export type TransitionErrorCode =
  /** The record was written by another version of this machine. */
  | "MACHINE_VERSION_MISMATCH"
  /** This actor may never send this event. */
  | "FORBIDDEN_ACTOR"
  /** The event means nothing in this state. */
  | "ILLEGAL_TRANSITION"
  /** The event is valid here, but a precondition (payments, venue, check-in) is missing. */
  | "GUARD_FAILED";

export interface TransitionError {
  readonly code: TransitionErrorCode;
  readonly state: DateState;
  readonly event: DateEventType;
  readonly message: string;
}

export type TransitionResult =
  /** `changed: false` means the event repeated a fact already recorded; `date` is the input. */
  | { readonly ok: true; readonly date: DateRecord; readonly changed: boolean }
  | { readonly ok: false; readonly error: TransitionError };

/** Paid states before the reveal, where cancelling means refunding. */
const PAID_BEFORE_REVEAL = [
  "BOTH_PAID",
  "VENUE_RESERVED",
  "CONFIRMED",
  "VENUE_UNAVAILABLE",
  "CHECKIN_PARTIAL",
  "BOTH_CHECKED_IN",
] as const satisfies readonly DateState[];

/**
 * Where a safety hold can be placed. Before payment a safety concern simply
 * cancels the invitation (ARCH-001 §8.3).
 */
const HOLDABLE = [
  "PAYMENT_PENDING",
  ...PAID_BEFORE_REVEAL,
  "REVEALED",
  "COMPLETED",
  "POST_DATE_FEEDBACK",
  "NO_SHOW_UNDER_REVIEW",
  "CANCELLED_REFUND_PENDING",
  "PARTIAL_REFUND",
  "DISPUTED",
] as const satisfies readonly DateState[];

/** Where a payment dispute can be opened (when somebody has paid). */
const DISPUTABLE = [
  "PAYMENT_PENDING",
  ...PAID_BEFORE_REVEAL,
  "REVEALED",
  "COMPLETED",
  "POST_DATE_FEEDBACK",
  "CLOSED",
  "NO_SHOW_UNDER_REVIEW",
  "CANCELLED_REFUND_PENDING",
  "PARTIAL_REFUND",
] as const satisfies readonly DateState[];

type Patch = Partial<
  Pick<
    DateRecord,
    "accepted" | "paymentsOpened" | "paid" | "venueConfirmed" | "checkedIn" | "heldFrom"
  >
>;

type Step =
  | { readonly kind: "to"; readonly state: DateState; readonly patch: Patch }
  | { readonly kind: "noop" }
  | { readonly kind: "illegal" }
  | { readonly kind: "guard"; readonly reason: string };

const to = (state: DateState, patch: Patch = {}): Step => ({ kind: "to", state, patch });
const NOOP: Step = { kind: "noop" };
const ILLEGAL: Step = { kind: "illegal" };
const guard = (reason: string): Step => ({ kind: "guard", reason });

const isOneOf = (state: DateState, states: readonly DateState[]): boolean => states.includes(state);

/**
 * The next date record for `event` sent by `actor`.
 *
 * Pure and total: it never throws for a well-typed input, never mutates
 * `date`, and is the only way a date changes state. Payment, venue and
 * check-in facts are recorded per person, so a repeated fact (a duplicate
 * provider callback, a double tap at check-in) is a no-op rather than a
 * second payment or a skipped step.
 */
export function transition(date: DateRecord, event: DateEvent, actor: Actor): TransitionResult {
  if (date.machineVersion !== DATE_MACHINE_VERSION) {
    return fail(
      date,
      event,
      "MACHINE_VERSION_MISMATCH",
      `record is machine version ${String(date.machineVersion)}, this is version ${String(DATE_MACHINE_VERSION)}`,
    );
  }
  if (!mayDispatch(actor, event)) {
    return fail(date, event, "FORBIDDEN_ACTOR", `${actor.kind} may not send ${event.type}`);
  }
  const step = next(date, event);
  switch (step.kind) {
    case "noop":
      return { ok: true, date, changed: false };
    case "illegal":
      return fail(date, event, "ILLEGAL_TRANSITION", `${event.type} is not valid in ${date.state}`);
    case "guard":
      return fail(date, event, "GUARD_FAILED", step.reason);
    case "to":
      return {
        ok: true,
        changed: true,
        date: {
          ...date,
          ...step.patch,
          state: step.state,
          revision: date.revision + 1,
          heldFrom: step.state === "SAFETY_HOLD" ? (step.patch.heldFrom ?? date.heldFrom) : null,
        },
      };
    default:
      return assertNever(step, "step");
  }
}

function fail(
  date: DateRecord,
  event: DateEvent,
  code: TransitionErrorCode,
  message: string,
): TransitionResult {
  return { ok: false, error: { code, state: date.state, event: event.type, message } };
}

function next(date: DateRecord, event: DateEvent): Step {
  const state = date.state;
  switch (event.type) {
    case "VERIFIER_PASSED":
      return state === "DRAFT" ? to("ELIGIBLE") : ILLEGAL;
    case "VERIFIER_REJECTED":
      return state === "DRAFT" ? to("CANCELLED_BEFORE_PAYMENT") : ILLEGAL;
    case "INVITES_SENT":
      return state === "ELIGIBLE" ? to("INVITED") : ILLEGAL;
    case "PARTY_ACCEPTED":
      return accepted(date, event.party);
    case "PAYMENTS_OPENED":
      return state === "BOTH_ACCEPTED" ? to("PAYMENT_PENDING", { paymentsOpened: true }) : ILLEGAL;
    case "PARTY_PAID":
      return paid(date, event.party);
    case "VENUE_CONFIRMED":
      if (state === "VENUE_RESERVED") return NOOP;
      if (state !== "BOTH_PAID" && state !== "VENUE_UNAVAILABLE") return ILLEGAL;
      return both(date.paid)
        ? to("VENUE_RESERVED", { venueConfirmed: true })
        : guard("both people must have paid before the venue is booked");
    case "VENUE_FAILED":
      return isOneOf(state, ["BOTH_PAID", "VENUE_RESERVED", "CONFIRMED"])
        ? to("VENUE_UNAVAILABLE", { venueConfirmed: false })
        : ILLEGAL;
    case "BOOKING_CONFIRMED":
      if (state !== "VENUE_RESERVED") return ILLEGAL;
      if (!both(date.paid)) return guard("both people must have paid before the date is confirmed");
      if (!date.venueConfirmed)
        return guard("the venue must hold the slot before the date is confirmed");
      return to("CONFIRMED");
    case "PARTY_CHECKED_IN":
      return checkedIn(date, event.party);
    case "REVEAL":
      if (state !== "BOTH_CHECKED_IN") return ILLEGAL;
      return both(date.checkedIn) ? to("REVEALED") : guard("both people must have checked in");
    case "DATE_ENDED":
      return state === "REVEALED" ? to("COMPLETED") : ILLEGAL;
    case "FEEDBACK_OPENED":
      return state === "COMPLETED" ? to("POST_DATE_FEEDBACK") : ILLEGAL;
    case "FEEDBACK_CLOSED":
      return state === "POST_DATE_FEEDBACK" ? to("CLOSED") : ILLEGAL;
    case "EXPIRE":
      if (isOneOf(state, ["ELIGIBLE", "INVITED", "BOTH_ACCEPTED"])) return to("EXPIRED");
      if (state === "PAYMENT_PENDING") return to(refundIfPaid(date, "EXPIRED"));
      return ILLEGAL;
    case "CANCEL":
      if (isOneOf(state, ["DRAFT", "ELIGIBLE", "INVITED", "BOTH_ACCEPTED"])) {
        return to("CANCELLED_BEFORE_PAYMENT");
      }
      if (state === "PAYMENT_PENDING") return to(refundIfPaid(date, "CANCELLED_BEFORE_PAYMENT"));
      return isOneOf(state, PAID_BEFORE_REVEAL) ? to("CANCELLED_REFUND_PENDING") : ILLEGAL;
    case "NO_SHOW_REPORTED":
      return isOneOf(state, ["CONFIRMED", "CHECKIN_PARTIAL"])
        ? to("NO_SHOW_UNDER_REVIEW")
        : ILLEGAL;
    case "SAFETY_HOLD_PLACED":
      return isOneOf(state, HOLDABLE) ? to("SAFETY_HOLD", { heldFrom: state }) : ILLEGAL;
    case "SAFETY_RESOLVED":
      return state === "SAFETY_HOLD" ? resolveSafety(date, event.resolution) : ILLEGAL;
    case "REVIEW_RESOLVED":
      return state === "NO_SHOW_UNDER_REVIEW" ? to(afterMoneyDecision(event.resolution)) : ILLEGAL;
    case "DISPUTE_OPENED":
      if (!isOneOf(state, DISPUTABLE)) return ILLEGAL;
      return either(date.paid)
        ? to("DISPUTED")
        : guard("nobody has paid, there is nothing to dispute");
    case "DISPUTE_RESOLVED":
      return state === "DISPUTED" ? to(afterMoneyDecision(event.resolution)) : ILLEGAL;
    case "REFUND_SETTLED":
      return isOneOf(state, ["CANCELLED_REFUND_PENDING", "PARTIAL_REFUND"])
        ? to("CLOSED")
        : ILLEGAL;
    default:
      return assertNever(event, "date event");
  }
}

function accepted(date: DateRecord, party: Party): Step {
  if (date.state === "BOTH_ACCEPTED") return NOOP;
  if (date.state !== "INVITED") return ILLEGAL;
  if (date.accepted[party]) return NOOP;
  const flags = withParty(date.accepted, party);
  return to(both(flags) ? "BOTH_ACCEPTED" : "INVITED", { accepted: flags });
}

/**
 * A payment is a fact reported by the provider: it is never lost and never
 * counted twice. Money that arrives after the date stopped waiting for it (a
 * gateway timeout that still charged, a late callback) always ends in a refund.
 */
function paid(date: DateRecord, party: Party): Step {
  if (!date.paymentsOpened) return ILLEGAL;
  if (date.paid[party]) return NOOP;
  const flags = withParty(date.paid, party);
  switch (date.state) {
    case "PAYMENT_PENDING":
      return to(both(flags) ? "BOTH_PAID" : "PAYMENT_PENDING", { paid: flags });
    case "EXPIRED":
    case "CANCELLED_BEFORE_PAYMENT":
    case "CLOSED":
      return to("CANCELLED_REFUND_PENDING", { paid: flags });
    case "CANCELLED_REFUND_PENDING":
    case "PARTIAL_REFUND":
    case "DISPUTED":
    case "SAFETY_HOLD":
      // Recorded; the refund, dispute or safety process sees it.
      return to(date.state, { paid: flags });
    case "DRAFT":
    case "ELIGIBLE":
    case "INVITED":
    case "BOTH_ACCEPTED":
      // No payment order exists yet (paymentsOpened is false); unreachable here.
      return ILLEGAL;
    case "BOTH_PAID":
    case "VENUE_RESERVED":
    case "CONFIRMED":
    case "VENUE_UNAVAILABLE":
    case "CHECKIN_PARTIAL":
    case "BOTH_CHECKED_IN":
    case "REVEALED":
    case "COMPLETED":
    case "POST_DATE_FEEDBACK":
    case "NO_SHOW_UNDER_REVIEW":
      // Both people have already paid in every one of these states.
      return ILLEGAL;
    default:
      return assertNever(date.state, "date state");
  }
}

function checkedIn(date: DateRecord, party: Party): Step {
  if (date.state === "BOTH_CHECKED_IN") return NOOP;
  if (date.state !== "CONFIRMED" && date.state !== "CHECKIN_PARTIAL") return ILLEGAL;
  if (date.checkedIn[party]) return NOOP;
  const flags = withParty(date.checkedIn, party);
  return to(both(flags) ? "BOTH_CHECKED_IN" : "CHECKIN_PARTIAL", { checkedIn: flags });
}

function resolveSafety(date: DateRecord, resolution: SafetyResolution): Step {
  switch (resolution) {
    case "resume": {
      const from = date.heldFrom;
      if (from === null) return guard("the hold does not record where it was placed from");
      // The second payment may have arrived during the hold.
      return to(from === "PAYMENT_PENDING" && both(date.paid) ? "BOTH_PAID" : from);
    }
    case "cancel":
      return to(refundIfPaid(date, "CANCELLED_BEFORE_PAYMENT"));
    case "partial_refund":
      return either(date.paid)
        ? to("PARTIAL_REFUND")
        : guard("nobody has paid, there is nothing to refund");
    case "close":
      return to("CLOSED");
    default:
      return assertNever(resolution, "safety resolution");
  }
}

function refundIfPaid(date: DateRecord, otherwise: DateState): DateState {
  return either(date.paid) ? "CANCELLED_REFUND_PENDING" : otherwise;
}

function afterMoneyDecision(resolution: MoneyResolution): DateState {
  switch (resolution) {
    case "refund":
      return "CANCELLED_REFUND_PENDING";
    case "partial_refund":
      return "PARTIAL_REFUND";
    case "no_refund":
      return "CLOSED";
    default:
      return assertNever(resolution, "money resolution");
  }
}
