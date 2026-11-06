import { decide, denial } from "./decide.js";
import type { AccessRequest, AuditRecord, ConsentGrant, Decision } from "./decide.js";

/** Reads a person's grants, revoked ones included. Called on every decision; never cache it. */
export interface GrantSource {
  grantsFor(subject: string): Promise<readonly ConsentGrant[]>;
}

/** Persists one audit entry per decision (`app.audit_events`). */
export interface AuditSink {
  record(entry: AuditRecord): Promise<void>;
}

export interface Authorizer {
  authorize(request: AccessRequest): Promise<Decision>;
}

/**
 * The entry point every sensitive data path calls first (ARCH-001 §4:
 * `authorize(subject, purpose, recipient)`).
 *
 * Grants are read fresh on every call, so a revocation stops the very next
 * call. Every decision is audited. It fails closed: if the grants cannot be
 * read the request is denied, and if the decision cannot be audited it is
 * denied too.
 */
export function createAuthorizer(deps: { grants: GrantSource; audit: AuditSink }): Authorizer {
  return {
    async authorize(request) {
      let decision: Decision;
      try {
        decision = decide(request, await deps.grants.grantsFor(request.subject));
      } catch {
        decision = denial(request, "grant_source_unavailable");
      }
      try {
        await deps.audit.record(decision.audit);
      } catch {
        return denial(request, "audit_unavailable");
      }
      return decision;
    },
  };
}
