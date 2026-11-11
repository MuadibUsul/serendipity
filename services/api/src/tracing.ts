// W3C Trace Context (https://www.w3.org/TR/trace-context/) for every request:
// a valid incoming `traceparent` is continued, anything else starts a new
// trace. The trace id reaches log lines, error responses and audit rows; the
// exporter that ships spans to a tracing backend comes with hosting
// (ser-p01-07, after ser-p01-02b).
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";

import type { FastifyInstance, FastifyRequest } from "fastify";

export interface TraceContext {
  /** 32 lowercase hex characters, shared by every span of the trace. */
  readonly traceId: string;
  /** 16 lowercase hex characters: this request's span. */
  readonly spanId: string;
  /** The caller's span, when the trace was continued. */
  readonly parentSpanId: string | undefined;
  readonly sampled: boolean;
}

export interface IncomingTrace {
  readonly traceId: string;
  readonly parentSpanId: string;
  readonly sampled: boolean;
}

const TRACEPARENT = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})(-.*)?$/;
const ZERO_TRACE = "0".repeat(32);
const ZERO_SPAN = "0".repeat(16);

/**
 * The trace a `traceparent` header continues, or undefined when the header is
 * missing or invalid (the spec says to ignore it then and start a new trace).
 */
export function parseTraceparent(
  header: string | readonly string[] | undefined,
): IncomingTrace | undefined {
  if (typeof header !== "string") return undefined; // missing, or sent twice
  const match = TRACEPARENT.exec(header.trim());
  if (match === null) return undefined;
  const [, version, traceId, parentSpanId, flags, rest] = match;
  if (
    version === undefined ||
    traceId === undefined ||
    parentSpanId === undefined ||
    flags === undefined
  ) {
    return undefined;
  }
  // Version ff is invalid; version 00 has exactly four fields, later versions may add more.
  if (version === "ff" || (version === "00" && rest !== undefined)) return undefined;
  if (traceId === ZERO_TRACE || parentSpanId === ZERO_SPAN) return undefined;
  return { traceId, parentSpanId, sampled: (parseInt(flags, 16) & 1) === 1 };
}

/** A new span: of the incoming trace when there is one, of a fresh trace otherwise. */
export function startSpan(incoming: IncomingTrace | undefined): TraceContext {
  return {
    traceId: incoming?.traceId ?? randomBytes(16).toString("hex"),
    spanId: randomBytes(8).toString("hex"),
    parentSpanId: incoming?.parentSpanId,
    sampled: incoming?.sampled ?? false,
  };
}

/** The `traceparent` to send on a call this span makes. */
export function formatTraceparent(trace: TraceContext): string {
  return `00-${trace.traceId}-${trace.spanId}-${trace.sampled ? "01" : "00"}`;
}

const storage = new AsyncLocalStorage<TraceContext>();
const traces = new WeakMap<FastifyRequest, TraceContext>();

/** The trace of the code running now: the current request's, or undefined outside one. */
export function currentTrace(): TraceContext | undefined {
  return storage.getStore();
}

/** Runs `work` inside `trace` (jobs and tests; requests get theirs from `installTracing`). */
export function runInTrace<T>(trace: TraceContext, work: () => T): T {
  return storage.run(trace, work);
}

/** The trace of `request`, wherever the code runs (response hooks run outside the request's context). */
export function traceOf(request: FastifyRequest): TraceContext | undefined {
  return traces.get(request);
}

/**
 * Gives every request its span, an `x-trace-id` response header, and an async
 * context in which `currentTrace()` answers: from the first hook through the
 * handler. Fastify carries that context across body parsing (raw Node would
 * not); a test on a real socket keeps that true across upgrades.
 */
export function installTracing(fastify: FastifyInstance): void {
  fastify.addHook("onRequest", (request, reply, done) => {
    const trace = startSpan(parseTraceparent(request.headers["traceparent"]));
    void reply.header("x-trace-id", trace.traceId);
    traces.set(request, trace);
    storage.run(trace, done);
  });
}
