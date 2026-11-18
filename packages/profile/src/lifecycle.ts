import { defineLifecycle } from "@serendipity/domain";

export const VERSION_STATES = ["draft", "approved", "superseded", "withdrawn"] as const;
export type VersionState = (typeof VERSION_STATES)[number];

/**
 * How a profile version moves (`app.profile_versions.approval_state`): a
 * draft is edited until the person approves it; approving another version
 * supersedes it; the person may withdraw it. Only a draft can change, and a
 * version never goes back to draft. Migration 0009 refuses any other move.
 */
export const VERSION_LIFECYCLE = defineLifecycle({
  name: "app.profile_versions.approval_state",
  states: VERSION_STATES,
  initial: "draft",
  transitions: {
    draft: ["approved"],
    approved: ["superseded", "withdrawn"],
    superseded: [],
    withdrawn: [],
  },
});
