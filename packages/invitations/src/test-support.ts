// Records for the invitation tests, built through the real date machine.
import { createDate, transition } from "@serendipity/domain";
import type { Actor, DateEvent, DateRecord, Party } from "@serendipity/domain";

import type { InvitationRecord, InviteStatus } from "./record.js";

export const NOW = new Date("2026-11-18T04:00:00Z");
export const DEADLINE = new Date("2026-11-19T04:00:00Z");

function step(date: DateRecord, event: DateEvent, actor: Actor): DateRecord {
  const result = transition(date, event, actor);
  if (!result.ok) throw new Error(result.error.message);
  return result.date;
}

/** A date that has been invited, with the given people already accepted. */
export function invitedDate(accepted: readonly Party[] = []): DateRecord {
  let date = step(
    createDate(),
    { type: "VERIFIER_PASSED" },
    { kind: "system", source: "verifier" },
  );
  date = step(date, { type: "INVITES_SENT" }, { kind: "system", source: "booking" });
  for (const party of accepted) {
    date = step(date, { type: "PARTY_ACCEPTED", party }, { kind: "user", party });
  }
  return date;
}

export function record(
  overrides: {
    readonly party?: Party;
    readonly date?: DateRecord;
    readonly status?: InviteStatus;
    readonly expiresAt?: Date;
  } = {},
): InvitationRecord {
  return {
    dateId: "11111111-1111-4111-8111-111111111111",
    party: overrides.party ?? "A",
    date: overrides.date ?? invitedDate(),
    invite: {
      status: overrides.status ?? "pending",
      expiresAt: overrides.expiresAt ?? DEADLINE,
      respondedAt: overrides.status === "accepted" || overrides.status === "declined" ? NOW : null,
    },
    startsAt: new Date("2026-11-21T07:00:00Z"),
    endsAt: new Date("2026-11-21T08:30:00Z"),
    venue: { name: "示例咖啡馆（虚构）", address: "示例路 1 号（虚构地址）" },
  };
}
