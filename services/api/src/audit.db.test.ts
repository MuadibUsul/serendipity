// A request's trace id reaches the audit rows it writes, through a real HTTP
// request with a body, against the real schema.
import { migrate } from "@serendipity/db";
import { createLoginRole, createTestDatabase, urlFor } from "@serendipity/db/test-db";
import type { TestDatabase } from "@serendipity/db/test-db";
import Fastify from "fastify";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { auditedTransaction, consentAuditSink } from "./audit.js";
import { installTracing, runInTrace, startSpan } from "./tracing.js";

let db: TestDatabase;
let role: Awaited<ReturnType<typeof createLoginRole>>;
let pool: pg.Pool;

beforeAll(async () => {
  db = await createTestDatabase();
  await migrate(db.url, "up");
  role = await createLoginRole("serendipity_app");
  pool = new pg.Pool({ connectionString: urlFor(db.name, role) });
});

afterAll(async () => {
  await pool.end();
  await db.drop();
  await role.drop();
});

async function auditTraceIds(userId: string): Promise<(string | null)[]> {
  const { rows } = await pool.query<{ trace_id: string | null }>(
    `SELECT metadata_redacted->>'trace_id' AS trace_id FROM app.audit_events
     WHERE object_id = $1 ORDER BY at, id`,
    [userId],
  );
  return rows.map((row) => row.trace_id);
}

describe("audit rows carry the trace of the request that wrote them", () => {
  it("through an HTTP request with a body, on a real socket", async () => {
    const fastify = Fastify();
    installTracing(fastify);
    fastify.post<{ Body: { status: string } }>("/users", async (request) =>
      auditedTransaction(pool, async (tx) => {
        const { rows } = await tx.db.query<{ id: string }>(
          `INSERT INTO app.users (status) VALUES ($1) RETURNING id`,
          [request.body.status],
        );
        const id = rows[0]?.id ?? "";
        await tx.audit({
          actorType: "system",
          actorId: null,
          action: "identity.user.created",
          objectType: "user",
          objectId: id,
        });
        return { id };
      }),
    );
    const address = await fastify.listen({ port: 0, host: "127.0.0.1" });
    try {
      const response = await fetch(`${address}/users`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
        },
        body: JSON.stringify({ status: "active" }),
      });
      const { id } = (await response.json()) as { id: string };
      expect(response.headers.get("x-trace-id")).toBe("0af7651916cd43dd8448eb211c80319c");
      expect(await auditTraceIds(id)).toEqual(["0af7651916cd43dd8448eb211c80319c"]);
    } finally {
      await fastify.close();
    }
  });

  it("for consent decisions recorded during a traced job, and none outside a trace", async () => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO app.users (status) VALUES ('active') RETURNING id`,
    );
    const user = rows[0]?.id ?? "";
    const decision = {
      actorType: "system" as const,
      actorId: null,
      action: "consent.authorize" as const,
      objectType: "user" as const,
      objectId: user,
      policyVersion: 1,
      metadata: {
        allowed: false,
        reason: "no_grant" as const,
        resource: "profile_facts" as const,
        purpose: "matching" as const,
        recipientClass: "matching_service" as const,
        scope: null,
        scopeVersion: null,
        grantId: null,
      },
    };
    const span = startSpan(undefined);
    await runInTrace(span, () => consentAuditSink(pool).record(decision));
    await consentAuditSink(pool).record(decision);
    expect(await auditTraceIds(user)).toEqual([span.traceId, null]);
  });
});
