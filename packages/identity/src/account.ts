import { defineLifecycle } from "@serendipity/domain";

export const ACCOUNT_STATES = ["pending", "active", "paused", "suspended", "deleted"] as const;
export type AccountState = (typeof ACCOUNT_STATES)[number];

/**
 * How an account moves (`app.users.status`; PRD-001 §7, §8.1). A new account
 * is `pending` until it may be matched (`active`). The person may pause and
 * resume; safety may suspend and, after review or appeal, restore; deletion
 * is final and leaves a tombstone. Written today by account deletion
 * (`paused`, `deleted`); pause, resume and suspension are declared here so
 * their writers inherit the guard (migration 0013).
 */
export const ACCOUNT_LIFECYCLE = defineLifecycle({
  name: "app.users.status",
  states: ACCOUNT_STATES,
  initial: "pending",
  transitions: {
    pending: ["active", "paused", "suspended", "deleted"],
    active: ["paused", "suspended", "deleted"],
    paused: ["active", "suspended", "deleted"],
    suspended: ["active", "deleted"],
    deleted: [],
  },
});
