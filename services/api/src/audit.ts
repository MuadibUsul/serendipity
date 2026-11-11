// Audit entry points for API code: the same writers as @serendipity/db, with
// the current request's trace id filled in, so every audit row a request
// writes can be found from its x-trace-id (ADR-0006).
import type { AuditSink } from "@serendipity/consent";
import type { Queryable } from "@serendipity/db";
// Subpaths, not the package root: the root also exports the migration runner,
// which the image does not ship (ADR-0005).
import { inAuditedTransaction } from "@serendipity/db/audit";
import type { AuditedTransaction, TransactionPool } from "@serendipity/db/audit";
import { pgAuditSink } from "@serendipity/db/consent";

import { currentTrace } from "./tracing.js";

/**
 * Every key write (consent, profile approval, date transitions, payments,
 * refunds, safety decisions, staff access to personal data) goes through
 * here: the write and its audit row commit together or not at all.
 */
export function auditedTransaction<T>(
  pool: TransactionPool,
  work: (tx: AuditedTransaction) => Promise<T>,
): Promise<T> {
  return inAuditedTransaction(pool, work, { traceId: currentTrace()?.traceId });
}

/** The consent engine's audit sink, recording each decision under the request that asked for it. */
export function consentAuditSink(db: Queryable): AuditSink {
  return pgAuditSink(db, { traceId: () => currentTrace()?.traceId });
}
