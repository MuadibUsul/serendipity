import { describe, expect, it } from "vitest";

import { decideAnswer, expireInvitations, openInvitations } from "./rules.js";
import { invitationView } from "./view.js";
import { DEADLINE, NOW, invitedDate, record } from "./test-support.js";

const LATER = new Date(DEADLINE.getTime() + 1);

describe("decideAnswer: accept", () => {
  it("records the person's acceptance", () => {
    const decision = decideAnswer(record(), "accept", NOW);
    expect(decision).toMatchObject({ ok: true, changed: true, inviteStatus: "accepted" });
    expect(decision.ok && decision.date.accepted).toEqual({ A: true, B: false });
    expect(decision.ok && decision.date.state).toBe("INVITED");
  });

  it("confirms the date when the second person accepts", () => {
    const decision = decideAnswer(record({ party: "B", date: invitedDate(["A"]) }), "accept", NOW);
    expect(decision.ok && decision.date.state).toBe("BOTH_ACCEPTED");
  });

  it("treats a repeated accept as the same request", () => {
    const decision = decideAnswer(
      record({ status: "accepted", date: invitedDate(["A"]) }),
      "accept",
      NOW,
    );
    expect(decision).toMatchObject({ ok: true, changed: false });
    const afterBoth = decideAnswer(
      record({ status: "accepted", date: invitedDate(["A", "B"]) }),
      "accept",
      NOW,
    );
    expect(afterBoth).toMatchObject({ ok: true, changed: false });
  });

  it("refuses at or after the deadline", () => {
    expect(decideAnswer(record(), "accept", DEADLINE)).toEqual({ ok: false, refusal: "expired" });
    expect(decideAnswer(record(), "accept", LATER)).toEqual({ ok: false, refusal: "expired" });
  });

  it("refuses once the person declined", () => {
    expect(decideAnswer(record({ status: "declined" }), "accept", NOW)).toEqual({
      ok: false,
      refusal: "already_declined",
    });
  });

  it("refuses when the other person declined (the date is closed)", () => {
    const cancelled = { ...invitedDate(), state: "CANCELLED_BEFORE_PAYMENT" as const };
    expect(decideAnswer(record({ status: "withdrawn", date: cancelled }), "accept", NOW)).toEqual({
      ok: false,
      refusal: "closed",
    });
  });

  it("refuses after the date expired", () => {
    const expired = { ...invitedDate(), state: "EXPIRED" as const };
    expect(decideAnswer(record({ status: "expired", date: expired }), "accept", NOW)).toEqual({
      ok: false,
      refusal: "expired",
    });
  });
});

describe("decideAnswer: decline", () => {
  it("ends the date before any money and withdraws the other invitation", () => {
    const decision = decideAnswer(record(), "decline", NOW);
    expect(decision).toMatchObject({
      ok: true,
      changed: true,
      inviteStatus: "declined",
      withdrawOther: true,
    });
    expect(decision.ok && decision.date.state).toBe("CANCELLED_BEFORE_PAYMENT");
  });

  it("lets someone who accepted change their mind before the other answers", () => {
    const decision = decideAnswer(
      record({ status: "accepted", date: invitedDate(["A"]) }),
      "decline",
      NOW,
    );
    expect(decision.ok && decision.date.state).toBe("CANCELLED_BEFORE_PAYMENT");
  });

  it("treats a repeated decline as the same request", () => {
    const cancelled = { ...invitedDate(), state: "CANCELLED_BEFORE_PAYMENT" as const };
    expect(decideAnswer(record({ status: "declined", date: cancelled }), "decline", NOW)).toEqual({
      ok: true,
      changed: false,
      date: cancelled,
      inviteStatus: "declined",
      withdrawOther: false,
    });
  });

  it("refuses after the deadline while the invitation is still open", () => {
    expect(decideAnswer(record(), "decline", LATER)).toEqual({ ok: false, refusal: "expired" });
  });
});

describe("decideAnswer: cancelling a date both accepted", () => {
  const both = () => invitedDate(["A", "B"]);

  it("cancels it with no money involved, whenever it is asked, and leaves the other invitation alone", () => {
    const decision = decideAnswer(record({ status: "accepted", date: both() }), "decline", LATER);
    expect(decision).toMatchObject({
      ok: true,
      changed: true,
      inviteStatus: "declined",
      withdrawOther: false,
    });
    expect(decision.ok && decision.date.state).toBe("CANCELLED_BEFORE_PAYMENT");
  });

  it("shows the other person only that the date is off", () => {
    const decision = decideAnswer(record({ status: "accepted", date: both() }), "decline", NOW);
    if (!decision.ok) throw new Error("refused");
    const other = record({ party: "B", status: "accepted", date: decision.date });
    expect(invitationView(other, NOW).status).toBe("closed");
  });

  it("treats a second cancel as the same request", () => {
    const first = decideAnswer(record({ status: "accepted", date: both() }), "decline", NOW);
    if (!first.ok) throw new Error("refused");
    expect(
      decideAnswer(record({ status: "declined", date: first.date }), "decline", NOW),
    ).toMatchObject({ ok: true, changed: false });
  });
});

describe("openInvitations and expireInvitations", () => {
  it("opens only an eligible date", () => {
    const eligible = { ...invitedDate(), state: "ELIGIBLE" as const };
    expect(openInvitations(eligible)?.state).toBe("INVITED");
    expect(openInvitations(invitedDate())).toBeNull();
  });

  it("expires an invited date at its deadline, not before", () => {
    expect(expireInvitations(invitedDate(), DEADLINE, NOW)).toBeNull();
    expect(expireInvitations(invitedDate(["A"]), DEADLINE, DEADLINE)?.state).toBe("EXPIRED");
  });

  it("leaves a confirmed date alone", () => {
    expect(expireInvitations(invitedDate(["A", "B"]), DEADLINE, LATER)).toBeNull();
  });
});
