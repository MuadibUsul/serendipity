import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { FLOWS, PURPOSES, RECIPIENT_CLASSES, RESOURCES, SCOPES } from "./catalog.js";
import type { RecipientClass } from "./catalog.js";
import { decide } from "./decide.js";
import type { AccessRequest, ConsentGrant, Recipient } from "./decide.js";
import { ALICE, BOB, CAROL, everyGrant, recipientOf } from "./test-support.js";

const PEOPLE = [ALICE, BOB, CAROL];
const person = fc.constantFrom(...PEOPLE);
const recipientKind = fc.constantFrom<RecipientClass | "person">("person", ...RECIPIENT_CLASSES);

const recipient: fc.Arbitrary<Recipient> = fc
  .tuple(recipientKind, person)
  .map(([kind, actor]) => recipientOf(kind, actor));

const request: fc.Arbitrary<AccessRequest> = fc.record({
  subject: person,
  resource: fc.constantFrom(...RESOURCES),
  purpose: fc.constantFrom(...PURPOSES),
  recipient,
});

const grantArb: fc.Arbitrary<ConsentGrant> = fc.record({
  id: fc.uuid(),
  userId: person,
  scope: fc.constantFrom(...Object.keys(SCOPES), "retired_scope"),
  purpose: fc.constantFrom<string>(...PURPOSES),
  recipientClass: fc.constantFrom<string>(...RECIPIENT_CLASSES),
  version: fc.integer({ min: 0, max: 2 }),
  revokedAt: fc.option(fc.constant(new Date("2026-11-05T12:00:00Z")), { nil: null }),
});

const grants = fc.array(grantArb, { maxLength: 30 });

/** A request along a real policy flow (random requests are almost never allowed). */
const flowRequest: fc.Arbitrary<AccessRequest> = fc
  .tuple(fc.constantFrom(...FLOWS), person, person)
  .map(([flow, subject, other]) => ({
    subject,
    resource: flow.resource,
    purpose: flow.purpose,
    recipient: recipientOf(flow.recipient, flow.recipient === "own_agent" ? subject : other),
  }));

const anyRequest = fc.oneof(request, flowRequest);

/** Random grants, plus sometimes the exact grant the request's flow needs (live, old or revoked). */
function grantsAround(req: AccessRequest): fc.Arbitrary<ConsentGrant[]> {
  const flow = FLOWS.find(
    (f) =>
      f.resource === req.resource &&
      f.purpose === req.purpose &&
      f.recipient === req.recipient.kind,
  );
  const exact: fc.Arbitrary<ConsentGrant[]> =
    flow === undefined
      ? fc.constant([])
      : fc
          .record({
            include: fc.boolean(),
            id: fc.uuid(),
            version: fc.integer({ min: 0, max: 2 }),
            revoked: fc.boolean(),
          })
          .map(({ include, id, version, revoked }) =>
            include
              ? [
                  {
                    id,
                    userId: req.subject,
                    scope: flow.scope,
                    purpose: flow.purpose,
                    recipientClass: flow.recipient,
                    version,
                    revokedAt: revoked ? new Date("2026-11-05T12:00:00Z") : null,
                  },
                ]
              : [],
          );
  return fc.tuple(grants, exact).map(([random, extra]) => [...random, ...extra]);
}

const requestWithGrants = anyRequest.chain((req) =>
  grantsAround(req).map((given) => [req, given] as const),
);

/** Whom a recipient acts for, if it is a person or a person's agent. */
function actsFor(target: Recipient): string | null {
  switch (target.kind) {
    case "person":
    case "relationship_peer":
      return target.userId;
    case "own_agent":
    case "counterpart_agent":
      return target.actingFor;
    case "voice_provider":
    case "vision_provider":
    case "profile_extractor":
    case "matching_service":
    case "venue":
      return null;
  }
}

/**
 * The policy restated from PLAN-001 §8 and ARCH-001 §10, independently of
 * `decide`: allowed exactly when it is one's own data, or when the flow is
 * listed, the recipient fits the subject, and the subject holds a live,
 * current grant for that flow.
 */
function oracle(req: AccessRequest, given: readonly ConsentGrant[]): boolean {
  const actor = actsFor(req.recipient);
  if (req.recipient.kind === "person") return actor === req.subject;
  const actsForSubject = actor === req.subject;
  if (req.recipient.kind === "own_agent" && !actsForSubject) return false;
  if (
    (req.recipient.kind === "counterpart_agent" || req.recipient.kind === "relationship_peer") &&
    actsForSubject
  ) {
    return false;
  }
  return FLOWS.some(
    (flow) =>
      flow.resource === req.resource &&
      flow.purpose === req.purpose &&
      flow.recipient === req.recipient.kind &&
      given.some(
        (g) =>
          g.userId === req.subject &&
          g.scope === flow.scope &&
          g.purpose === flow.purpose &&
          g.recipientClass === flow.recipient &&
          g.revokedAt === null &&
          g.version >= SCOPES[flow.scope].minimumVersion,
      ),
  );
}

describe("consent properties", () => {
  it("denies by default: with no grants, only a person's own data is readable", () => {
    fc.assert(
      fc.property(request, (req) => {
        const own = req.recipient.kind === "person" && req.recipient.userId === req.subject;
        expect(decide(req, []).allowed).toBe(own);
      }),
      { numRuns: 2000 },
    );
  });

  it("allows exactly what the policy allows, for any grants", () => {
    let allowed = 0;
    fc.assert(
      fc.property(requestWithGrants, ([req, given]) => {
        const decision = decide(req, given);
        expect(decision.allowed).toBe(oracle(req, given));
        if (decision.allowed) allowed += 1;
      }),
      { numRuns: 5000 },
    );
    // The generators must exercise both outcomes, not just denials.
    expect(allowed).toBeGreaterThan(200);
  });

  it("after revocation, every later call needing that scope is denied", () => {
    fc.assert(
      fc.property(requestWithGrants, ([req, given]) => {
        const before = decide(req, given);
        fc.pre(before.allowed && before.reason === "grant");
        const scope = before.audit.metadata.scope;
        const revoked = given.map((g) =>
          g.userId === req.subject && g.scope === scope ? { ...g, revokedAt: new Date() } : g,
        );
        expect(decide(req, revoked)).toMatchObject({ allowed: false });
      }),
      { numRuns: 1000 },
    );
  });

  it("never lets one person's principal read another person's raw data, whatever was granted", () => {
    const channels = new Set([
      "compatibility_signals/counterpart_agent",
      "chat_messages/relationship_peer",
    ]);
    fc.assert(
      fc.property(anyRequest, (req) => {
        const actor = actsFor(req.recipient);
        fc.pre(actor !== null && actor !== req.subject);
        const decision = decide(req, everyGrant(req.subject));
        if (!channels.has(`${req.resource}/${req.recipient.kind}`)) {
          expect(decision.allowed).toBe(false);
        }
      }),
      { numRuns: 2000 },
    );
  });

  it("ignores other people's grants entirely", () => {
    fc.assert(
      fc.property(requestWithGrants, ([req, given]) => {
        const own = given.filter((g) => g.userId === req.subject);
        expect(decide(req, given)).toEqual(decide(req, own));
      }),
      { numRuns: 2000 },
    );
  });

  it("audits every decision about the subject, with no data in it", () => {
    fc.assert(
      fc.property(requestWithGrants, ([req, given]) => {
        const decision = decide(req, given);
        expect(decision.audit.objectId).toBe(req.subject);
        expect(decision.audit.metadata.allowed).toBe(decision.allowed);
        expect(Object.keys(decision.audit.metadata).sort()).toEqual([
          "allowed",
          "grantId",
          "purpose",
          "reason",
          "recipientClass",
          "resource",
          "scope",
          "scopeVersion",
        ]);
      }),
      { numRuns: 1000 },
    );
  });
});
