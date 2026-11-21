/**
 * The invitation as its person sees it (PRD-001 §5.3, §6.1): when, where,
 * and where it stands. Built field by field from an allowlist, never by
 * spreading a record, so a field added to the record later cannot leak.
 *
 * Privacy rules beyond "nothing about the other person":
 * - Whether the other person has accepted is not shown. The viewer learns only
 *   their own answer, and that the date is confirmed once both have accepted.
 * - A date the other person declined looks exactly like one that expired:
 *   "closed", with no reason (PRD-001 §7: a refusal is never made public).
 */
import { OPENS_BEFORE_MIN } from "@serendipity/checkin/window";
import type { DateState } from "@serendipity/domain";

import type { InvitationRecord } from "./record.js";

export const VIEW_STATUSES = [
  /** Waiting for this person's answer. */
  "awaiting_you",
  /** This person accepted; the date is not confirmed yet. */
  "accepted",
  /** Both accepted: the date goes on to payment and booking. */
  "confirmed",
  /** This person declined. */
  "declined",
  /** Not happening, for a reason that is not shown (declined by someone else, expired, withdrawn). */
  "closed",
] as const;
export type ViewStatus = (typeof VIEW_STATUSES)[number];

export interface InvitationView {
  readonly date_id: string;
  readonly status: ViewStatus;
  /** Until when an answer is taken; only while one is still possible. */
  readonly answer_by: string | null;
  readonly starts_at: string | null;
  readonly ends_at: string | null;
  readonly venue: { readonly name: string; readonly address: string } | null;
  /** When the check-in code starts working (ADR-0028); only once the date is confirmed. */
  readonly checkin_opens_at: string | null;
}

/** The keys a view may carry, for tests and for anyone reviewing the contract. */
export const VIEW_KEYS = [
  "date_id",
  "status",
  "answer_by",
  "starts_at",
  "ends_at",
  "venue",
  "checkin_opens_at",
] as const;
export const VENUE_KEYS = ["name", "address"] as const;

/** The date has gone past the invitation: both accepted and it moves on. */
const CONFIRMED_STATES: readonly DateState[] = [
  "BOTH_ACCEPTED",
  "PAYMENT_PENDING",
  "BOTH_PAID",
  "VENUE_RESERVED",
  "CONFIRMED",
  "VENUE_UNAVAILABLE",
  "CHECKIN_PARTIAL",
  "BOTH_CHECKED_IN",
];

/** The invitation is over without a date. */
const CLOSED_STATES: readonly DateState[] = [
  "EXPIRED",
  "CANCELLED_BEFORE_PAYMENT",
  "CANCELLED_REFUND_PENDING",
  "CLOSED",
];

export function viewStatus(record: InvitationRecord, now: Date): ViewStatus {
  const { invite, date } = record;
  if (invite.status === "declined") return "declined";
  if (CLOSED_STATES.includes(date.state)) return "closed";
  if (CONFIRMED_STATES.includes(date.state)) return "confirmed";
  if (date.state !== "INVITED") return "closed";
  if (invite.status === "expired" || invite.status === "withdrawn") return "closed";
  // Past the deadline but the expiry job has not run yet: already closed for everyone.
  if (now.getTime() >= invite.expiresAt.getTime()) return "closed";
  return invite.status === "accepted" ? "accepted" : "awaiting_you";
}

/** What the viewer may see of their invitation, and nothing else. */
export function invitationView(record: InvitationRecord, now: Date): InvitationView {
  const status = viewStatus(record, now);
  const open = status === "awaiting_you" || status === "accepted";
  return {
    date_id: record.dateId,
    status,
    answer_by: open ? record.invite.expiresAt.toISOString() : null,
    starts_at: record.startsAt === null ? null : record.startsAt.toISOString(),
    ends_at: record.endsAt === null ? null : record.endsAt.toISOString(),
    venue:
      record.venue === null ? null : { name: record.venue.name, address: record.venue.address },
    checkin_opens_at:
      status === "confirmed" && record.startsAt !== null
        ? new Date(record.startsAt.getTime() - OPENS_BEFORE_MIN * 60_000).toISOString()
        : null,
  };
}
