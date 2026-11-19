import { defineLifecycle } from "@serendipity/domain";

export const CHALLENGE_STATES = ["pending", "used", "expired", "locked"] as const;
export type ChallengeState = (typeof CHALLENGE_STATES)[number];

/**
 * A sign-in code (`app.auth_challenges.status`): `pending` until it signs
 * someone in (`used`), runs out or is replaced by a newer code (`expired`),
 * or takes too many wrong tries (`locked`). All three are final.
 */
export const CHALLENGE_LIFECYCLE = defineLifecycle({
  name: "app.auth_challenges.status",
  states: CHALLENGE_STATES,
  initial: "pending",
  transitions: { pending: ["used", "expired", "locked"], used: [], expired: [], locked: [] },
});

export const SESSION_STATES = ["active", "rotated", "revoked"] as const;
export type SessionState = (typeof SESSION_STATES)[number];

/**
 * A session (`app.auth_sessions.status`): `active` until its refresh token is
 * used, which replaces it with a new session in the same family (`rotated`),
 * or until logout or a detected theft ends it (`revoked`). A rotated
 * session's refresh token used again means someone kept a copy: the whole
 * family is revoked, rotated sessions included.
 */
export const SESSION_LIFECYCLE = defineLifecycle({
  name: "app.auth_sessions.status",
  states: SESSION_STATES,
  initial: "active",
  transitions: { active: ["rotated", "revoked"], rotated: ["revoked"], revoked: [] },
});
