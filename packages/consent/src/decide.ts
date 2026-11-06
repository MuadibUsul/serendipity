import { assertNever } from "@serendipity/domain";

import { CONSENT_POLICY_VERSION, FLOWS, SCOPES } from "./catalog.js";
import type { Purpose, RecipientClass, Resource, ScopeId } from "./catalog.js";

/** Who would receive the data. */
export type Recipient =
  /** A signed-in person reading data directly. */
  | { readonly kind: "person"; readonly userId: string }
  /** A person's own agent, acting for them. */
  | { readonly kind: "own_agent"; readonly actingFor: string }
  /** The agent of a candidate, acting for that other person (ARCH-001 §7.3). */
  | { readonly kind: "counterpart_agent"; readonly actingFor: string }
  /** The other person of an open relationship (ARCH-001 §9). */
  | { readonly kind: "relationship_peer"; readonly userId: string }
  | { readonly kind: "voice_provider" }
  | { readonly kind: "vision_provider" }
  | { readonly kind: "profile_extractor" }
  | { readonly kind: "matching_service" }
  | { readonly kind: "venue"; readonly venueId: string };

export interface AccessRequest {
  /** The person the data is about. */
  readonly subject: string;
  readonly resource: Resource;
  readonly purpose: Purpose;
  readonly recipient: Recipient;
}

/**
 * A row of `app.consent_grants`. Scope, purpose and recipient are plain
 * strings because stored grants may name scopes this version no longer has.
 */
export interface ConsentGrant {
  readonly id: string;
  readonly userId: string;
  readonly scope: string;
  readonly purpose: string;
  readonly recipientClass: string;
  readonly version: number;
  readonly revokedAt: Date | null;
}

export type DenyReason =
  /** Someone reaching another person's data outside the two allowed channels. */
  | "cross_user"
  /** A recipient that contradicts the subject (an agent "of the other side" acting for the subject). */
  | "invalid_recipient"
  /** The flow is not in the policy: denied whatever was granted. */
  | "no_flow"
  | "no_grant"
  | "grant_revoked"
  /** Granted under an older version of the scope; the person must be asked again. */
  | "grant_outdated"
  | "grant_source_unavailable"
  | "audit_unavailable";

export type AllowReason = "own_data" | "grant";

/** The audit entry for one decision; it never carries the data itself. */
export interface AuditRecord {
  readonly actorType: "user" | "agent" | "merchant" | "system";
  readonly actorId: string | null;
  readonly action: "consent.authorize";
  readonly objectType: "user";
  readonly objectId: string;
  readonly policyVersion: number;
  readonly metadata: {
    readonly allowed: boolean;
    readonly reason: AllowReason | DenyReason;
    readonly resource: Resource;
    readonly purpose: Purpose;
    readonly recipientClass: RecipientClass | "person";
    readonly scope: ScopeId | null;
    readonly scopeVersion: number | null;
    readonly grantId: string | null;
  };
}

export type Decision =
  | {
      readonly allowed: true;
      readonly reason: AllowReason;
      readonly grantId: string | null;
      readonly audit: AuditRecord;
    }
  | { readonly allowed: false; readonly reason: DenyReason; readonly audit: AuditRecord };

/**
 * Whether `request` may proceed, given the subject's grants. Pure; deny by
 * default. Only the subject's own grants count, whatever else is passed in.
 *
 * 1. A person reading their own data is allowed; anyone else's is not.
 * 2. A recipient must fit the subject: a person's own agent acts for that
 *    person; a counterpart agent or relationship peer is someone else.
 * 3. The (resource, purpose, recipient) flow must be in the policy.
 * 4. The subject must hold an unrevoked grant for exactly that flow's scope,
 *    purpose and recipient, at or above the scope's minimum version.
 */
export function decide(request: AccessRequest, grants: readonly ConsentGrant[]): Decision {
  const { subject, recipient } = request;

  if (recipient.kind === "person") {
    return recipient.userId === subject
      ? allow(request, "own_data", null)
      : deny(request, "cross_user");
  }
  if (recipient.kind === "own_agent" && recipient.actingFor !== subject) {
    return deny(request, "cross_user");
  }
  if (
    (recipient.kind === "counterpart_agent" && recipient.actingFor === subject) ||
    (recipient.kind === "relationship_peer" && recipient.userId === subject)
  ) {
    return deny(request, "invalid_recipient");
  }

  const flow = FLOWS.find(
    (candidate) =>
      candidate.resource === request.resource &&
      candidate.purpose === request.purpose &&
      candidate.recipient === recipient.kind,
  );
  if (flow === undefined) return deny(request, "no_flow");

  const matching = grants.filter(
    (grant) =>
      grant.userId === subject &&
      grant.scope === flow.scope &&
      grant.purpose === request.purpose &&
      grant.recipientClass === recipient.kind,
  );
  const live = matching.filter((grant) => grant.revokedAt === null);
  const current = live
    .filter((grant) => grant.version >= SCOPES[flow.scope].minimumVersion)
    .sort((a, b) => b.version - a.version);
  const chosen = current[0];
  if (chosen !== undefined) return allow(request, "grant", chosen, flow.scope);
  if (live.length > 0) return deny(request, "grant_outdated", flow.scope);
  if (matching.length > 0) return deny(request, "grant_revoked", flow.scope);
  return deny(request, "no_grant", flow.scope);
}

/** A denial for `request` that the engine reaches without looking at grants. */
export function denial(request: AccessRequest, reason: DenyReason): Decision {
  return deny(request, reason);
}

function allow(
  request: AccessRequest,
  reason: AllowReason,
  grant: ConsentGrant | null,
  scope: ScopeId | null = null,
): Decision {
  return {
    allowed: true,
    reason,
    grantId: grant?.id ?? null,
    audit: audit(request, true, reason, scope, grant),
  };
}

function deny(request: AccessRequest, reason: DenyReason, scope: ScopeId | null = null): Decision {
  return { allowed: false, reason, audit: audit(request, false, reason, scope, null) };
}

function audit(
  request: AccessRequest,
  allowed: boolean,
  reason: AllowReason | DenyReason,
  scope: ScopeId | null,
  grant: ConsentGrant | null,
): AuditRecord {
  const { actorType, actorId } = actorOf(request.recipient);
  return {
    actorType,
    actorId,
    action: "consent.authorize",
    objectType: "user",
    objectId: request.subject,
    policyVersion: CONSENT_POLICY_VERSION,
    metadata: {
      allowed,
      reason,
      resource: request.resource,
      purpose: request.purpose,
      recipientClass: request.recipient.kind,
      scope,
      scopeVersion: grant?.version ?? null,
      grantId: grant?.id ?? null,
    },
  };
}

function actorOf(recipient: Recipient): Pick<AuditRecord, "actorType" | "actorId"> {
  switch (recipient.kind) {
    case "person":
    case "relationship_peer":
      return { actorType: "user", actorId: recipient.userId };
    case "own_agent":
    case "counterpart_agent":
      return { actorType: "agent", actorId: recipient.actingFor };
    case "venue":
      return { actorType: "merchant", actorId: recipient.venueId };
    case "voice_provider":
    case "vision_provider":
    case "profile_extractor":
    case "matching_service":
      return { actorType: "system", actorId: null };
    default:
      return assertNever(recipient, "recipient");
  }
}
