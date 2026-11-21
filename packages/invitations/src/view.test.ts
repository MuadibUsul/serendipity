import { DATE_STATES } from "@serendipity/domain";
import type { DateRecord, Party } from "@serendipity/domain";
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { INVITE_STATUSES } from "./record.js";
import { DEADLINE, NOW, invitedDate, record } from "./test-support.js";
import { VENUE_KEYS, VIEW_KEYS, invitationView, viewStatus } from "./view.js";

const LATER = new Date(DEADLINE.getTime() + 1);
const other = (party: Party): Party => (party === "A" ? "B" : "A");

describe("viewStatus", () => {
  it.each([
    ["pending", [], "awaiting_you"],
    ["accepted", ["A"], "accepted"],
    ["declined", [], "declined"],
    ["expired", [], "closed"],
    ["withdrawn", [], "closed"],
  ] as const)("a %s invitation reads %s", (status, accepted, expected) => {
    expect(viewStatus(record({ status, date: invitedDate(accepted) }), NOW)).toBe(expected);
  });

  it("is confirmed once both accepted", () => {
    expect(viewStatus(record({ status: "accepted", date: invitedDate(["A", "B"]) }), NOW)).toBe(
      "confirmed",
    );
  });

  it("closes at the deadline even before the expiry job runs", () => {
    expect(viewStatus(record(), DEADLINE)).toBe("closed");
    expect(viewStatus(record({ status: "accepted", date: invitedDate(["A"]) }), LATER)).toBe(
      "closed",
    );
  });
});

describe("invitationView", () => {
  it("shows when and where, and until when to answer", () => {
    expect(invitationView(record(), NOW)).toEqual({
      date_id: "11111111-1111-4111-8111-111111111111",
      status: "awaiting_you",
      answer_by: "2026-11-19T04:00:00.000Z",
      starts_at: "2026-11-21T07:00:00.000Z",
      ends_at: "2026-11-21T08:30:00.000Z",
      venue: {
        name: "Example Cafe (fictional)",
        address: "1 Example St (fictional), San Francisco",
      },
      checkin_opens_at: null,
    });
  });

  it("says when check-in opens, once the date is confirmed", () => {
    const confirmed = record({
      status: "accepted",
      date: { ...record().date, state: "CONFIRMED" },
    });
    expect(invitationView(confirmed, NOW).checkin_opens_at).toBe("2026-11-21T06:30:00.000Z");
  });

  it("drops the deadline once no answer is possible", () => {
    expect(invitationView(record({ status: "declined" }), NOW).answer_by).toBeNull();
    expect(invitationView(record(), LATER).answer_by).toBeNull();
  });

  it("copies only allowlisted fields, even from a record carrying extra ones", () => {
    const leaky = {
      ...record(),
      otherUserId: "22222222-2222-4222-8222-222222222222",
      otherPhoto: "media/b/photo.jpg",
      venue: {
        name: "Example Cafe (fictional)",
        address: "1 Example St",
        managerPhone: "4155550199",
      },
    };
    const view = invitationView(leaky, NOW);
    expect(Object.keys(view).sort()).toEqual([...VIEW_KEYS].sort());
    expect(Object.keys(view.venue ?? {}).sort()).toEqual([...VENUE_KEYS].sort());
    const text = JSON.stringify(view);
    for (const secret of ["22222222", "media/b", "4155550199"]) expect(text).not.toContain(secret);
  });
});

const partyArb = fc.constantFrom<Party>("A", "B");
const statusArb = fc.constantFrom(...INVITE_STATUSES);
const timeArb = fc.constantFrom(NOW, DEADLINE, LATER);

describe("invitationView, for any record", () => {
  it("never shows whether the other person has answered", () => {
    fc.assert(
      fc.property(partyArb, statusArb, timeArb, fc.boolean(), (party, status, now, mine) => {
        const own: Party[] = mine ? [party] : [];
        const without = invitedDate(own);
        const withOther = invitedDate([...own, other(party)]);
        // Only while the date is still invited: both accepted is meant to show.
        if (withOther.state !== "INVITED") return;
        expect(invitationView(record({ party, status, date: withOther }), now)).toEqual(
          invitationView(record({ party, status, date: without }), now),
        );
      }),
    );
  });

  it("only ever has the allowlisted keys", () => {
    fc.assert(
      fc.property(
        partyArb,
        statusArb,
        timeArb,
        fc.constantFrom(...DATE_STATES),
        (party, status, now, state) => {
          const date: DateRecord = { ...invitedDate(), state };
          const view = invitationView(record({ party, status, date }), now);
          expect(Object.keys(view).sort()).toEqual([...VIEW_KEYS].sort());
        },
      ),
    );
  });
});

describe("a decline looks like an expiry to the other person", () => {
  it.each([
    ["had not answered", "withdrawn", "expired", []],
    ["had accepted", "accepted", "accepted", ["A"]],
  ] as const)("when the other person %s", (_, afterDecline, afterExpiry, accepted) => {
    // B declines: CANCEL by B. Or nobody answers in time: EXPIRE.
    const declined = invitedDate(accepted);
    const cancelled: DateRecord = { ...declined, state: "CANCELLED_BEFORE_PAYMENT" };
    const expired: DateRecord = { ...declined, state: "EXPIRED" };
    expect(invitationView(record({ status: afterDecline, date: cancelled }), NOW)).toEqual(
      invitationView(record({ status: afterExpiry, date: expired }), NOW),
    );
    expect(invitationView(record({ status: afterDecline, date: cancelled }), NOW).status).toBe(
      "closed",
    );
  });
});
