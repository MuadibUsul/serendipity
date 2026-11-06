import type { Environment } from "@serendipity/config";
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";

/**
 * The route label of a request that matched no route. Never the raw path: a
 * client can send any path, which would grow the metric without bound and
 * could carry personal data.
 */
export const UNMATCHED_ROUTE = "unmatched";

const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);

export interface ObservedRequest {
  readonly method: string;
  /** The route template, e.g. `/v1/dates/:id`; undefined when no route matched. */
  readonly route: string | undefined;
  readonly status: number;
  readonly seconds: number;
}

export interface Metrics {
  /** The Prometheus text exposition content type. */
  readonly contentType: string;
  render(): Promise<string>;
  observeRequest(request: ObservedRequest): void;
}

/** A registry of its own per service instance: Node.js process metrics plus HTTP request metrics. */
export function createMetrics(env: Environment): Metrics {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });

  const labelNames = ["method", "route", "status"] as const;
  const requests = new Counter({
    name: "serendipity_http_requests_total",
    help: "HTTP requests by method, route template and status code.",
    labelNames,
    registers: [registry],
  });
  const duration = new Histogram({
    name: "serendipity_http_request_duration_seconds",
    help: "HTTP request duration by method, route template and status code.",
    labelNames,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registry],
  });
  new Gauge({
    name: "serendipity_api_info",
    help: "Always 1; the labels describe the running service.",
    labelNames: ["env"] as const,
    registers: [registry],
  }).set({ env }, 1);

  return {
    contentType: registry.contentType,
    render: () => registry.metrics(),
    observeRequest({ method, route, status, seconds }) {
      const labels = {
        method: METHODS.has(method) ? method : "OTHER",
        route: route ?? UNMATCHED_ROUTE,
        status: String(status),
      };
      requests.inc(labels);
      duration.observe(labels, seconds);
    },
  };
}
