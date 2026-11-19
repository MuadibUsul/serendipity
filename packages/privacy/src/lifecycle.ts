import { defineLifecycle } from "@serendipity/domain";

export const DELETION_STATES = ["requested", "purging", "failed", "completed"] as const;
export type DeletionState = (typeof DELETION_STATES)[number];

/**
 * An account deletion (`app.account_deletion_requests.status`): `requested`,
 * then `purging` while the job removes data, then `completed`, or `failed`
 * at a named stage and claimed again (`purging`) on the next run. A purge
 * left `purging` for too long is re-claimed in place, which is not a move.
 */
export const DELETION_LIFECYCLE = defineLifecycle({
  name: "app.account_deletion_requests.status",
  states: DELETION_STATES,
  initial: "requested",
  transitions: {
    requested: ["purging"],
    purging: ["failed", "completed"],
    failed: ["purging"],
    completed: [],
  },
});
