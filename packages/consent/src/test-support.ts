// Shared by the consent tests; not exported from the package.
import { FLOWS, PURPOSES, RECIPIENT_CLASSES, SCOPES } from "./catalog.js";
import type { Flow, RecipientClass } from "./catalog.js";
import type { ConsentGrant, Recipient } from "./decide.js";

export const ALICE = "00000000-0000-4000-8000-00000000000a";
export const BOB = "00000000-0000-4000-8000-00000000000b";
export const CAROL = "00000000-0000-4000-8000-00000000000c";
export const VENUE = "00000000-0000-4000-8000-0000000000e1";

let sequence = 0;

export function grant(
  userId: string,
  scope: string,
  purpose: string,
  recipientClass: string,
  extra: Partial<Pick<ConsentGrant, "version" | "revokedAt" | "id">> = {},
): ConsentGrant {
  sequence += 1;
  return {
    id: extra.id ?? `grant-${String(sequence)}`,
    userId,
    scope,
    purpose,
    recipientClass,
    version: extra.version ?? 1,
    revokedAt: extra.revokedAt ?? null,
  };
}

/** The grant that permits `flow` for `userId`. */
export function grantFor(
  userId: string,
  flow: Flow,
  extra: Parameters<typeof grant>[4] = {},
): ConsentGrant {
  return grant(userId, flow.scope, flow.purpose, flow.recipient, extra);
}

/** Every grant a person could possibly give: each scope × purpose × recipient. */
export function everyGrant(userId: string): ConsentGrant[] {
  return Object.keys(SCOPES).flatMap((scope) =>
    PURPOSES.flatMap((purpose) =>
      RECIPIENT_CLASSES.map((recipientClass) => grant(userId, scope, purpose, recipientClass)),
    ),
  );
}

/** A recipient of `kind` that acts for `actor` (or is `actor`, for people). */
export function recipientOf(kind: RecipientClass | "person", actor: string): Recipient {
  switch (kind) {
    case "person":
      return { kind, userId: actor };
    case "own_agent":
    case "counterpart_agent":
      return { kind, actingFor: actor };
    case "relationship_peer":
      return { kind, userId: actor };
    case "venue":
      return { kind, venueId: VENUE };
    case "voice_provider":
    case "vision_provider":
    case "profile_extractor":
    case "matching_service":
      return { kind };
  }
}

/** The recipient for `flow` when `subject`'s data goes out and the other side is `other`. */
export function recipientForFlow(flow: Flow, subject: string, other: string): Recipient {
  return recipientOf(flow.recipient, flow.recipient === "own_agent" ? subject : other);
}

export { FLOWS };
