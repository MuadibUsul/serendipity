import { describe, expect, it } from "vitest";

import { mayDispatch } from "./events.js";
import { transition } from "./machine.js";
import { DATE_STATES, createDate } from "./state.js";
import type { DateRecord } from "./state.js";
import {
  ACTORS,
  ACTOR_NAMES,
  EVENT_CASES,
  EVENT_KEYS,
  VARIANTS,
  VARIANT_NAMES,
  run,
  senderOf,
  stateOfVariant,
  variant,
} from "./test-support.js";
import type { ActorName, EventKey } from "./test-support.js";
import { SENDERS, SPEC } from "./test-spec.js";

function send(date: DateRecord, key: EventKey, actor: ActorName | null = null) {
  const event = EVENT_CASES[key];
  return transition(date, event, actor === null ? senderOf(event) : ACTORS[actor]);
}

/** A deep-frozen copy, so any mutation of an input throws. */
function frozen(date: DateRecord): DateRecord {
  return Object.freeze({
    ...date,
    accepted: Object.freeze({ ...date.accepted }),
    paid: Object.freeze({ ...date.paid }),
    checkedIn: Object.freeze({ ...date.checkedIn }),
  });
}

describe("reachable records", () => {
  it.each(VARIANT_NAMES)("%s is reached through legal events", (name) => {
    expect(variant(name).state).toBe(stateOfVariant(name));
  });

  it("covers every state", () => {
    const covered = new Set(VARIANT_NAMES.map(stateOfVariant));
    expect(DATE_STATES.filter((state) => !covered.has(state))).toEqual([]);
  });
});

describe("every state × every event (ARCH-001 §8.1)", () => {
  const cases = VARIANT_NAMES.flatMap((name) => EVENT_KEYS.map((key) => [name, key] as const));

  it.each(cases)("%s + %s", (name, key) => {
    const before = frozen(variant(name));
    const result = send(before, key);
    const expected = SPEC[name][key];

    if (expected === undefined) {
      expect(result).toMatchObject({ ok: false, error: { code: "ILLEGAL_TRANSITION" } });
    } else if (expected === "guard") {
      expect(result).toMatchObject({ ok: false, error: { code: "GUARD_FAILED" } });
    } else if (expected === "noop") {
      expect(result).toEqual({ ok: true, date: before, changed: false });
      expect(result.ok && result.date).toBe(before);
    } else {
      expect(result).toMatchObject({ ok: true, changed: true, date: { state: expected } });
      expect(result.ok && result.date.revision).toBe(before.revision + 1);
    }
  });

  it("names only existing events and states in the specification", () => {
    for (const name of VARIANT_NAMES) {
      expect(VARIANTS[name]).toBeDefined();
      for (const key of Object.keys(SPEC[name])) expect(EVENT_KEYS).toContain(key);
    }
  });
});

describe("who may send what (ARCH-001 §10.3)", () => {
  const cases = EVENT_KEYS.flatMap((key) => ACTOR_NAMES.map((actor) => [key, actor] as const));

  it.each(cases)("%s from %s", (key, actor) => {
    expect(mayDispatch(ACTORS[actor], EVENT_CASES[key])).toBe(SENDERS[key].includes(actor));
  });

  it("refuses a forbidden actor before looking at the state, and changes nothing", () => {
    const date = frozen(variant("PAYMENT_PENDING"));
    const forged = send(date, "PARTY_PAID:A", "userA");
    expect(forged).toMatchObject({ ok: false, error: { code: "FORBIDDEN_ACTOR" } });
    expect(send(date, "PARTY_PAID:A", "payments")).toMatchObject({ ok: true, changed: true });
  });

  it("never lets an agent change a date", () => {
    for (const name of VARIANT_NAMES) {
      for (const key of EVENT_KEYS) {
        expect(send(variant(name), key, "agent")).toMatchObject({
          ok: false,
          error: { code: "FORBIDDEN_ACTOR" },
        });
      }
    }
  });

  it("lets a person accept only for themselves", () => {
    const date = variant("INVITED");
    expect(send(date, "PARTY_ACCEPTED:A", "userB")).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN_ACTOR" },
    });
  });
});

describe("guards (PLAN-001 §8.2, §8.3)", () => {
  // Records that no legal path produces: the guards hold even if a stored
  // record is inconsistent.
  const reserved = variant("VENUE_RESERVED");
  const checkedIn = variant("BOTH_CHECKED_IN");
  const bothPaid = variant("BOTH_PAID");

  it("refuses CONFIRMED when a payment is missing", () => {
    const date = { ...reserved, paid: { A: true, B: false } };
    expect(send(date, "BOOKING_CONFIRMED")).toMatchObject({
      ok: false,
      error: { code: "GUARD_FAILED" },
    });
  });

  it("refuses CONFIRMED when the venue does not hold the slot", () => {
    const date = { ...reserved, venueConfirmed: false };
    expect(send(date, "BOOKING_CONFIRMED")).toMatchObject({
      ok: false,
      error: { code: "GUARD_FAILED" },
    });
  });

  it("refuses to book the venue before both have paid", () => {
    const date = { ...bothPaid, paid: { A: false, B: true } };
    expect(send(date, "VENUE_CONFIRMED")).toMatchObject({
      ok: false,
      error: { code: "GUARD_FAILED" },
    });
  });

  it("refuses REVEALED unless both checked in", () => {
    const date = { ...checkedIn, checkedIn: { A: true, B: false } };
    expect(send(date, "REVEAL")).toMatchObject({ ok: false, error: { code: "GUARD_FAILED" } });
  });

  it("refuses a payment when no payment order exists", () => {
    expect(send(variant("BOTH_ACCEPTED"), "PARTY_PAID:A")).toMatchObject({
      ok: false,
      error: { code: "ILLEGAL_TRANSITION" },
    });
  });

  it("refuses to resume a hold that does not record its origin", () => {
    const date = { ...variant("SAFETY_HOLD (from CONFIRMED)"), heldFrom: null };
    expect(send(date, "SAFETY_RESOLVED:resume")).toMatchObject({
      ok: false,
      error: { code: "GUARD_FAILED" },
    });
  });
});

describe("G3 money-flow scenarios (PLAN-001 EPIC-04)", () => {
  it("both paid but the venue failed: never CONFIRMED; rebook or refund", () => {
    const failed = run(["VENUE_FAILED"], variant("BOTH_PAID"));
    expect(failed.state).toBe("VENUE_UNAVAILABLE");
    expect(send(failed, "BOOKING_CONFIRMED")).toMatchObject({ ok: false });
    expect(run(["VENUE_CONFIRMED", "BOOKING_CONFIRMED"], failed).state).toBe("CONFIRMED");
    expect(run(["CANCEL", "REFUND_SETTLED"], failed).state).toBe("CLOSED");
  });

  it("the venue cancels after confirmation: back to VENUE_UNAVAILABLE", () => {
    expect(run(["VENUE_FAILED"], variant("CONFIRMED"))).toMatchObject({
      state: "VENUE_UNAVAILABLE",
      venueConfirmed: false,
    });
  });

  it("only one paid before the deadline: the payer is refunded", () => {
    expect(run(["EXPIRE"], variant("PAYMENT_PENDING (A paid)"))).toMatchObject({
      state: "CANCELLED_REFUND_PENDING",
      paid: { A: true, B: false },
    });
  });

  it("a person cancels or is paused before paying: the invitation ends, nothing to refund", () => {
    expect(run(["CANCEL"], variant("INVITED (A accepted)")).state).toBe("CANCELLED_BEFORE_PAYMENT");
    expect(run(["CANCEL"], variant("PAYMENT_PENDING")).state).toBe("CANCELLED_BEFORE_PAYMENT");
  });

  it("a person cancels or is paused after both paid: refund pending", () => {
    expect(run(["CANCEL"], variant("CONFIRMED")).state).toBe("CANCELLED_REFUND_PENDING");
  });

  it("one person is late: the date waits in CHECKIN_PARTIAL, a no-show goes to review", () => {
    const late = variant("CHECKIN_PARTIAL (A in)");
    expect(run(["PARTY_CHECKED_IN:B"], late).state).toBe("BOTH_CHECKED_IN");
    expect(run(["NO_SHOW_REPORTED"], late).state).toBe("NO_SHOW_UNDER_REVIEW");
  });

  it("a duplicate payment callback changes nothing", () => {
    const paid = variant("PAYMENT_PENDING (A paid)");
    const again = send(paid, "PARTY_PAID:A");
    expect(again).toEqual({ ok: true, date: paid, changed: false });
  });

  it("the gateway timed out but the charge went through: the late payment is refunded", () => {
    const expired = variant("EXPIRED (payment orders open)");
    expect(run(["PARTY_PAID:B"], expired)).toMatchObject({
      state: "CANCELLED_REFUND_PENDING",
      paid: { A: false, B: true },
    });
  });

  it("a late payment after the refunds were settled reopens the refund", () => {
    expect(run(["PARTY_PAID:B"], variant("CLOSED (refunded, B never paid)")).state).toBe(
      "CANCELLED_REFUND_PENDING",
    );
  });
});

describe("safety hold", () => {
  it("records where it came from and resumes there", () => {
    const held = variant("SAFETY_HOLD (from CONFIRMED)");
    expect(held.heldFrom).toBe("CONFIRMED");
    expect(run(["SAFETY_RESOLVED:resume"], held)).toMatchObject({
      state: "CONFIRMED",
      heldFrom: null,
    });
  });

  it("keeps a payment that arrives during the hold and resumes to BOTH_PAID", () => {
    const held = run(["PARTY_PAID:B"], variant("SAFETY_HOLD (from PAYMENT_PENDING, A paid)"));
    expect(held).toMatchObject({ state: "SAFETY_HOLD", heldFrom: "PAYMENT_PENDING" });
    expect(run(["SAFETY_RESOLVED:resume"], held).state).toBe("BOTH_PAID");
  });

  it("cancelling a hold refunds only when somebody paid", () => {
    const unpaid = variant("SAFETY_HOLD (from PAYMENT_PENDING, nobody paid)");
    expect(run(["SAFETY_RESOLVED:cancel"], unpaid).state).toBe("CANCELLED_BEFORE_PAYMENT");
    expect(send(unpaid, "SAFETY_RESOLVED:partial_refund")).toMatchObject({
      ok: false,
      error: { code: "GUARD_FAILED" },
    });
  });
});

describe("records", () => {
  it("starts in DRAFT with nothing recorded", () => {
    expect(createDate()).toEqual({
      machineVersion: 1,
      state: "DRAFT",
      revision: 0,
      accepted: { A: false, B: false },
      paymentsOpened: false,
      paid: { A: false, B: false },
      venueConfirmed: false,
      checkedIn: { A: false, B: false },
      heldFrom: null,
    });
  });

  it("refuses a record of another machine version", () => {
    const old = { ...variant("CONFIRMED"), machineVersion: 0 };
    expect(send(old, "PARTY_CHECKED_IN:A")).toMatchObject({
      ok: false,
      error: { code: "MACHINE_VERSION_MISMATCH" },
    });
  });

  it("counts one revision per change along the whole happy path", () => {
    const closed = variant("CLOSED");
    expect(closed.revision).toBe(VARIANTS.CLOSED.length);
  });
});
