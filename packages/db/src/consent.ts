import type { AuditRecord, AuditSink, ConsentGrant, GrantSource } from "@serendipity/consent";

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
export function pgAuditSink(db: Queryable): AuditSink {
  return {
    async record(entry: AuditRecord) {
      await db.query(
        `INSERT INTO app.audit_events
           (actor_type, actor_id, action, object_type, object_id, policy_version, metadata_redacted)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          entry.actorType,
          entry.actorId,
          entry.action,
          entry.objectType,
          entry.objectId,
          entry.policyVersion,
          JSON.stringify(entry.metadata),
        ],
      );
    },
  };
}
