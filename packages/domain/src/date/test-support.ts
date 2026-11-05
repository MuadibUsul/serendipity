// Shared by the date machine tests; not exported from the package.
import { mayDispatch } from "./events.js";
import type { Actor, DateEvent } from "./events.js";
import { transition } from "./machine.js";
import { createDate } from "./state.js";
import type { DateRecord, DateState } from "./state.js";

export const ACTORS = {
  userA: { kind: "user", party: "A" },
  userB: { kind: "user", party: "B" },
  merchant: { kind: "merchant" },
  ops: { kind: "staff", role: "ops" },
  safety: { kind: "staff", role: "safety" },
  verifier: { kind: "system", source: "verifier" },
  booking: { kind: "system", source: "booking" },
  payments: { kind: "system", source: "payments" },
  scheduler: { kind: "system", source: "scheduler" },
  risk: { kind: "system", source: "risk" },
  agent: { kind: "agent" },
} as const satisfies Record<string, Actor>;

export type ActorName = keyof typeof ACTORS;

export const ACTOR_NAMES = Object.keys(ACTORS) as ActorName[];

/** Every event, with every value of its parameter, keyed `TYPE` or `TYPE:value`. */
export const EVENT_CASES = {
  VERIFIER_PASSED: { type: "VERIFIER_PASSED" },
  VERIFIER_REJECTED: { type: "VERIFIER_REJECTED" },
  INVITES_SENT: { type: "INVITES_SENT" },
  "PARTY_ACCEPTED:A": { type: "PARTY_ACCEPTED", party: "A" },
  "PARTY_ACCEPTED:B": { type: "PARTY_ACCEPTED", party: "B" },
  PAYMENTS_OPENED: { type: "PAYMENTS_OPENED" },
  "PARTY_PAID:A": { type: "PARTY_PAID", party: "A" },
  "PARTY_PAID:B": { type: "PARTY_PAID", party: "B" },
  VENUE_CONFIRMED: { type: "VENUE_CONFIRMED" },
  VENUE_FAILED: { type: "VENUE_FAILED" },
  BOOKING_CONFIRMED: { type: "BOOKING_CONFIRMED" },
  "PARTY_CHECKED_IN:A": { type: "PARTY_CHECKED_IN", party: "A" },
  "PARTY_CHECKED_IN:B": { type: "PARTY_CHECKED_IN", party: "B" },
  REVEAL: { type: "REVEAL" },
  DATE_ENDED: { type: "DATE_ENDED" },
  FEEDBACK_OPENED: { type: "FEEDBACK_OPENED" },
  FEEDBACK_CLOSED: { type: "FEEDBACK_CLOSED" },
  EXPIRE: { type: "EXPIRE" },
  CANCEL: { type: "CANCEL" },
  NO_SHOW_REPORTED: { type: "NO_SHOW_REPORTED" },
  SAFETY_HOLD_PLACED: { type: "SAFETY_HOLD_PLACED" },
  "SAFETY_RESOLVED:resume": { type: "SAFETY_RESOLVED", resolution: "resume" },
  "SAFETY_RESOLVED:cancel": { type: "SAFETY_RESOLVED", resolution: "cancel" },
  "SAFETY_RESOLVED:partial_refund": { type: "SAFETY_RESOLVED", resolution: "partial_refund" },
  "SAFETY_RESOLVED:close": { type: "SAFETY_RESOLVED", resolution: "close" },
  "REVIEW_RESOLVED:refund": { type: "REVIEW_RESOLVED", resolution: "refund" },
  "REVIEW_RESOLVED:partial_refund": { type: "REVIEW_RESOLVED", resolution: "partial_refund" },
  "REVIEW_RESOLVED:no_refund": { type: "REVIEW_RESOLVED", resolution: "no_refund" },
  DISPUTE_OPENED: { type: "DISPUTE_OPENED" },
  "DISPUTE_RESOLVED:refund": { type: "DISPUTE_RESOLVED", resolution: "refund" },
  "DISPUTE_RESOLVED:partial_refund": { type: "DISPUTE_RESOLVED", resolution: "partial_refund" },
  "DISPUTE_RESOLVED:no_refund": { type: "DISPUTE_RESOLVED", resolution: "no_refund" },
  REFUND_SETTLED: { type: "REFUND_SETTLED" },
} as const satisfies Record<string, DateEvent>;

export type EventKey = keyof typeof EVENT_CASES;

export const EVENT_KEYS = Object.keys(EVENT_CASES) as EventKey[];

/** The first actor (in `ACTORS` order) allowed to send `event`. */
export function senderOf(event: DateEvent): Actor {
  const name = ACTOR_NAMES.find((candidate) => mayDispatch(ACTORS[candidate], event));
  if (name === undefined) throw new Error(`no actor may send ${event.type}`);
  return ACTORS[name];
}

/** Applies `keys` from `start`, each sent by its first allowed actor; throws on any refusal. */
export function run(keys: readonly EventKey[], start: DateRecord = createDate()): DateRecord {
  let date = start;
  for (const key of keys) {
    const event = EVENT_CASES[key];
    const result = transition(date, event, senderOf(event));
    if (!result.ok) throw new Error(`${key} refused in ${date.state}: ${result.error.message}`);
    date = result.date;
  }
  return date;
}

const TO_INVITED: EventKey[] = ["VERIFIER_PASSED", "INVITES_SENT"];
const TO_BOTH_ACCEPTED: EventKey[] = [...TO_INVITED, "PARTY_ACCEPTED:A", "PARTY_ACCEPTED:B"];
const TO_PAYMENT_PENDING: EventKey[] = [...TO_BOTH_ACCEPTED, "PAYMENTS_OPENED"];
const TO_A_PAID: EventKey[] = [...TO_PAYMENT_PENDING, "PARTY_PAID:A"];
const TO_BOTH_PAID: EventKey[] = [...TO_A_PAID, "PARTY_PAID:B"];
const TO_CONFIRMED: EventKey[] = [...TO_BOTH_PAID, "VENUE_CONFIRMED", "BOOKING_CONFIRMED"];
const TO_REVEALED: EventKey[] = [
  ...TO_CONFIRMED,
  "PARTY_CHECKED_IN:A",
  "PARTY_CHECKED_IN:B",
  "REVEAL",
];
const TO_NO_SHOW: EventKey[] = [...TO_CONFIRMED, "NO_SHOW_REPORTED"];

/**
 * A reachable record for every state, and a second one wherever the context
 * changes what an event does (who has accepted or paid, whether payment
 * orders exist, where a hold came from).
 */
export const VARIANTS = {
  DRAFT: [],
  ELIGIBLE: ["VERIFIER_PASSED"],
  INVITED: TO_INVITED,
  "INVITED (A accepted)": [...TO_INVITED, "PARTY_ACCEPTED:A"],
  BOTH_ACCEPTED: TO_BOTH_ACCEPTED,
  PAYMENT_PENDING: TO_PAYMENT_PENDING,
  "PAYMENT_PENDING (A paid)": TO_A_PAID,
  BOTH_PAID: TO_BOTH_PAID,
  VENUE_RESERVED: [...TO_BOTH_PAID, "VENUE_CONFIRMED"],
  CONFIRMED: TO_CONFIRMED,
  "CHECKIN_PARTIAL (A in)": [...TO_CONFIRMED, "PARTY_CHECKED_IN:A"],
  BOTH_CHECKED_IN: [...TO_CONFIRMED, "PARTY_CHECKED_IN:A", "PARTY_CHECKED_IN:B"],
  REVEALED: TO_REVEALED,
  COMPLETED: [...TO_REVEALED, "DATE_ENDED"],
  POST_DATE_FEEDBACK: [...TO_REVEALED, "DATE_ENDED", "FEEDBACK_OPENED"],
  CLOSED: [...TO_REVEALED, "DATE_ENDED", "FEEDBACK_OPENED", "FEEDBACK_CLOSED"],
  "CLOSED (refunded, B never paid)": [...TO_A_PAID, "EXPIRE", "REFUND_SETTLED"],
  "EXPIRED (before payment)": [...TO_INVITED, "EXPIRE"],
  "EXPIRED (payment orders open)": [...TO_PAYMENT_PENDING, "EXPIRE"],
  "CANCELLED_BEFORE_PAYMENT (invited)": [...TO_INVITED, "CANCEL"],
  "CANCELLED_BEFORE_PAYMENT (payment orders open)": [...TO_PAYMENT_PENDING, "CANCEL"],
  CANCELLED_REFUND_PENDING: [...TO_BOTH_PAID, "CANCEL"],
  "CANCELLED_REFUND_PENDING (B never paid)": [...TO_A_PAID, "EXPIRE"],
  NO_SHOW_UNDER_REVIEW: TO_NO_SHOW,
  "SAFETY_HOLD (from CONFIRMED)": [...TO_CONFIRMED, "SAFETY_HOLD_PLACED"],
  "SAFETY_HOLD (from PAYMENT_PENDING, A paid)": [...TO_A_PAID, "SAFETY_HOLD_PLACED"],
  "SAFETY_HOLD (from PAYMENT_PENDING, nobody paid)": [...TO_PAYMENT_PENDING, "SAFETY_HOLD_PLACED"],
  VENUE_UNAVAILABLE: [...TO_BOTH_PAID, "VENUE_FAILED"],
  PARTIAL_REFUND: [...TO_NO_SHOW, "REVIEW_RESOLVED:partial_refund"],
  DISPUTED: [...TO_CONFIRMED, "DISPUTE_OPENED"],
} as const satisfies Record<string, readonly EventKey[]>;

export type VariantName = keyof typeof VARIANTS;

export const VARIANT_NAMES = Object.keys(VARIANTS) as VariantName[];

export function variant(name: VariantName): DateRecord {
  return run(VARIANTS[name]);
}

/** The state a variant is in: the first word of its name. */
export function stateOfVariant(name: VariantName): DateState {
  return name.split(" ")[0] as DateState;
}
