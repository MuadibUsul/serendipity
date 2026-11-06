import { DATE_STATES, createDate, transition } from "@serendipity/domain";
import { describe, expect, it } from "vitest";

import { FIXTURE, SCENARIO_NAMES, buildDataset } from "./dataset.js";
import type { Dataset, ScenarioName } from "./dataset.js";
import { createRng } from "./rng.js";

const dataset = buildDataset(42);

function scenario(data: Dataset, name: ScenarioName) {
  const summary = data.scenarios.find((candidate) => candidate.name === name);
  if (summary === undefined) throw new Error(`no scenario ${name}`);
  const date = data.dates.find((row) => row.id === summary.dateId);
  if (date === undefined) throw new Error(`no date for ${name}`);
  const orders = data.paymentOrders.filter((row) => row.dateId === date.id);
  const orderOf = (userId: string) => orders.find((row) => row.userId === userId);
  return {
    summary,
    date,
    orders,
    orderOf,
    refunds: data.refunds.filter((row) => orders.some((order) => order.id === row.paymentOrderId)),
    callbacks: data.webhookEvents.filter((row) =>
      orders.some((order) => order.providerOrderId === row.payloadRedacted.providerOrderId),
    ),
    checkins: data.checkins.filter((row) => row.dateId === date.id),
    users: data.users.filter((row) => row.id === summary.userA || row.id === summary.userB),
  };
}

describe("seeded randomness", () => {
  it("repeats exactly for the same seed and differs for another", () => {
    const a = createRng(7);
    const b = createRng(7);
    const c = createRng(8);
    const draw = (rng: ReturnType<typeof createRng>) => Array.from({ length: 5 }, () => rng.uuid());
    expect(draw(a)).toEqual(draw(b));
    expect(draw(createRng(7))).not.toEqual(draw(c));
  });

  it("draws UUIDv4-shaped identifiers and integers inside their bounds", () => {
    const rng = createRng(1);
    for (let index = 0; index < 200; index += 1) {
      expect(rng.uuid()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      const value = rng.int(3, 5);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThanOrEqual(5);
    }
  });
});

describe("datasets", () => {
  it("are identical for the same seed, and different for another seed", () => {
    expect(buildDataset(42)).toEqual(dataset);
    expect(buildDataset(43).users[0]?.id).not.toBe(dataset.users[0]?.id);
  });

  it("use unique identifiers across every table", () => {
    const ids = [
      ...dataset.users,
      ...dataset.venues,
      ...dataset.venueSlots,
      ...dataset.dates,
      ...dataset.dateInvites,
      ...dataset.checkins,
      ...dataset.paymentOrders,
      ...dataset.webhookEvents,
      ...dataset.refunds,
      ...dataset.replays,
    ].map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("honour the requested sizes", () => {
    const small = buildDataset(1, { extraUsers: 0, venues: 1 });
    expect(small.users).toHaveLength(SCENARIO_NAMES.length * 2);
    expect(small.venues).toHaveLength(1);
  });
});

describe("everything is fictional", () => {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const isoTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

  it("marks every venue, payment and callback as fixture data", () => {
    for (const venue of dataset.venues) {
      expect(venue.name.startsWith(FIXTURE.venuePrefix)).toBe(true);
      expect(venue.address.endsWith(FIXTURE.addressSuffix)).toBe(true);
      expect(venue.region).toBe(FIXTURE.region);
      expect(Math.abs(venue.longitude)).toBeLessThanOrEqual(FIXTURE.maxDegrees);
      expect(Math.abs(venue.latitude)).toBeLessThanOrEqual(FIXTURE.maxDegrees);
    }
    for (const order of dataset.paymentOrders) {
      expect(order.provider).toBe(FIXTURE.provider);
      expect(order.providerOrderId.startsWith(FIXTURE.providerOrderPrefix)).toBe(true);
      expect(order.idempotencyKey.startsWith(FIXTURE.idempotencyPrefix)).toBe(true);
    }
    for (const event of [...dataset.webhookEvents, ...dataset.replays]) {
      expect(event.provider).toBe(FIXTURE.provider);
      expect(event.eventId.startsWith(FIXTURE.eventPrefix)).toBe(true);
    }
    for (const date of dataset.dates) {
      if (date.bookingRef !== null)
        expect(date.bookingRef.startsWith(FIXTURE.bookingPrefix)).toBe(true);
    }
  });

  it("holds no free text beyond the fixture markers: every string is an id, a time, an enum or a marked value", () => {
    const markers = [
      FIXTURE.venuePrefix,
      FIXTURE.addressSuffix,
      FIXTURE.region,
      FIXTURE.provider,
      FIXTURE.bookingPrefix,
      FIXTURE.idempotencyPrefix,
      FIXTURE.providerOrderPrefix,
      FIXTURE.eventPrefix,
      FIXTURE.policySnapshot,
      "fixture: ",
    ];
    const enums = new Set<string>([
      ...DATE_STATES,
      "pending",
      "active",
      "paused",
      "suspended",
      "deleted",
      "open",
      "accepted",
      "withdrawn",
      "qr",
      "CNY",
      "PAYMENT_CREATED",
      "PAID",
      "EXPIRED",
      "REFUND_REQUESTED",
      "REQUESTED",
      "system",
      "payment.succeeded",
    ]);
    const strings: string[] = [];
    const walk = (value: unknown): void => {
      if (typeof value === "string") strings.push(value);
      else if (Array.isArray(value)) value.forEach(walk);
      else if (value !== null && typeof value === "object") Object.values(value).forEach(walk);
    };
    walk({ ...dataset, scenarios: [] });
    const unexplained = strings.filter(
      (text) =>
        !uuid.test(text) &&
        !isoTime.test(text) &&
        !enums.has(text) &&
        !markers.some((marker) => text.includes(marker)),
    );
    expect(unexplained).toEqual([]);
  });
});

describe("G3 anomaly scenarios (PLAN-001 EPIC-04)", () => {
  it("includes every scenario the gate names", () => {
    expect(dataset.scenarios.map((summary) => summary.name)).toEqual([...SCENARIO_NAMES]);
    expect(SCENARIO_NAMES).toEqual(
      expect.arrayContaining([
        "only_one_paid",
        "duplicate_webhook",
        "both_paid_venue_failed",
        "venue_cancelled_after_confirmation",
        "user_paused",
        "one_late",
        "gateway_timeout_but_charged",
      ]),
    );
  });

  it("only_one_paid: one payment, refunded; the other order expired", () => {
    const s = scenario(dataset, "only_one_paid");
    expect(s.date.status).toBe("CANCELLED_REFUND_PENDING");
    expect(s.orderOf(s.summary.userA)?.state).toBe("REFUND_REQUESTED");
    expect(s.orderOf(s.summary.userB)?.state).toBe("EXPIRED");
    expect(s.refunds.map((refund) => refund.paymentOrderId)).toEqual([
      s.orderOf(s.summary.userA)?.id,
    ]);
  });

  it("duplicate_webhook: the callback is replayed with the same provider event id, and counted once", () => {
    const s = scenario(dataset, "duplicate_webhook");
    expect(s.date.status).toBe("BOTH_PAID");
    const [replay] = dataset.replays;
    expect(replay).toBeDefined();
    const original = s.callbacks.find((event) => event.eventId === replay?.eventId);
    expect(original?.provider).toBe(replay?.provider);
    expect(original?.id).not.toBe(replay?.id);
    expect(s.orders.filter((order) => order.state === "PAID")).toHaveLength(2);
  });

  it("both_paid_venue_failed: both paid, no venue, nothing refunded yet", () => {
    const s = scenario(dataset, "both_paid_venue_failed");
    expect(s.date.status).toBe("VENUE_UNAVAILABLE");
    expect(s.date.machineContext.venueConfirmed).toBe(false);
    expect(s.orders.map((order) => order.state)).toEqual(["PAID", "PAID"]);
    expect(s.refunds).toEqual([]);
  });

  it("venue_cancelled_after_confirmation: both refunded", () => {
    const s = scenario(dataset, "venue_cancelled_after_confirmation");
    expect(s.date.status).toBe("CANCELLED_REFUND_PENDING");
    expect(s.refunds).toHaveLength(2);
  });

  it("user_paused: B's account is paused and the invitation ended before any payment", () => {
    const s = scenario(dataset, "user_paused");
    expect(s.date.status).toBe("CANCELLED_BEFORE_PAYMENT");
    expect(s.users.find((row) => row.id === s.summary.userB)?.status).toBe("paused");
    expect(s.orders).toEqual([]);
  });

  it("one_late: only A checked in, and the no-show is under review", () => {
    const s = scenario(dataset, "one_late");
    expect(s.date.status).toBe("NO_SHOW_UNDER_REVIEW");
    expect(s.checkins.map((row) => row.userId)).toEqual([s.summary.userA]);
  });

  it("gateway_timeout_but_charged: the charge arrives after the deadline and is refunded", () => {
    const s = scenario(dataset, "gateway_timeout_but_charged");
    expect(s.date.status).toBe("CANCELLED_REFUND_PENDING");
    const late = s.orderOf(s.summary.userA);
    const invite = dataset.dateInvites.find((row) => row.dateId === s.date.id);
    expect(late?.state).toBe("REFUND_REQUESTED");
    expect(Date.parse(late?.paidAt ?? "")).toBeGreaterThan(Date.parse(invite?.expiresAt ?? ""));
    expect(s.orderOf(s.summary.userB)?.state).toBe("EXPIRED");
    expect(s.refunds).toHaveLength(1);
  });

  it("happy_path: closed after both checked in", () => {
    const s = scenario(dataset, "happy_path");
    expect(s.date.status).toBe("CLOSED");
    expect(s.checkins).toHaveLength(2);
    expect(s.callbacks).toHaveLength(2);
  });
});

describe("consistency with the date machine", () => {
  it("stores, for every date, a record the machine accepts as its own", () => {
    for (const date of dataset.dates) {
      const record = {
        machineVersion: date.machineVersion,
        state: date.status,
        revision: date.revision,
        ...date.machineContext,
      };
      expect(Object.keys(record).sort()).toEqual(Object.keys(createDate()).sort());
      // Repeating a payment the machine already recorded is a no-op, never an error.
      for (const party of ["A", "B"] as const) {
        if (!date.machineContext.paid[party]) continue;
        const result = transition(
          record,
          { type: "PARTY_PAID", party },
          { kind: "system", source: "payments" },
        );
        expect(result, `${date.status} ${party}`).toEqual({
          ok: true,
          date: record,
          changed: false,
        });
      }
    }
  });

  it("orders exactly the payments the machine recorded", () => {
    for (const date of dataset.dates) {
      const orders = dataset.paymentOrders.filter((order) => order.dateId === date.id);
      const paidUsers = orders
        .filter((order) => order.paidAt !== null)
        .map((order) => order.userId);
      const expected = [
        ...(date.machineContext.paid.A ? [date.userA] : []),
        ...(date.machineContext.paid.B ? [date.userB] : []),
      ];
      expect(paidUsers.sort()).toEqual(expected.sort());
      expect(orders.length).toBe(date.machineContext.paymentsOpened ? 2 : 0);
    }
  });
});
