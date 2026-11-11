import type { AuditRecord, AuditSink, ConsentGrant, GrantSource } from "@serendipity/consent";

import { recordAudit } from "./audit.js";
import type { Queryable } from "./queryable.js";

interface GrantRow {
  id: string;
  user_id: string;
  scope: string;
  purpose: string;
  recipient_class: string;
  version: number;
  revoked_at: Date | null;
}

/**
 * Reads a person's grants from `app.consent_grants`, revoked ones included,
 * on every call: a revocation takes effect on the next decision.
 */
export function pgGrantSource(db: Queryable): GrantSource {
  return {
    async grantsFor(subject) {
      const { rows } = await db.query<GrantRow>(
        `SELECT id, user_id, scope, purpose, recipient_class, version, revoked_at
         FROM app.consent_grants WHERE user_id = $1`,
        [subject],
      );
      return rows.map((row): ConsentGrant => ({
        id: row.id,
        userId: row.user_id,
        scope: row.scope,
        purpose: row.purpose,
        recipientClass: row.recipient_class,
        version: row.version,
        revokedAt: row.revoked_at,
      }));
    },
  };
}

/** Writes each decision to the append-only `app.audit_events`. */
/**
 * Stores every consent decision in `app.audit_events` (redacted, see
 * `recordAudit`). `traceId` names the trace the decision ran in, so each
 * decision can be found from the request that asked for it.
 */
export function pgAuditSink(
  db: Queryable,
  options: { readonly traceId?: () => string | undefined } = {},
): AuditSink {
  return {
    async record(entry: AuditRecord) {
      await recordAudit(db, {
        actorType: entry.actorType,
        actorId: entry.actorId,
        action: entry.action,
        objectType: entry.objectType,
        objectId: entry.objectId,
        policyVersion: entry.policyVersion,
        traceId: options.traceId?.(),
        metadata: entry.metadata,
      });
    },
  };
}
