// Nest's decorators store metadata through Reflect: load the polyfill first.
import "reflect-metadata";

import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";

import { NestFactory } from "@nestjs/core";
import { FastifyAdapter } from "@nestjs/platform-fastify";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import type { Environment } from "@serendipity/config";
import { redactText } from "@serendipity/redact";

import { AppModule } from "./app.module.js";
import { SafeExceptionFilter } from "./exception.filter.js";
import { Lifecycle } from "./lifecycle.js";
import { NestLogger, revealsErrorMessages } from "./logging.js";
import type { Logger } from "./logging.js";
import { UNMATCHED_ROUTE, createMetrics } from "./metrics.js";
import type { Metrics } from "./metrics.js";
import { isReady } from "./readiness.js";
import type { Readiness } from "./readiness.js";
import { installTracing, traceOf } from "./tracing.js";

/** Routes a platform polls every few seconds: logged at debug, not info. */
const PROBE_ROUTES = new Set(["/healthz", "/readyz", "/metrics"]);

/**
 * A caller's request id is kept only if it is a plain token that redaction
 * would leave alone (no phone number smuggled in); anything else gets a
 * fresh one.
 */
const REQUEST_ID = /^[A-Za-z0-9._-]{8,128}$/;

export function requestIdFor(request: IncomingMessage): string {
  const header = request.headers["x-request-id"];
  return typeof header === "string" && REQUEST_ID.test(header) && redactText(header) === header
    ? header
    : randomUUID();
}

export interface ApiOptions {
  readonly env: Environment;
  readonly logger: Logger;
  readonly readiness: Readiness;
}

export interface Api {
  readonly app: NestFastifyApplication;
  readonly lifecycle: Lifecycle;
  readonly metrics: Metrics;
}

/** Builds the service, initialised but not listening (tests call `app.inject`-style). */
export async function createApi({ env, logger, readiness }: ApiOptions): Promise<Api> {
  const lifecycle = new Lifecycle();
  const metrics = createMetrics(
    env,
    async () => !lifecycle.draining && isReady(await readiness.check()),
  );
  // Fastify's own logger stays off: the hooks below log each request safely.
  const adapter = new FastifyAdapter({ logger: false, genReqId: requestIdFor });

  const fastify = adapter.getInstance();
  installTracing(fastify);
  fastify.addHook("onRequest", (request, reply, done) => {
    void reply.header("x-request-id", request.id);
    done();
  });
  // One line and one observation per request, by route template only: no
  // URL, query, headers, address or body (ADR-0005). It runs after the
  // response, outside the request's async context, so it names the trace.
  fastify.addHook("onResponse", (request, reply, done) => {
    const route = request.routeOptions.url;
    metrics.observeRequest({
      method: request.method,
      route,
      status: reply.statusCode,
      seconds: reply.elapsedTime / 1000,
    });
    const trace = traceOf(request);
    const entry = {
      req_id: request.id,
      ...(trace === undefined ? {} : { trace_id: trace.traceId, span_id: trace.spanId }),
      method: request.method,
      route: route ?? UNMATCHED_ROUTE,
      status: reply.statusCode,
      duration_ms: Math.round(reply.elapsedTime * 10) / 10,
    };
    if (route !== undefined && PROBE_ROUTES.has(route)) logger.debug(entry, "request");
    else logger.info(entry, "request");
    done();
  });

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.with({ readiness, metrics, lifecycle, logger }),
    adapter,
    { logger: new NestLogger(logger), abortOnError: false },
  );
  app.useGlobalFilters(new SafeExceptionFilter(logger, metrics, revealsErrorMessages(env)));
  await app.init();
  return { app, lifecycle, metrics };
}
