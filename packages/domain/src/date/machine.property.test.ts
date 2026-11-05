import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { mayDispatch } from "./events.js";
import { transition } from "./machine.js";
import { both, either } from "./state.js";
import type { DateRecord, DateState } from "./state.js";
import {
  ACTORS,
  ACTOR_NAMES,
  EVENT_CASES,
  EVENT_KEYS,
  VARIANT_NAMES,
  run,
  senderOf,
  stateOfVariant,
  variant,
} from "./test-support.js";
import type { EventKey } from "./test-support.js";
import { SPEC } from "./test-spec.js";

const CONFIRMED_ONWARD: readonly DateState[] = [
  "CONFIRMED",
  "CHECKIN_PARTIAL",
  "BOTH_CHECKED_IN",
  "REVEALED",
  "COMPLETED",
  "POST_DATE_FEEDBACK",
];
const MET: readonly DateState[] = ["REVEALED", "COMPLETED", "POST_DATE_FEEDBACK"];
const BOTH_PAID_STATES: readonly DateState[] = ["BOTH_PAID", "VENUE_RESERVED", "VENUE_UNAVAILABLE"];
/** Terminal states with no refund step: money must never end up here. */
const NO_REFUND_TERMINALS: readonly DateState[] = ["EXPIRED", "CANCELLED_BEFORE_PAYMENT"];

/** PLAN-001 §8.2–§8.3 as checks on a single record. */
function assertInvariants(date: DateRecord): void {
  if (CONFIRMED_ONWARD.includes(date.state)) {
    expect(both(date.paid), `${date.state} needs both payments`).toBe(true);
    expect(date.venueConfirmed, `${date.state} needs the venue`).toBe(true);
  }
  if (MET.includes(date.state)) {
    expect(both(date.checkedIn), `${date.state} needs both check-ins`).toBe(true);
  }
  if (BOTH_PAID_STATES.includes(date.state)) {
    expect(both(date.paid), `${date.state} needs both payments`).toBe(true);
  }
  if (NO_REFUND_TERMINALS.includes(date.state)) {
    expect(either(date.paid), `money stranded in ${date.state}`).toBe(false);
  }
  if (either(date.paid)) expect(date.paymentsOpened).toBe(true);
  expect(date.heldFrom !== null).toBe(date.state === "SAFETY_HOLD");
}

/** Every from → to edge the specification allows (a no-op stays in place). */
const SPECIFIED_EDGES = VARIANT_NAMES.flatMap((name) =>
  Object.values(SPEC[name])
    .filter((outcome) => outcome !== "guard")
    .map((outcome) => {
      const from = stateOfVariant(name);
      return `${from}->${outcome === "noop" ? from : outcome}`;
    }),
);

/**
 * Plus resuming a hold, which returns to wherever the hold was placed from
 * (or to BOTH_PAID when the second payment arrived during a hold placed in
 * PAYMENT_PENDING). The specification has hold samples for two origins only.
 */
const ALLOWED_EDGES = new Set([
  ...SPECIFIED_EDGES,
  ...SPECIFIED_EDGES.filter((edge) => edge.endsWith("->SAFETY_HOLD")).map(
    (edge) => `SAFETY_HOLD->${edge.slice(0, edge.indexOf("->"))}`,
  ),
  "SAFETY_HOLD->BOTH_PAID",
]);

/** A step: an event, sent mostly by an actor allowed to send it, sometimes by anyone. */
const step = fc.record({
  key: fc.constantFrom(...EVENT_KEYS),
  anyone: fc.boolean(),
  actor: fc.constantFrom(...ACTOR_NAMES),
});

describe("date machine properties", () => {
  it("keeps every invariant and only takes specified edges, from any reachable record", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...VARIANT_NAMES),
        fc.array(step, { maxLength: 40 }),
        (start, steps) => {
          let date = variant(start);
          assertInvariants(date);
          for (const { key, anyone, actor } of steps) {
            const event = EVENT_CASES[key];
            const sender = anyone ? ACTORS[actor] : senderOf(event);
            const result = transition(date, event, sender);
            if (!result.ok) {
              if (!mayDispatch(sender, event)) expect(result.error.code).toBe("FORBIDDEN_ACTOR");
              continue;
            }
            expect(sender.kind).not.toBe("agent");
            if (result.changed) {
              expect(result.date.revision).toBe(date.revision + 1);
              expect(ALLOWED_EDGES).toContain(`${date.state}->${result.date.state}`);
            } else {
              expect(result.date).toBe(date);
            }
            assertInvariants(result.date);
            date = result.date;
          }
        },
      ),
      { numRuns: 2000 },
    );
  });

  it("repeating a payment, acceptance or check-in is always a no-op", () => {
    const repeatable: EventKey[] = [
      "PARTY_ACCEPTED:A",
      "PARTY_ACCEPTED:B",
      "PARTY_PAID:A",
      "PARTY_PAID:B",
      "PARTY_CHECKED_IN:A",
      "PARTY_CHECKED_IN:B",
    ];
    let checked = 0;
    for (const start of VARIANT_NAMES) {
      for (const key of repeatable) {
        const event = EVENT_CASES[key];
        const first = transition(variant(start), event, senderOf(event));
        if (!first.ok || !first.changed) continue;
        const second = transition(first.date, event, senderOf(event));
        expect(second, `${start} + ${key} twice`).toEqual({
          ok: true,
          date: first.date,
          changed: false,
        });
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it("reaches CLOSED for any order of the two people's actions, with duplicates", () => {
    const pair = (a: EventKey, b: EventKey) =>
      fc
        .tuple(fc.boolean(), fc.nat({ max: 2 }), fc.nat({ max: 2 }))
        .map(([aFirst, extraA, extraB]) => [
          ...(aFirst ? [a, b] : [b, a]),
          ...Array<EventKey>(extraA).fill(a),
          ...Array<EventKey>(extraB).fill(b),
        ]);

    fc.assert(
      fc.property(
        pair("PARTY_ACCEPTED:A", "PARTY_ACCEPTED:B"),
        pair("PARTY_PAID:A", "PARTY_PAID:B"),
        pair("PARTY_CHECKED_IN:A", "PARTY_CHECKED_IN:B"),
        (accept, pay, checkIn) => {
          const closed = run([
            "VERIFIER_PASSED",
            "INVITES_SENT",
            ...accept,
            "PAYMENTS_OPENED",
            ...pay,
            "VENUE_CONFIRMED",
            "BOOKING_CONFIRMED",
            ...checkIn,
            "REVEAL",
            "DATE_ENDED",
            "FEEDBACK_OPENED",
            "FEEDBACK_CLOSED",
          ]);
          expect(closed).toMatchObject({ state: "CLOSED", revision: 15 });
          assertInvariants(closed);
        },
      ),
    );
  });
});
