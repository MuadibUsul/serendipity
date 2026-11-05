/**
 * The date state machine of ARCH-001 §8.1 (约会状态), machine version 1.
 *
 * A date record is plain data: it can be stored as JSON, and only
 * `transition()` produces the next one. Bump `DATE_MACHINE_VERSION` whenever
 * the meaning of a state or of a context field changes, and migrate the
 * stored records; `transition()` refuses a record of another version.
 */
export const DATE_MACHINE_VERSION = 1;

/** The main path, in order (ARCH-001 §8.1). */
export const MAIN_PATH = [
  "DRAFT",
  "ELIGIBLE",
  "INVITED",
  "BOTH_ACCEPTED",
  "PAYMENT_PENDING",
  "BOTH_PAID",
  "VENUE_RESERVED",
  "CONFIRMED",
  "CHECKIN_PARTIAL",
  "BOTH_CHECKED_IN",
  "REVEALED",
  "COMPLETED",
  "POST_DATE_FEEDBACK",
  "CLOSED",
] as const;

/** The exception side chain (ARCH-001 §8.1 异常侧链). */
export const SIDE_STATES = [
  "EXPIRED",
  "CANCELLED_BEFORE_PAYMENT",
  "CANCELLED_REFUND_PENDING",
  "NO_SHOW_UNDER_REVIEW",
  "SAFETY_HOLD",
  "VENUE_UNAVAILABLE",
  "PARTIAL_REFUND",
  "DISPUTED",
] as const;

export const DATE_STATES = [...MAIN_PATH, ...SIDE_STATES] as const;

export type DateState = (typeof DATE_STATES)[number];

/** The two people of a date. Which person is A is fixed when the date is created. */
export type Party = "A" | "B";

export const PARTIES: readonly Party[] = ["A", "B"];

export interface PartyFlags {
  readonly A: boolean;
  readonly B: boolean;
}

export interface DateRecord {
  readonly machineVersion: number;
  readonly state: DateState;
  /** Increments on every change, so persistence can use it for optimistic locking. */
  readonly revision: number;
  readonly accepted: PartyFlags;
  /**
   * The payment orders exist. A payment reported before that is forged or a
   * bug, and is refused.
   */
  readonly paymentsOpened: boolean;
  readonly paid: PartyFlags;
  /** The venue holds the slot and seats for this date. */
  readonly venueConfirmed: boolean;
  readonly checkedIn: PartyFlags;
  /** The state a safety hold was placed from; `null` outside `SAFETY_HOLD`. */
  readonly heldFrom: DateState | null;
}

const NOBODY: PartyFlags = { A: false, B: false };

/** A new date, in `DRAFT`, before the verifier has looked at the pair. */
export function createDate(): DateRecord {
  return {
    machineVersion: DATE_MACHINE_VERSION,
    state: "DRAFT",
    revision: 0,
    accepted: NOBODY,
    paymentsOpened: false,
    paid: NOBODY,
    venueConfirmed: false,
    checkedIn: NOBODY,
    heldFrom: null,
  };
}

export function both(flags: PartyFlags): boolean {
  return flags.A && flags.B;
}

export function either(flags: PartyFlags): boolean {
  return flags.A || flags.B;
}

export function withParty(flags: PartyFlags, party: Party): PartyFlags {
  return party === "A" ? { A: true, B: flags.B } : { A: flags.A, B: true };
}
