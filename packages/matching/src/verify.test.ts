import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { decidePair } from "./pair.js";
import { CONTEXT, person } from "./test-support.js";
import { verifyPass } from "./verify.js";
import type { Now, ProposedPass } from "./verify.js";

const AT = new Date("2026-11-19T10:00:00Z");

const proposed = (overrides: Partial<ProposedPass> = {}): ProposedPass => ({
  pairId: "pair-1",
  userA: "ana",
  userB: "bo",
  expiresAt: new Date(AT.getTime() + 60_000),
  policyVersionA: 1,
  policyVersionB: 1,
  verdict: "PASS",
  protocolVersion: "a2a-match/0.1",
  ...overrides,
});

const now = (overrides: Partial<Now> = {}): Now => ({
  at: AT,
  a: person("ana"),
  b: person("bo"),
  context: CONTEXT,
  consentVersionA: 1,
  consentVersionB: 1,
  supportedProtocols: ["a2a-match/0.1"],
  ...overrides,
});

describe("verifyPass", () => {
  it("confirms a PASS that still holds, and audits it", () => {
    expect(verifyPass(proposed(), now())).toEqual({
      confirmed: true,
      audit: {
        actorType: "system",
        actorId: null,
        action: "match.pass.confirmed",
        objectType: "candidate_pair",
        objectId: "pair-1",
        metadata: { verdict: "PASS", protocol_version: "a2a-match/0.1", reasons: [] },
      },
    });
  });

  it.each([
    [
      "a verdict that is not PASS",
      proposed({ verdict: "NEEDS_USER_CLARIFICATION" }),
      now(),
      "not_a_pass",
    ],
    [
      "an unknown protocol",
      proposed({ protocolVersion: "a2a-match/9" }),
      now(),
      "unsupported_protocol",
    ],
    ["other people", proposed({ userB: "cy" }), now(), "wrong_people"],
    ["another first person", proposed({ userA: "cy" }), now(), "wrong_people"],
    [
      "the two people swapped",
      proposed(),
      now({ a: person("bo"), b: person("ana") }),
      "wrong_people",
    ],
    ["an expired pair", proposed(), now({ at: new Date(AT.getTime() + 60_000) }), "expired"],
    ["withdrawn consent", proposed(), now({ consentVersionB: null }), "consent_missing:b"],
    ["consent under a new policy", proposed(), now({ consentVersionA: 2 }), "consent_changed:a"],
    [
      "a person who paused",
      proposed(),
      now({ a: person("ana", { accountStatus: "paused" }) }),
      "hard_rule:a:account_paused",
    ],
    [
      "a block since the negotiation",
      proposed(),
      now({ b: person("bo", { blockedIds: ["ana"] }) }),
      "hard_rule:b:blocked_the_other",
    ],
    [
      "a date booked since",
      proposed(),
      now({ a: person("ana", { hasActiveDate: true }) }),
      "hard_rule:a:active_date",
    ],
  ])("overturns %s", (_name, pass, world, reason) => {
    const result = verifyPass(pass, world);
    expect(result.confirmed).toBe(false);
    expect(result.audit.action).toBe("match.pass.overturned");
    expect(result.audit.metadata.reasons).toContain(reason);
  });

  it("reports every reason, not only the first", () => {
    const result = verifyPass(
      proposed({ verdict: "REJECT" }),
      now({ at: new Date(AT.getTime() + 10 ** 9), consentVersionA: null }),
    );
    expect(result.audit.metadata.reasons).toEqual(["not_a_pass", "expired", "consent_missing:a"]);
  });

  it("puts no ids or rule values in the audit metadata", () => {
    const result = verifyPass(proposed(), now({ b: person("bo", { blockedIds: ["ana"] }) }));
    expect(JSON.stringify(result.audit.metadata)).not.toMatch(/ana|bo\b/);
  });

  it("never confirms what decidePair now refuses", () => {
    fc.assert(
      fc.property(
        fc.record({
          accountStatus: fc.constantFrom(
            "active" as const,
            "paused" as const,
            "suspended" as const,
          ),
          identityEligible: fc.boolean(),
          age: fc.constantFrom(17, 24, 30, 40, null),
          hasActiveDate: fc.boolean(),
          blocks: fc.boolean(),
        }),
        fc.boolean(),
        (change, onA) => {
          const changed = person(onA ? "ana" : "bo", {
            accountStatus: change.accountStatus,
            identityEligible: change.identityEligible,
            age: change.age,
            hasActiveDate: change.hasActiveDate,
            blockedIds: change.blocks ? [onA ? "bo" : "ana"] : [],
          });
          const world = onA ? now({ a: changed }) : now({ b: changed });
          const result = verifyPass(proposed(), world);
          expect(result.confirmed).toBe(decidePair(world.a, world.b, world.context).pass);
        },
      ),
    );
  });
});
