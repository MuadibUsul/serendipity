import { Controller, Get, Header, Inject, Res } from "@nestjs/common";
import type { FastifyReply } from "fastify";

import type { Lifecycle } from "./lifecycle.js";
import type { Logger } from "./logging.js";
import type { Metrics } from "./metrics.js";
import { NOT_CHECKED, isReady } from "./readiness.js";
import type { Readiness, ReadinessChecks } from "./readiness.js";
import { LIFECYCLE, LOGGER, METRICS, READINESS } from "./tokens.js";

export interface ReadinessBody {
  readonly status: "ready" | "not_ready";
  readonly checks: ReadinessChecks & { readonly process: "running" | "draining" };
  readonly migrations: { readonly pending: number; readonly newer: number };
}

/** The probes a platform needs to run the service (PLAN-001 P01-02, ser-p01-09). */
@Controller()
export class HealthController {
  #lastReady: boolean | undefined;

  constructor(
    @Inject(READINESS) private readonly readiness: Readiness,
    @Inject(METRICS) private readonly metrics: Metrics,
    @Inject(LIFECYCLE) private readonly lifecycle: Lifecycle,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  /**
   * Liveness: the process is up and answering HTTP. It never touches the
   * database, so a database outage makes the service unready, not restarted.
   */
  @Get("healthz")
  @Header("cache-control", "no-store")
  healthz(): { status: "ok" } {
    return { status: "ok" };
  }

  /**
   * Readiness: 200 when the database answers and has every migration this
   * build expects; 503, naming the failing check, otherwise and while the
   * process drains for shutdown.
   */
  @Get("readyz")
  @Header("cache-control", "no-store")
  async readyz(@Res({ passthrough: true }) reply: FastifyReply): Promise<ReadinessBody> {
    const draining = this.lifecycle.draining;
    const result = draining ? NOT_CHECKED : await this.readiness.check();
    const ready = !draining && isReady(result);
    const body: ReadinessBody = {
      status: ready ? "ready" : "not_ready",
      checks: { process: draining ? "draining" : "running", ...result.checks },
      migrations: { pending: result.pendingMigrations, newer: result.newerMigrations },
    };
    if (ready !== this.#lastReady) {
      this.#lastReady = ready;
      if (ready) this.logger.info({ checks: body.checks }, "ready");
      else this.logger.warn({ checks: body.checks }, "not ready");
    }
    void reply.status(ready ? 200 : 503);
    return body;
  }

  /** Prometheus text exposition. Not for the public internet: the platform keeps it internal. */
  @Get("metrics")
  @Header("cache-control", "no-store")
  async metricsText(@Res({ passthrough: true }) reply: FastifyReply): Promise<string> {
    void reply.header("content-type", this.metrics.contentType);
    return this.metrics.render();
  }
}
