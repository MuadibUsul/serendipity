/**
 * Accepting, declining and expiring an invitation. Every change goes through
 * the domain date machine (`transition`), which decides; this module only
 * picks the event and keeps the invitation rows in step with it.
 *
 * - Accept: `PARTY_ACCEPTED` for the person's own side. Both accepted moves
 *   the date to `BOTH_ACCEPTED`.
 * - Decline: `CANCEL` by that person, so the date ends before any money
 *   (`CANCELLED_BEFORE_PAYMENT`). Someone who accepted may still decline
 *   while the other has not answered: anyone may stop at any time (PRD-001 §1.9).
 * - Expiry: `EXPIRE` from the scheduler once the deadline has passed, if the
 *   two have not both accepted. Past the deadline nobody can answer, even
 *   before the job has run.
 * - Answering the same way twice is the same request repeated: it changes
 *   nothing and is not an error.
 */
import { transition } from "@serendipity/domain";
import type { Actor, DateEvent, DateRecord } from "@serendipity/domain";

import type { InvitationRecord, InviteStatus } from "./record.js";

export type Answer = "accept" | "decline";

export type AnswerRefusal =
  /** The deadline has passed. */
  | "expired"
  /** The invitation is over (declined by someone, withdrawn, or past the invitation stage). */
  | "closed"
  /** This person declined and now accepts: a decline is final. */
  | "already_declined";

export type AnswerDecision =
  | {
      readonly ok: true;
      /** False when the answer repeats one already recorded. */
      readonly changed: boolean;
      readonly date: DateRecord;
      /** The person's invitation after the answer. */
      readonly inviteStatus: InviteStatus;
      /** The other person's invitation, if it must change too (a pending one is withdrawn on a decline). */
      readonly withdrawOther: boolean;
    }
  | { readonly ok: false; readonly refusal: AnswerRefusal };

const refuse = (refusal: AnswerRefusal): AnswerDecision => ({ ok: false, refusal });

function apply(date: DateRecord, event: DateEvent, actor: Actor): DateRecord {
  const result = transition(date, event, actor);
  // The checks above only send events the machine accepts in these states; a
  // refusal here is a bug, never a person's mistake.
  if (!result.ok) throw new Error(`invitation: ${result.error.code} (${result.error.message})`);
  return result.date;
}

/** Whether `answer` from the record's person is taken at `now`, and what it changes. */
export function decideAnswer(record: InvitationRecord, answer: Answer, now: Date): AnswerDecision {
  const { invite, date, party } = record;
  const person: Actor = { kind: "user", party };

  // Repeats first: the same answer again is fine whenever it was taken.
  if (answer === "decline" && invite.status === "declined") {
    return { ok: true, changed: false, date, inviteStatus: "declined", withdrawOther: false };
  }
  if (answer === "accept" && invite.status === "accepted" && date.state !== "INVITED") {
    return date.state === "BOTH_ACCEPTED" || date.state === "PAYMENT_PENDING"
      ? { ok: true, changed: false, date, inviteStatus: "accepted", withdrawOther: false }
      : refuse("closed");
  }
  if (answer === "accept" && invite.status === "declined") return refuse("already_declined");

  if (date.state !== "INVITED") return refuse(date.state === "EXPIRED" ? "expired" : "closed");
  if (invite.status === "expired") return refuse("expired");
  if (invite.status === "withdrawn") return refuse("closed");
  if (now.getTime() >= invite.expiresAt.getTime()) return refuse("expired");

  if (answer === "accept") {
    if (invite.status === "accepted") {
      return { ok: true, changed: false, date, inviteStatus: "accepted", withdrawOther: false };
    }
    return {
      ok: true,
      changed: true,
      date: apply(date, { type: "PARTY_ACCEPTED", party }, person),
      inviteStatus: "accepted",
      withdrawOther: false,
    };
  }
  return {
    ok: true,
    changed: true,
    date: apply(date, { type: "CANCEL" }, person),
    inviteStatus: "declined",
    withdrawOther: true,
  };
}

const BOOKING: Actor = { kind: "system", source: "booking" };
const SCHEDULER: Actor = { kind: "system", source: "scheduler" };

/** Sends the invitations of an eligible date: `ELIGIBLE` → `INVITED`. */
export function openInvitations(date: DateRecord): DateRecord | null {
  if (date.state !== "ELIGIBLE") return null;
  return apply(date, { type: "INVITES_SENT" }, BOOKING);
}

/**
 * The date after its invitations' deadline has passed, or `null` when there is
 * nothing to expire (both already accepted, or the date is no longer invited).
 */
export function expireInvitations(date: DateRecord, expiresAt: Date, now: Date): DateRecord | null {
  if (date.state !== "INVITED") return null;
  if (now.getTime() < expiresAt.getTime()) return null;
  return apply(date, { type: "EXPIRE" }, SCHEDULER);
}
