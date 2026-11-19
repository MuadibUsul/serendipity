/**
 * Chat between two people who both said yes after their date (PRD-001 §7;
 * PLAN-001 P05-02: "Any decline, block or pause stops new messages").
 *
 * A message may be sent only while all of these hold:
 * - the two people both said yes (`mutual_opt_in_at`);
 * - neither has left the relationship nor blocked the other;
 * - both accounts are active: a pause, a suspension or a deletion of either
 *   stops new messages, in both directions;
 * - the sender holds the `relationship_chat` consent.
 *
 * Leaving and blocking are one-way doors: they cannot be undone here.
 * Nothing tells the other person *why* chat stopped; they see that it did.
 */

export const MAX_MESSAGE_LENGTH = 2000;

export type ChatRefusal = "not_mutual" | "left" | "blocked" | "account_inactive" | "no_consent";

export interface ChatState {
  readonly mutualOptIn: boolean;
  readonly left: boolean;
  readonly blocked: boolean;
  /** Both people's `users.status`. */
  readonly senderStatus: string;
  readonly peerStatus: string;
  readonly senderConsent: boolean;
}

/** Why a message cannot be sent now, or `null` when it can. */
export function chatRefusal(state: ChatState): ChatRefusal | null {
  if (!state.mutualOptIn) return "not_mutual";
  if (state.blocked) return "blocked";
  if (state.left) return "left";
  if (state.senderStatus !== "active" || state.peerStatus !== "active") return "account_inactive";
  if (!state.senderConsent) return "no_consent";
  return null;
}

/**
 * What the other person learns about why chat stopped: only that it did.
 * Left, blocked, paused and suspended all read the same.
 */
export function peerSees(refusal: ChatRefusal | null): "open" | "closed" | "not_mutual" {
  if (refusal === null || refusal === "no_consent") return "open";
  return refusal === "not_mutual" ? "not_mutual" : "closed";
}

export type ParsedMessage =
  { readonly ok: true; readonly body: string } | { readonly ok: false; readonly problem: string };

/** A message body: text, trimmed, 1 to `MAX_MESSAGE_LENGTH` characters, no control characters. */
export function parseMessageBody(raw: unknown): ParsedMessage {
  if (typeof raw !== "string") return { ok: false, problem: "body must be text" };
  // eslint-disable-next-line no-control-regex
  const body = raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  if (body.length === 0) return { ok: false, problem: "body is empty" };
  if (body.length > MAX_MESSAGE_LENGTH) {
    return { ok: false, problem: `body is longer than ${String(MAX_MESSAGE_LENGTH)} characters` };
  }
  return { ok: true, body };
}
