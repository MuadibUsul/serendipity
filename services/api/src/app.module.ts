import { Module } from "@nestjs/common";
import type { DynamicModule } from "@nestjs/common";

import { HealthController } from "./health.controller.js";
import type { Lifecycle } from "./lifecycle.js";
import type { Logger } from "./logging.js";
import type { Metrics } from "./metrics.js";
import type { Readiness } from "./readiness.js";
import { LIFECYCLE, LOGGER, METRICS, READINESS } from "./tokens.js";

export interface AppModuleDeps {
  readonly readiness: Readiness;
  readonly metrics: Metrics;
  readonly lifecycle: Lifecycle;
  readonly logger: Logger;
}

/**
 * The root of the modular monolith (ARCH-001 §4). Business modules (identity,
 * consent, profile, dates, payments, …) are imported here as their tasks land;
 * for now it holds the operational probes.
 */
@Module({})
export class AppModule {
  static with(deps: AppModuleDeps): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController],
      providers: [
        { provide: READINESS, useValue: deps.readiness },
        { provide: METRICS, useValue: deps.metrics },
        { provide: LIFECYCLE, useValue: deps.lifecycle },
        { provide: LOGGER, useValue: deps.logger },
      ],
    };
  }
}
