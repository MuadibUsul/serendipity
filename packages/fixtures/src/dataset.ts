import { createDate, transition } from "@serendipity/domain";
import type { Actor, DateEvent, DateRecord, DateState, Party } from "@serendipity/domain";

import { createRng } from "./rng.js";
import type { Rng } from "./rng.js";

/**
 * Markers that make fixture data recognisable anywhere it ends up. No row
 * holds anything about a real person, venue or payment.
 */
export const FIXTURE = {
  region: "FIXTURE_REGION",
  provider: "fixture-pay",
  venuePrefix: "Fixture Venue",
  addressSuffix: "Fixture Lane, Testville (fictional)",
  bookingPrefix: "FX-",
  idempotencyPrefix: "fx-",
  providerOrderPrefix: "fx_ord_",
  eventPrefix: "fx_evt_",
  policySnapshot: "fixture-policy",
  /** Venues sit within this box around 0°, 0° (open sea), never at a real address. */
  maxDegrees: 0.05,
} as const;

const BASE_TIME = Date.UTC(2026, 11, 1, 11, 0, 0); // 2026-12-01T11:00Z
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const PRICE_MINOR = 8800;

export type UserStatus = "pending" | "active" | "paused" | "suspended" | "deleted";

export interface UserRow {
  readonly id: string;
  readonly status: UserStatus;
  readonly createdAt: string;
  readonly deletedAt: string | null;
}

export interface VenueRow {
  readonly id: string;
  readonly name: string;
  readonly region: string;
  readonly address: string;
  readonly longitude: number;
  readonly latitude: number;
  readonly status: "active";
}

export interface VenueSlotRow {
  readonly id: string;
  readonly venueId: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly capacity: number;
  readonly reserved: number;
  readonly status: "open";
}

export interface DateRow {
  readonly id: string;
  readonly userA: string;
  readonly userB: string;
  readonly venueId: string;
  readonly venueSlotId: string;
  readonly status: DateState;
  readonly machineVersion: number;
  readonly revision: number;
  readonly machineContext: Omit<DateRecord, "machineVersion" | "state" | "revision">;
  readonly startAt: string;
  readonly endAt: string;
  readonly bookingRef: string | null;
  readonly policySnapshotHash: string;
}

export interface DateInviteRow {
  readonly id: string;
  readonly dateId: string;
  readonly userId: string;
  readonly status: "pending" | "accepted" | "withdrawn";
  readonly respondedAt: string | null;
  readonly expiresAt: string;
}

export interface CheckinRow {
  readonly id: string;
  readonly dateId: string;
  readonly userId: string;
  readonly method: "qr";
  readonly verifiedAt: string;
  readonly venueAttested: boolean;
}

export type PaymentOrderState = "PAYMENT_CREATED" | "PAID" | "EXPIRED" | "REFUND_REQUESTED";

export interface PaymentOrderRow {
  readonly id: string;
  readonly dateId: string;
  readonly userId: string;
  readonly amountMinor: number;
  readonly currency: "CNY";
  readonly state: PaymentOrderState;
  readonly provider: string;
  readonly providerOrderId: string;
  readonly idempotencyKey: string;
  readonly paidAt: string | null;
}

export interface WebhookEventRow {
  readonly id: string;
  readonly provider: string;
  readonly eventId: string;
  readonly eventType: "payment.succeeded";
  readonly signatureValid: boolean;
  readonly payloadRedacted: { readonly providerOrderId: string; readonly amountMinor: number };
  readonly receivedAt: string;
  readonly processedAt: string | null;
}

export interface RefundRow {
  readonly id: string;
  readonly paymentOrderId: string;
  readonly amountMinor: number;
  readonly state: "REQUESTED";
  readonly reason: string;
  readonly requestedBy: "system";
  readonly idempotencyKey: string;
}

/** The G3 money-flow scenarios of PLAN-001 EPIC-04, plus the happy path. */
export const SCENARIO_NAMES = [
  "happy_path",
  "only_one_paid",
  "duplicate_webhook",
  "both_paid_venue_failed",
  "venue_cancelled_after_confirmation",
  "user_paused",
  "one_late",
  "gateway_timeout_but_charged",
] as const;
export type ScenarioName = (typeof SCENARIO_NAMES)[number];

export interface ScenarioSummary {
  readonly name: ScenarioName;
  readonly description: string;
  readonly dateId: string;
  readonly userA: string;
  readonly userB: string;
}

export interface Dataset {
  readonly seed: number;
  readonly users: readonly UserRow[];
  readonly venues: readonly VenueRow[];
  readonly venueSlots: readonly VenueSlotRow[];
  readonly dates: readonly DateRow[];
  readonly dateInvites: readonly DateInviteRow[];
  readonly checkins: readonly CheckinRow[];
  readonly paymentOrders: readonly PaymentOrderRow[];
  readonly webhookEvents: readonly WebhookEventRow[];
  readonly refunds: readonly RefundRow[];
  /**
   * Deliveries the database must refuse (a provider callback replayed with
   * the same event id). Not part of the seed; tests send them.
   */
  readonly replays: readonly WebhookEventRow[];
  readonly scenarios: readonly ScenarioSummary[];
}

export interface DatasetOptions {
  /** Users with no date, in a spread of statuses. */
  readonly extraUsers?: number;
  readonly venues?: number;
}

const actor = {
  verifier: { kind: "system", source: "verifier" },
  booking: { kind: "system", source: "booking" },
  payments: { kind: "system", source: "payments" },
  scheduler: { kind: "system", source: "scheduler" },
  risk: { kind: "system", source: "risk" },
  merchant: { kind: "merchant" },
  ops: { kind: "staff", role: "ops" },
  a: { kind: "user", party: "A" },
  b: { kind: "user", party: "B" },
} as const satisfies Record<string, Actor>;

type Step = readonly [DateEvent, Actor];

const TO_PAYMENT_PENDING: readonly Step[] = [
  [{ type: "VERIFIER_PASSED" }, actor.verifier],
  [{ type: "INVITES_SENT" }, actor.booking],
  [{ type: "PARTY_ACCEPTED", party: "A" }, actor.a],
  [{ type: "PARTY_ACCEPTED", party: "B" }, actor.b],
  [{ type: "PAYMENTS_OPENED" }, actor.booking],
];
const paid = (party: Party): Step => [{ type: "PARTY_PAID", party }, actor.payments];
const checkedIn = (party: Party): Step => [{ type: "PARTY_CHECKED_IN", party }, actor.merchant];
const TO_BOTH_PAID: readonly Step[] = [...TO_PAYMENT_PENDING, paid("A"), paid("B")];
const TO_CONFIRMED: readonly Step[] = [
  ...TO_BOTH_PAID,
  [{ type: "VENUE_CONFIRMED" }, actor.merchant],
  [{ type: "BOOKING_CONFIRMED" }, actor.booking],
];

interface ScenarioSpec {
  readonly description: string;
  readonly steps: readonly Step[];
  readonly expected: DateState;
  /** This person's account is paused. */
  readonly paused?: Party;
  /** This person's payment callback is delivered twice. */
  readonly duplicateCallback?: Party;
  /** This person's payment arrives after the date expired. */
  readonly latePayment?: Party;
}

const SCENARIOS: Record<ScenarioName, ScenarioSpec> = {
  happy_path: {
    description: "Both accept, pay, are booked, check in, meet and close the feedback window.",
    steps: [
      ...TO_CONFIRMED,
      checkedIn("A"),
      checkedIn("B"),
      [{ type: "REVEAL" }, actor.merchant],
      [{ type: "DATE_ENDED" }, actor.merchant],
      [{ type: "FEEDBACK_OPENED" }, actor.scheduler],
      [{ type: "FEEDBACK_CLOSED" }, actor.scheduler],
    ],
    expected: "CLOSED",
  },
  only_one_paid: {
    description: "A pays, B never does; the payment window expires and A's payment is refunded.",
    steps: [...TO_PAYMENT_PENDING, paid("A"), [{ type: "EXPIRE" }, actor.scheduler]],
    expected: "CANCELLED_REFUND_PENDING",
  },
  duplicate_webhook: {
    description: "The provider delivers A's payment callback twice; it counts once.",
    steps: [...TO_PAYMENT_PENDING, paid("A"), paid("A"), paid("B")],
    expected: "BOTH_PAID",
    duplicateCallback: "A",
  },
  both_paid_venue_failed: {
    description:
      "Both paid, then the venue could not hold the slot; awaiting a rebooking or refund.",
    steps: [...TO_BOTH_PAID, [{ type: "VENUE_FAILED" }, actor.merchant]],
    expected: "VENUE_UNAVAILABLE",
  },
  venue_cancelled_after_confirmation: {
    description: "The venue cancels a confirmed date; ops cancels it and both are refunded.",
    steps: [
      ...TO_CONFIRMED,
      [{ type: "VENUE_FAILED" }, actor.merchant],
      [{ type: "CANCEL" }, actor.ops],
    ],
    expected: "CANCELLED_REFUND_PENDING",
  },
  user_paused: {
    description:
      "B pauses their account while invited; the invitation is withdrawn before payment.",
    steps: [
      [{ type: "VERIFIER_PASSED" }, actor.verifier],
      [{ type: "INVITES_SENT" }, actor.booking],
      [{ type: "PARTY_ACCEPTED", party: "A" }, actor.a],
      [{ type: "CANCEL" }, actor.risk],
    ],
    expected: "CANCELLED_BEFORE_PAYMENT",
    paused: "B",
  },
  one_late: {
    description: "A checks in, B never arrives; the no-show goes to review.",
    steps: [...TO_CONFIRMED, checkedIn("A"), [{ type: "NO_SHOW_REPORTED" }, actor.scheduler]],
    expected: "NO_SHOW_UNDER_REVIEW",
  },
  gateway_timeout_but_charged: {
    description:
      "The payment window expires, then the gateway reports A's charge after all; it is refunded.",
    steps: [...TO_PAYMENT_PENDING, [{ type: "EXPIRE" }, actor.scheduler], paid("A")],
    expected: "CANCELLED_REFUND_PENDING",
    latePayment: "A",
  },
};

const iso = (ms: number): string => new Date(ms).toISOString();

function runMachine(name: ScenarioName, steps: readonly Step[]): DateRecord {
  let date = createDate();
  for (const [event, sender] of steps) {
    const result = transition(date, event, sender);
    if (!result.ok) throw new Error(`fixture ${name}: ${result.error.message}`);
    date = result.date;
  }
  return date;
}

function venues(rng: Rng, count: number): VenueRow[] {
  return Array.from({ length: count }, (_, index) => ({
    id: rng.uuid(),
    name: `${FIXTURE.venuePrefix} ${String(index + 1)}`,
    region: FIXTURE.region,
    address: `${String(index + 1)} ${FIXTURE.addressSuffix}`,
    longitude: Math.round((rng.next() * 2 - 1) * FIXTURE.maxDegrees * 1e6) / 1e6,
    latitude: Math.round((rng.next() * 2 - 1) * FIXTURE.maxDegrees * 1e6) / 1e6,
    status: "active",
  }));
}

const EXTRA_STATUSES: readonly UserStatus[] = [
  "active",
  "active",
  "active",
  "active",
  "active",
  "active",
  "pending",
  "pending",
  "paused",
  "suspended",
  "deleted",
];

function user(rng: Rng, status: UserStatus, createdAt: number): UserRow {
  return {
    id: rng.uuid(),
    status,
    createdAt: iso(createdAt),
    deletedAt: status === "deleted" ? iso(createdAt + DAY) : null,
  };
}

/**
 * A complete, consistent dataset for `seed`: the same seed always gives the
 * same rows, byte for byte. Every scenario's date is driven through the
 * @serendipity/domain machine, so its state and per-person facts are always
 * reachable ones, and the payment orders, callbacks, refunds, invitations and
 * check-ins are derived from those facts.
 */
export function buildDataset(seed: number, options: DatasetOptions = {}): Dataset {
  const rng = createRng(seed);
  const venueRows = venues(rng, options.venues ?? 3);
  const users: UserRow[] = [];
  const venueSlots: VenueSlotRow[] = [];
  const dates: DateRow[] = [];
  const dateInvites: DateInviteRow[] = [];
  const checkins: CheckinRow[] = [];
  const paymentOrders: PaymentOrderRow[] = [];
  const webhookEvents: WebhookEventRow[] = [];
  const refunds: RefundRow[] = [];
  const replays: WebhookEventRow[] = [];
  const scenarios: ScenarioSummary[] = [];

  SCENARIO_NAMES.forEach((name, index) => {
    const spec = SCENARIOS[name];
    const record = runMachine(name, spec.steps);
    if (record.state !== spec.expected) {
      throw new Error(`fixture ${name}: ended in ${record.state}, expected ${spec.expected}`);
    }

    const created = BASE_TIME - 14 * DAY + index * HOUR;
    const people = {
      A: user(rng, spec.paused === "A" ? "paused" : "active", created),
      B: user(rng, spec.paused === "B" ? "paused" : "active", created),
    };
    users.push(people.A, people.B);

    const venue = rng.pick(venueRows);
    const startAt = BASE_TIME + index * DAY;
    const slot: VenueSlotRow = {
      id: rng.uuid(),
      venueId: venue.id,
      startsAt: iso(startAt),
      endsAt: iso(startAt + 2 * HOUR),
      capacity: 4,
      reserved: record.venueConfirmed ? 1 : 0,
      status: "open",
    };
    venueSlots.push(slot);

    const dateId = rng.uuid();
    const { machineVersion, state, revision, ...machineContext } = record;
    dates.push({
      id: dateId,
      userA: people.A.id,
      userB: people.B.id,
      venueId: venue.id,
      venueSlotId: slot.id,
      status: state,
      machineVersion,
      revision,
      machineContext,
      startAt: slot.startsAt,
      endAt: slot.endsAt,
      bookingRef: record.paymentsOpened ? `${FIXTURE.bookingPrefix}${String(1000 + index)}` : null,
      policySnapshotHash: FIXTURE.policySnapshot,
    });
    scenarios.push({
      name,
      description: spec.description,
      dateId,
      userA: people.A.id,
      userB: people.B.id,
    });

    const invitedAt = startAt - 7 * DAY;
    const deadline = startAt - 3 * DAY;
    for (const party of ["A", "B"] as const) {
      const personId = people[party].id;
      const accepted = record.accepted[party];
      dateInvites.push({
        id: rng.uuid(),
        dateId,
        userId: personId,
        status: accepted ? "accepted" : state === "INVITED" ? "pending" : "withdrawn",
        respondedAt: accepted ? iso(invitedAt + HOUR) : null,
        expiresAt: iso(deadline),
      });

      if (record.checkedIn[party]) {
        checkins.push({
          id: rng.uuid(),
          dateId,
          userId: personId,
          method: "qr",
          verifiedAt: iso(startAt - 5 * 60_000),
          venueAttested: true,
        });
      }

      if (!record.paymentsOpened) continue;
      const hasPaid = record.paid[party];
      const late = spec.latePayment === party;
      const refundPending = state === "CANCELLED_REFUND_PENDING";
      const paidAt = late ? deadline + HOUR : invitedAt + 2 * HOUR;
      const order: PaymentOrderRow = {
        id: rng.uuid(),
        dateId,
        userId: personId,
        amountMinor: PRICE_MINOR,
        currency: "CNY",
        state: hasPaid
          ? refundPending
            ? "REFUND_REQUESTED"
            : "PAID"
          : ["EXPIRED", "CANCELLED_BEFORE_PAYMENT", "CANCELLED_REFUND_PENDING"].includes(state)
            ? "EXPIRED"
            : "PAYMENT_CREATED",
        provider: FIXTURE.provider,
        providerOrderId: `${FIXTURE.providerOrderPrefix}${String(index)}_${party}`,
        idempotencyKey: `${FIXTURE.idempotencyPrefix}${dateId}-${party}-pay-1`,
        paidAt: hasPaid ? iso(paidAt) : null,
      };
      paymentOrders.push(order);

      if (!hasPaid) continue;
      const callback: WebhookEventRow = {
        id: rng.uuid(),
        provider: FIXTURE.provider,
        eventId: `${FIXTURE.eventPrefix}${String(index)}_${party}`,
        eventType: "payment.succeeded",
        signatureValid: true,
        payloadRedacted: { providerOrderId: order.providerOrderId, amountMinor: order.amountMinor },
        receivedAt: iso(paidAt),
        processedAt: iso(paidAt + 1000),
      };
      webhookEvents.push(callback);
      if (spec.duplicateCallback === party) {
        replays.push({
          ...callback,
          id: rng.uuid(),
          receivedAt: iso(paidAt + 30_000),
          processedAt: null,
        });
      }
      if (refundPending) {
        refunds.push({
          id: rng.uuid(),
          paymentOrderId: order.id,
          amountMinor: order.amountMinor,
          state: "REQUESTED",
          reason: `fixture: ${name}`,
          requestedBy: "system",
          idempotencyKey: `${FIXTURE.idempotencyPrefix}${order.id}-refund-1`,
        });
      }
    }
  });

  for (let index = 0; index < (options.extraUsers ?? 20); index += 1) {
    users.push(user(rng, rng.pick(EXTRA_STATUSES), BASE_TIME - 30 * DAY + index * HOUR));
  }

  return {
    seed,
    users,
    venues: venueRows,
    venueSlots,
    dates,
    dateInvites,
    checkins,
    paymentOrders,
    webhookEvents,
    refunds,
    replays,
    scenarios,
  };
}
