import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import {
  currentTrace,
  formatTraceparent,
  installTracing,
  parseTraceparent,
  runInTrace,
  startSpan,
  traceOf,
} from "./tracing.js";

const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const PARENT = "00f067aa0ba902b7";
const VALID = `00-${TRACE_ID}-${PARENT}-01`;

describe("parseTraceparent", () => {
  it("reads a valid header", () => {
    expect(parseTraceparent(VALID)).toEqual({
      traceId: TRACE_ID,
      parentSpanId: PARENT,
      sampled: true,
    });
    expect(parseTraceparent(`00-${TRACE_ID}-${PARENT}-00`)?.sampled).toBe(false);
  });

  it("accepts a later version with extra fields", () => {
    expect(parseTraceparent(`01-${TRACE_ID}-${PARENT}-01-future`)?.traceId).toBe(TRACE_ID);
  });

  it.each([
    ["missing", undefined],
    ["sent twice", [VALID, VALID]],
    ["upper-case hex", VALID.toUpperCase()],
    ["an all-zero trace id", `00-${"0".repeat(32)}-${PARENT}-01`],
    ["an all-zero parent", `00-${TRACE_ID}-${"0".repeat(16)}-01`],
    ["version ff", `ff-${TRACE_ID}-${PARENT}-01`],
    ["version 00 with extra fields", `${VALID}-extra`],
    ["a short trace id", `00-${TRACE_ID.slice(1)}-${PARENT}-01`],
    ["not a traceparent", "alice@example.com"],
  ])("ignores a header that is %s", (_name, header) => {
    expect(parseTraceparent(header)).toBeUndefined();
  });
});

describe("startSpan", () => {
  it("continues an incoming trace with a new span", () => {
    const span = startSpan(parseTraceparent(VALID));
    expect(span).toMatchObject({ traceId: TRACE_ID, parentSpanId: PARENT, sampled: true });
    expect(span.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(span.spanId).not.toBe(PARENT);
    expect(formatTraceparent(span)).toBe(`00-${TRACE_ID}-${span.spanId}-01`);
  });

  it("starts a fresh trace otherwise", () => {
    const a = startSpan(undefined);
    const b = startSpan(undefined);
    expect(a.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(a.traceId).not.toBe(b.traceId);
    expect(a.parentSpanId).toBeUndefined();
    expect(formatTraceparent(a)).toMatch(/-00$/);
  });

  it("is what currentTrace answers inside runInTrace, and nothing outside", async () => {
    const span = startSpan(undefined);
    expect(currentTrace()).toBeUndefined();
    await runInTrace(span, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      expect(currentTrace()).toBe(span);
    });
    expect(currentTrace()).toBeUndefined();
  });
});

describe("installTracing", () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  async function start(): Promise<FastifyInstance> {
    const fastify = Fastify();
    installTracing(fastify);
    // The handler reads the trace after the body was parsed and after an await.
    fastify.post("/echo", async (request) => {
      await new Promise((resolve) => setTimeout(resolve, 2));
      return {
        current: currentTrace()?.traceId ?? null,
        ofRequest: traceOf(request)?.traceId ?? null,
      };
    });
    await fastify.ready();
    app = fastify;
    return fastify;
  }

  it("continues the caller's trace and returns its id", async () => {
    const fastify = await start();
    const response = await fastify.inject({
      method: "POST",
      url: "/echo",
      payload: { a: 1 },
      headers: { traceparent: VALID },
    });
    expect(response.headers["x-trace-id"]).toBe(TRACE_ID);
    expect(response.json()).toEqual({ current: TRACE_ID, ofRequest: TRACE_ID });
  });

  it("keeps the trace through body parsing on a real socket, one per concurrent request", async () => {
    const fastify = await start();
    const address = await fastify.listen({ port: 0, host: "127.0.0.1" });
    const responses = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        fetch(`${address}/echo`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ i, padding: "x".repeat(70_000) }),
        }),
      ),
    );
    const bodies = await Promise.all(
      responses.map(async (response) => ({
        header: response.headers.get("x-trace-id"),
        body: (await response.json()) as { current: string | null; ofRequest: string | null },
      })),
    );
    for (const { header, body } of bodies) {
      expect(header).toMatch(/^[0-9a-f]{32}$/);
      expect(body).toEqual({ current: header, ofRequest: header });
    }
    expect(new Set(bodies.map(({ header }) => header)).size).toBe(5);
  });
});
