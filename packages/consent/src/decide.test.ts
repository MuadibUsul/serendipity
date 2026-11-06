import { describe, expect, it } from "vitest";

import { FLOWS, OTHER_PERSON_RECIPIENTS, RESOURCES, SCOPES } from "./catalog.js";
import type { Resource } from "./catalog.js";
import { decide } from "./decide.js";
import {
  ALICE,
  BOB,
  CAROL,
  everyGrant,
  grant,
  grantFor,
  recipientForFlow,
  recipientOf,
} from "./test-support.js";

const RAW: readonly Resource[] = [
  "voice_audio",
  "transcript",
  "match_photos",
  "visual_features",
  "profile_facts",
];

describe("the policy (PLAN-001 §8.1)", () => {
  it("never sends raw voice, transcripts, photos, visual features or profiles to another person or their agent", () => {
    const leaks = FLOWS.filter(
      (flow) => OTHER_PERSON_RECIPIENTS.includes(flow.recipient) && RAW.includes(flow.resource),
    );
    expect(leaks).toEqual([]);
  });

  it("lists each flow once, each under an existing scope", () => {
    const keys = FLOWS.map((flow) => `${flow.resource}/${flow.purpose}/${flow.recipient}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const flow of FLOWS) expect(SCOPES[flow.scope]).toBeDefined();
  });
});

describe("own data", () => {
  it.each(RESOURCES)("a person may read their own %s without any grant", (resource) => {
    const decision = decide(
      { subject: ALICE, resource, purpose: "matching", recipient: recipientOf("person", ALICE) },
      [],
    );
    expect(decision).toMatchObject({ allowed: true, reason: "own_data" });
  });

  it.each(RESOURCES)("a person may never read someone else's %s directly", (resource) => {
    const decision = decide(
      { subject: BOB, resource, purpose: "matching", recipient: recipientOf("person", ALICE) },
      everyGrant(BOB),
    );
    expect(decision).toMatchObject({ allowed: false, reason: "cross_user" });
  });
});

describe.each(FLOWS)("flow $resource → $recipient for $purpose", (flow) => {
  const request = {
    subject: ALICE,
    resource: flow.resource,
    purpose: flow.purpose,
    recipient: recipientForFlow(flow, ALICE, BOB),
  };

  it("is denied without a grant", () => {
    expect(decide(request, [])).toMatchObject({ allowed: false, reason: "no_grant" });
  });

  it("is allowed with exactly its grant, and names the grant", () => {
    const granted = grantFor(ALICE, flow);
    expect(decide(request, [granted])).toMatchObject({
      allowed: true,
      reason: "grant",
      grantId: granted.id,
    });
  });

  it("is denied once the grant is revoked", () => {
    const revoked = grantFor(ALICE, flow, { revokedAt: new Date("2026-11-05T12:00:00Z") });
    expect(decide(request, [revoked])).toMatchObject({ allowed: false, reason: "grant_revoked" });
  });

  it("is denied with a grant from before the scope's minimum version", () => {
    const old = grantFor(ALICE, flow, { version: SCOPES[flow.scope].minimumVersion - 1 });
    expect(decide(request, [old])).toMatchObject({ allowed: false, reason: "grant_outdated" });
  });

  it("is denied with a grant for another purpose, recipient or scope", () => {
    const near = [
      grant(
        ALICE,
        flow.scope,
        "date_booking" === flow.purpose ? "matching" : "date_booking",
        flow.recipient,
      ),
      grant(ALICE, flow.scope, flow.purpose, flow.recipient === "venue" ? "own_agent" : "venue"),
      grant(
        ALICE,
        flow.scope === "venue_booking" ? "voice_processing" : "venue_booking",
        flow.purpose,
        flow.recipient,
      ),
    ];
    expect(decide(request, near)).toMatchObject({ allowed: false, reason: "no_grant" });
  });

  it("is not opened by somebody else's grant", () => {
    expect(decide(request, [grantFor(BOB, flow), grantFor(CAROL, flow)])).toMatchObject({
      allowed: false,
      reason: "no_grant",
    });
  });
});

describe("cross-user access", () => {
  it("refuses an agent of one person reading another person's data as their own agent", () => {
    const decision = decide(
      {
        subject: BOB,
        resource: "profile_facts",
        purpose: "negotiation",
        recipient: recipientOf("own_agent", ALICE),
      },
      everyGrant(BOB),
    );
    expect(decision).toMatchObject({ allowed: false, reason: "cross_user" });
  });

  it.each(RAW)("refuses the counterpart's agent %s, even with every grant given", (resource) => {
    const decision = decide(
      {
        subject: BOB,
        resource,
        purpose: "negotiation",
        recipient: recipientOf("counterpart_agent", ALICE),
      },
      everyGrant(BOB),
    );
    expect(decision).toMatchObject({ allowed: false, reason: "no_flow" });
  });

  it.each(RAW)("refuses a relationship peer %s, even with every grant given", (resource) => {
    const decision = decide(
      {
        subject: BOB,
        resource,
        purpose: "relationship_messaging",
        recipient: recipientOf("relationship_peer", ALICE),
      },
      everyGrant(BOB),
    );
    expect(decision).toMatchObject({ allowed: false, reason: "no_flow" });
  });

  it("refuses a 'counterpart' or 'peer' that is the subject themselves", () => {
    for (const kind of OTHER_PERSON_RECIPIENTS) {
      const decision = decide(
        {
          subject: ALICE,
          resource: "chat_messages",
          purpose: "relationship_messaging",
          recipient: recipientOf(kind, ALICE),
        },
        everyGrant(ALICE),
      );
      expect(decision).toMatchObject({ allowed: false, reason: "invalid_recipient" });
    }
  });
});

describe("revocation", () => {
  it("still allows through another live grant of the same flow", () => {
    const flow = FLOWS[0];
    if (flow === undefined) throw new Error("no flows");
    const revoked = grantFor(ALICE, flow, { revokedAt: new Date() });
    const live = grantFor(ALICE, flow);
    const request = {
      subject: ALICE,
      resource: flow.resource,
      purpose: flow.purpose,
      recipient: recipientForFlow(flow, ALICE, BOB),
    };
    expect(decide(request, [revoked, live])).toMatchObject({ allowed: true, grantId: live.id });
  });
});

describe("audit records", () => {
  it("describe the decision without carrying any data", () => {
    const flow = FLOWS.find((candidate) => candidate.recipient === "counterpart_agent");
    if (flow === undefined) throw new Error("no counterpart flow");
    const granted = grantFor(BOB, flow);
    const decision = decide(
      {
        subject: BOB,
        resource: flow.resource,
        purpose: flow.purpose,
        recipient: recipientOf("counterpart_agent", ALICE),
      },
      [granted],
    );
    expect(decision.audit).toEqual({
      actorType: "agent",
      actorId: ALICE,
      action: "consent.authorize",
      objectType: "user",
      objectId: BOB,
      policyVersion: 1,
      metadata: {
        allowed: true,
        reason: "grant",
        resource: "compatibility_signals",
        purpose: "negotiation",
        recipientClass: "counterpart_agent",
        scope: "counterpart_disclosure",
        scopeVersion: 1,
        grantId: granted.id,
      },
    });
  });
});
