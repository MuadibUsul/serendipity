/**
 * What the invitation logic works on: one person's side of one date. It is
 * built for a viewer, so it holds that person's invitation and the facts the
 * two share (time, venue, where the date stands), and nothing that belongs to
 * the other person: no id, no profile, no photo, no contact (ADR-006: hidden
 * at the API layer, not only in the UI). The repository fills it without ever
 * selecting the other person's columns.
 */
import type { DateRecord, Party } from "@serendipity/domain";

export const INVITE_STATUSES = ["pending", "accepted", "declined", "expired", "withdrawn"] as const;
export type InviteStatus = (typeof INVITE_STATUSES)[number];

export interface Venue {
  readonly name: string;
  readonly address: string;
}

export interface InvitationRecord {
  readonly dateId: string;
  /** The viewer's side of the date. */
  readonly party: Party;
  /** Where the date stands (`@serendipity/domain`). Holds both sides' flags: never shown as is. */
  readonly date: DateRecord;
  /** The viewer's own invitation. */
  readonly invite: {
    readonly status: InviteStatus;
    readonly expiresAt: Date;
    readonly respondedAt: Date | null;
  };
  /** The proposed time, once there is one. */
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
  /** The venue, once one is chosen. */
  readonly venue: Venue | null;
}
