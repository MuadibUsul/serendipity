import { describe, expect, it } from "vitest";

import { createAuthorizer } from "./authorizer.js";
import type { AuditSink, GrantSource } from "./authorizer.js";
import { FLOWS } from "./catalog.js";
import type { AuditRecord, ConsentGrant } from "./decide.js";
import { ALICE, grantFor, recipientOf } from "./test-support.js";

const flow = FLOWS.find((candidate) => candidate.recipient === "matching_service");
if (flow === undefined) throw new Error("no matching flow");

const request = {
  subject: ALICE,
  resource: flow.resource,
  purpose: flow.purpose,
  recipient: recipientOf("matching_service", ALICE),
};

function memoryGrants(initial: ConsentGrant[]): GrantSource & { revokeAll(): void; reads: number } {
  let grants = initial;
  return {
    reads: 0,
    grantsFor(subject) {
      this.reads += 1;
      return Promise.resolve(grants.filter((g) => g.userId === subject));
    },
    revokeAll() {
      grants = grants.map((g) => ({ ...g, revokedAt: new Date() }));
    },
  };
}

function memoryAudit(): AuditSink & { entries: AuditRecord[] } {
  const entries: AuditRecord[] = [];
  return {
    entries,
    record(entry) {
      entries.push(entry);
      return Promise.resolve();
    },
  };
}

describe("authorizer", () => {
  it("reads grants on every call, so a revocation stops the very next call", async () => {
    const grants = memoryGrants([grantFor(ALICE, flow)]);
    const audit = memoryAudit();
    const authorizer = createAuthorizer({ grants, audit });

    expect(await authorizer.authorize(request)).toMatchObject({ allowed: true });
    grants.revokeAll();
    expect(await authorizer.authorize(request)).toMatchObject({
      allowed: false,
      reason: "grant_revoked",
    });
    expect(grants.reads).toBe(2);
  });

  it("audits every decision, allowed and denied", async () => {
    const audit = memoryAudit();
    const authorizer = createAuthorizer({ grants: memoryGrants([grantFor(ALICE, flow)]), audit });
    await authorizer.authorize(request);
    await authorizer.authorize({ ...request, recipient: recipientOf("vision_provider", ALICE) });
    expect(audit.entries.map((entry) => [entry.metadata.allowed, entry.metadata.reason])).toEqual([
      [true, "grant"],
      [false, "no_flow"],
    ]);
  });

  it("denies, and audits the denial, when grants cannot be read", async () => {
    const audit = memoryAudit();
    const authorizer = createAuthorizer({
      grants: { grantsFor: () => Promise.reject(new Error("database down")) },
      audit,
    });
    expect(await authorizer.authorize(request)).toMatchObject({
      allowed: false,
      reason: "grant_source_unavailable",
    });
    expect(audit.entries).toHaveLength(1);
  });

  it("denies a request it cannot audit, even one the grants allow", async () => {
    const authorizer = createAuthorizer({
      grants: memoryGrants([grantFor(ALICE, flow)]),
      audit: { record: () => Promise.reject(new Error("audit log down")) },
    });
    expect(await authorizer.authorize(request)).toMatchObject({
      allowed: false,
      reason: "audit_unavailable",
    });
  });
});
