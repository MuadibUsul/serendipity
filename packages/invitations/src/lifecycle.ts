import { defineLifecycle } from "@serendipity/domain";

import { INVITE_STATUSES } from "./record.js";

/**
 * How one person's invitation moves (`app.date_invites.status`). The date
 * machine decides when; this table says where an invitation may go at all,
 * and migration 0009 refuses any other move in the database.
 *
 * - `pending` → `accepted` | `declined` (the person answers), `expired` (the
 *   deadline passes), `withdrawn` (the other person declined first).
 * - `accepted` → `declined`: anyone may stop at any time (PRD-001 §1.9).
 * - `declined`, `expired` and `withdrawn` are final.
 */
export const INVITE_LIFECYCLE = defineLifecycle({
  name: "app.date_invites.status",
  states: INVITE_STATUSES,
  initial: "pending",
  transitions: {
    pending: ["accepted", "declined", "expired", "withdrawn"],
    accepted: ["declined"],
    declined: [],
    expired: [],
    withdrawn: [],
  },
});
