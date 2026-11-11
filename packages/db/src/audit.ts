// Writing app.audit_events (ARCH-001 §5, §10.2; PLAN-001 P01-07: key writes
// traceable). An audited write and its audit row are one transaction: both
// are stored or neither is. Metadata is redacted before it is stored, and the
// request's trace id goes with it, so one id finds the request's log lines
// and every audit row it wrote.
import { redactFields } from "@serendipity/redact";
import type pg from "pg";

import type { Queryable } from "./queryable.js";

export const ACTOR_TYPES = ["user", "merchant", "staff", "system", "agent"] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export interface AuditEvent {
  readonly actorType: ActorType;
  /** The acting user, merchant, staff member or agent; null for the system. */
  readonly actorId: string | null;
  /** What happened, as dotted lower-case words: `consent.grant.revoked`, `date.payment.captured`. */
  readonly action: string;
  readonly objectType: string;
  readonly objectId: string | null;
  /** The consent policy version the decision ran under, when one applies. */
  readonly policyVersion?: number | null;
  /** The request's W3C trace id (32 lowercase hex characters). */
  readonly traceId?: string | undefined;
  /** Facts about the event. Redacted before storage; never voice, photo, ID or secret content. */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

const ACTION = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/;
const OBJECT_TYPE = /^[a-z][a-z0-9_]*$/;
const TRACE_ID = /^[0-9a-f]{32}$/;

/**
 * Refuses an event the log could not be searched by: a malformed action,
 * object type or trace id is a bug in the caller, not something to store.
 */
function check(event: AuditEvent): void {
  if (!(ACTOR_TYPES as readonly string[]).includes(event.actorType)) {
    throw new TypeError(`audit: unknown actor type "${event.actorType}"`);
  }
  if (!ACTION.test(event.action)) {
    throw new TypeError(`audit: action must be dotted lower-case words, not "${event.action}"`);
  }
  if (!OBJECT_TYPE.test(event.objectType)) {
    throw new TypeError(`audit: object type must be a lower-case word, not "${event.objectType}"`);
  }
  if (event.traceId !== undefined && !TRACE_ID.test(event.traceId)) {
    throw new TypeError("audit: trace id must be 32 lowercase hex characters");
  }
}

/**
 * Appends one audit row through `db` and returns its id. Inside a
 * transaction, the row commits or rolls back with it. The trace id is kept in
 * `metadata_redacted.trace_id`.
 */
export async function recordAudit(db: Queryable, event: AuditEvent): Promise<string> {
  check(event);
  const metadata = redactFields({
    ...event.metadata,
    ...(event.traceId === undefined ? {} : { trace_id: event.traceId }),
  });
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO app.audit_events
       (actor_type, actor_id, action, object_type, object_id, policy_version, metadata_redacted)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      event.actorType,
      event.actorId,
      event.action,
      event.objectType,
      event.objectId,
      event.policyVersion ?? null,
      JSON.stringify(metadata),
    ],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error("audit: the insert returned no row");
  return id;
}

export interface AuditedTransaction {
  /** The transaction's connection: every write made through it commits with the audit rows. */
  readonly db: Queryable;
  /** Records `event` in the same transaction; the trace id defaults to the transaction's. */
  audit(event: AuditEvent): Promise<void>;
}

export interface TransactionPool {
  connect(): Promise<pg.PoolClient>;
}

/**
 * Runs `work` in one transaction that must record at least one audit event:
 * the writes and their audit rows commit together, or nothing does. Throwing
 * from `work`, a failed audit insert, or forgetting to audit all roll back.
 */
export async function inAuditedTransaction<T>(
  pool: TransactionPool,
  work: (tx: AuditedTransaction) => Promise<T>,
  context: { readonly traceId?: string | undefined } = {},
): Promise<T> {
  const client = await pool.connect();
  let audited = 0;
  try {
    await client.query("BEGIN");
    const result = await work({
      db: client,
      audit: async (event) => {
        await recordAudit(client, { traceId: context.traceId, ...event });
        audited += 1;
      },
    });
    if (audited === 0) {
      throw new Error("an audited transaction recorded no audit event; nothing was written");
    }
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
