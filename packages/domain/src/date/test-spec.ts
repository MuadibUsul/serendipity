// The specification of the date machine, written independently of the
// implementation and shared by the tests; not exported from the package.
import type { DateState } from "./state.js";
import type { ActorName, EventKey, VariantName } from "./test-support.js";

/** What an event does: the next state, a no-op (a repeated fact), or a failed precondition. */
export type Outcome = DateState | "noop" | "guard";

const PAID_NOOP = { "PARTY_PAID:A": "noop", "PARTY_PAID:B": "noop" } as const;

/**
 * The specification, written independently of the implementation: for each
 * reachable record, every event that is valid there. Every event not listed
 * must be refused as ILLEGAL_TRANSITION.
 */
export const SPEC: Record<VariantName, Partial<Record<EventKey, Outcome>>> = {
  DRAFT: {
    VERIFIER_PASSED: "ELIGIBLE",
    VERIFIER_REJECTED: "CANCELLED_BEFORE_PAYMENT",
    CANCEL: "CANCELLED_BEFORE_PAYMENT",
  },
  ELIGIBLE: {
    INVITES_SENT: "INVITED",
    EXPIRE: "EXPIRED",
    CANCEL: "CANCELLED_BEFORE_PAYMENT",
  },
  INVITED: {
    "PARTY_ACCEPTED:A": "INVITED",
    "PARTY_ACCEPTED:B": "INVITED",
    EXPIRE: "EXPIRED",
    CANCEL: "CANCELLED_BEFORE_PAYMENT",
  },
  "INVITED (A accepted)": {
    "PARTY_ACCEPTED:A": "noop",
    "PARTY_ACCEPTED:B": "BOTH_ACCEPTED",
    EXPIRE: "EXPIRED",
    CANCEL: "CANCELLED_BEFORE_PAYMENT",
  },
  BOTH_ACCEPTED: {
    "PARTY_ACCEPTED:A": "noop",
    "PARTY_ACCEPTED:B": "noop",
    PAYMENTS_OPENED: "PAYMENT_PENDING",
    EXPIRE: "EXPIRED",
    CANCEL: "CANCELLED_BEFORE_PAYMENT",
  },
  PAYMENT_PENDING: {
    "PARTY_PAID:A": "PAYMENT_PENDING",
    "PARTY_PAID:B": "PAYMENT_PENDING",
    EXPIRE: "EXPIRED",
    CANCEL: "CANCELLED_BEFORE_PAYMENT",
    SAFETY_HOLD_PLACED: "SAFETY_HOLD",
    DISPUTE_OPENED: "guard",
  },
  "PAYMENT_PENDING (A paid)": {
    "PARTY_PAID:A": "noop",
    "PARTY_PAID:B": "BOTH_PAID",
    EXPIRE: "CANCELLED_REFUND_PENDING",
    CANCEL: "CANCELLED_REFUND_PENDING",
    SAFETY_HOLD_PLACED: "SAFETY_HOLD",
    DISPUTE_OPENED: "DISPUTED",
  },
  BOTH_PAID: {
    ...PAID_NOOP,
    VENUE_CONFIRMED: "VENUE_RESERVED",
    VENUE_FAILED: "VENUE_UNAVAILABLE",
    CANCEL: "CANCELLED_REFUND_PENDING",
    SAFETY_HOLD_PLACED: "SAFETY_HOLD",
    DISPUTE_OPENED: "DISPUTED",
  },
  VENUE_RESERVED: {
    ...PAID_NOOP,
    VENUE_CONFIRMED: "noop",
    VENUE_FAILED: "VENUE_UNAVAILABLE",
    BOOKING_CONFIRMED: "CONFIRMED",
    CANCEL: "CANCELLED_REFUND_PENDING",
    SAFETY_HOLD_PLACED: "SAFETY_HOLD",
    DISPUTE_OPENED: "DISPUTED",
  },
  CONFIRMED: {
    ...PAID_NOOP,
    VENUE_FAILED: "VENUE_UNAVAILABLE",
    "PARTY_CHECKED_IN:A": "CHECKIN_PARTIAL",
    "PARTY_CHECKED_IN:B": "CHECKIN_PARTIAL",
    CANCEL: "CANCELLED_REFUND_PENDING",
    NO_SHOW_REPORTED: "NO_SHOW_UNDER_REVIEW",
    SAFETY_HOLD_PLACED: "SAFETY_HOLD",
    DISPUTE_OPENED: "DISPUTED",
  },
  "CHECKIN_PARTIAL (A in)": {
    ...PAID_NOOP,
    "PARTY_CHECKED_IN:A": "noop",
    "PARTY_CHECKED_IN:B": "BOTH_CHECKED_IN",
    CANCEL: "CANCELLED_REFUND_PENDING",
    NO_SHOW_REPORTED: "NO_SHOW_UNDER_REVIEW",
    SAFETY_HOLD_PLACED: "SAFETY_HOLD",
    DISPUTE_OPENED: "DISPUTED",
  },
  BOTH_CHECKED_IN: {
    ...PAID_NOOP,
    "PARTY_CHECKED_IN:A": "noop",
    "PARTY_CHECKED_IN:B": "noop",
    REVEAL: "REVEALED",
    CANCEL: "CANCELLED_REFUND_PENDING",
    SAFETY_HOLD_PLACED: "SAFETY_HOLD",
    DISPUTE_OPENED: "DISPUTED",
  },
  REVEALED: {
    ...PAID_NOOP,
    DATE_ENDED: "COMPLETED",
    SAFETY_HOLD_PLACED: "SAFETY_HOLD",
    DISPUTE_OPENED: "DISPUTED",
  },
  COMPLETED: {
    ...PAID_NOOP,
    FEEDBACK_OPENED: "POST_DATE_FEEDBACK",
    SAFETY_HOLD_PLACED: "SAFETY_HOLD",
    DISPUTE_OPENED: "DISPUTED",
  },
  POST_DATE_FEEDBACK: {
    ...PAID_NOOP,
    FEEDBACK_CLOSED: "CLOSED",
    SAFETY_HOLD_PLACED: "SAFETY_HOLD",
    DISPUTE_OPENED: "DISPUTED",
  },
  CLOSED: {
    ...PAID_NOOP,
    DISPUTE_OPENED: "DISPUTED",
  },
  "CLOSED (refunded, B never paid)": {
    "PARTY_PAID:A": "noop",
    "PARTY_PAID:B": "CANCELLED_REFUND_PENDING",
    DISPUTE_OPENED: "DISPUTED",
  },
  "EXPIRED (before payment)": {},
  "EXPIRED (payment orders open)": {
    "PARTY_PAID:A": "CANCELLED_REFUND_PENDING",
    "PARTY_PAID:B": "CANCELLED_REFUND_PENDING",
  },
  "CANCELLED_BEFORE_PAYMENT (invited)": {},
  "CANCELLED_BEFORE_PAYMENT (payment orders open)": {
    "PARTY_PAID:A": "CANCELLED_REFUND_PENDING",
    "PARTY_PAID:B": "CANCELLED_REFUND_PENDING",
  },
  CANCELLED_REFUND_PENDING: {
    ...PAID_NOOP,
    SAFETY_HOLD_PLACED: "SAFETY_HOLD",
    DISPUTE_OPENED: "DISPUTED",
    REFUND_SETTLED: "CLOSED",
  },
  "CANCELLED_REFUND_PENDING (B never paid)": {
    "PARTY_PAID:A": "noop",
    "PARTY_PAID:B": "CANCELLED_REFUND_PENDING",
    SAFETY_HOLD_PLACED: "SAFETY_HOLD",
    DISPUTE_OPENED: "DISPUTED",
    REFUND_SETTLED: "CLOSED",
  },
  NO_SHOW_UNDER_REVIEW: {
    ...PAID_NOOP,
    SAFETY_HOLD_PLACED: "SAFETY_HOLD",
    DISPUTE_OPENED: "DISPUTED",
    "REVIEW_RESOLVED:refund": "CANCELLED_REFUND_PENDING",
    "REVIEW_RESOLVED:partial_refund": "PARTIAL_REFUND",
    "REVIEW_RESOLVED:no_refund": "CLOSED",
  },
  "SAFETY_HOLD (from CONFIRMED)": {
    ...PAID_NOOP,
    "SAFETY_RESOLVED:resume": "CONFIRMED",
    "SAFETY_RESOLVED:cancel": "CANCELLED_REFUND_PENDING",
    "SAFETY_RESOLVED:partial_refund": "PARTIAL_REFUND",
    "SAFETY_RESOLVED:close": "CLOSED",
  },
  "SAFETY_HOLD (from PAYMENT_PENDING, A paid)": {
    "PARTY_PAID:A": "noop",
    "PARTY_PAID:B": "SAFETY_HOLD",
    "SAFETY_RESOLVED:resume": "PAYMENT_PENDING",
    "SAFETY_RESOLVED:cancel": "CANCELLED_REFUND_PENDING",
    "SAFETY_RESOLVED:partial_refund": "PARTIAL_REFUND",
    "SAFETY_RESOLVED:close": "CLOSED",
  },
  "SAFETY_HOLD (from PAYMENT_PENDING, nobody paid)": {
    "PARTY_PAID:A": "SAFETY_HOLD",
    "PARTY_PAID:B": "SAFETY_HOLD",
    "SAFETY_RESOLVED:resume": "PAYMENT_PENDING",
    "SAFETY_RESOLVED:cancel": "CANCELLED_BEFORE_PAYMENT",
    "SAFETY_RESOLVED:partial_refund": "guard",
    "SAFETY_RESOLVED:close": "CLOSED",
  },
  VENUE_UNAVAILABLE: {
    ...PAID_NOOP,
    VENUE_CONFIRMED: "VENUE_RESERVED",
    CANCEL: "CANCELLED_REFUND_PENDING",
    SAFETY_HOLD_PLACED: "SAFETY_HOLD",
    DISPUTE_OPENED: "DISPUTED",
  },
  PARTIAL_REFUND: {
    ...PAID_NOOP,
    SAFETY_HOLD_PLACED: "SAFETY_HOLD",
    DISPUTE_OPENED: "DISPUTED",
    REFUND_SETTLED: "CLOSED",
  },
  DISPUTED: {
    ...PAID_NOOP,
    SAFETY_HOLD_PLACED: "SAFETY_HOLD",
    "DISPUTE_RESOLVED:refund": "CANCELLED_REFUND_PENDING",
    "DISPUTE_RESOLVED:partial_refund": "PARTIAL_REFUND",
    "DISPUTE_RESOLVED:no_refund": "CLOSED",
  },
};

/**
 * Who may send each event, also written independently of the implementation.
 * The agent appears nowhere.
 */
export const SENDERS: Record<EventKey, readonly ActorName[]> = {
  VERIFIER_PASSED: ["verifier"],
  VERIFIER_REJECTED: ["verifier"],
  INVITES_SENT: ["booking"],
  "PARTY_ACCEPTED:A": ["userA"],
  "PARTY_ACCEPTED:B": ["userB"],
  PAYMENTS_OPENED: ["booking"],
  "PARTY_PAID:A": ["payments"],
  "PARTY_PAID:B": ["payments"],
  VENUE_CONFIRMED: ["merchant", "ops"],
  VENUE_FAILED: ["merchant", "ops", "booking"],
  BOOKING_CONFIRMED: ["booking"],
  "PARTY_CHECKED_IN:A": ["merchant", "ops"],
  "PARTY_CHECKED_IN:B": ["merchant", "ops"],
  REVEAL: ["merchant", "ops"],
  DATE_ENDED: ["merchant", "ops", "scheduler"],
  FEEDBACK_OPENED: ["scheduler"],
  FEEDBACK_CLOSED: ["scheduler"],
  EXPIRE: ["scheduler"],
  CANCEL: ["userA", "userB", "ops", "safety", "risk"],
  NO_SHOW_REPORTED: ["merchant", "ops", "scheduler"],
  SAFETY_HOLD_PLACED: ["safety", "risk"],
  "SAFETY_RESOLVED:resume": ["safety"],
  "SAFETY_RESOLVED:cancel": ["safety"],
  "SAFETY_RESOLVED:partial_refund": ["safety"],
  "SAFETY_RESOLVED:close": ["safety"],
  "REVIEW_RESOLVED:refund": ["ops"],
  "REVIEW_RESOLVED:partial_refund": ["ops"],
  "REVIEW_RESOLVED:no_refund": ["ops"],
  DISPUTE_OPENED: ["userA", "userB", "ops", "payments"],
  "DISPUTE_RESOLVED:refund": ["ops"],
  "DISPUTE_RESOLVED:partial_refund": ["ops"],
  "DISPUTE_RESOLVED:no_refund": ["ops"],
  REFUND_SETTLED: ["payments"],
};
