import { Module } from "@nestjs/common";
import type { DynamicModule } from "@nestjs/common";

import type { AuthService } from "@serendipity/auth";
import type { FeedbackRepository, InvitationRepository } from "@serendipity/db";

import { AuthController } from "./auth.controller.js";
import { FeedbackController } from "./feedback.controller.js";
import type { Callers } from "./callers.js";
import { HealthController } from "./health.controller.js";
import { InvitationsController } from "./invitations.controller.js";
import type { Lifecycle } from "./lifecycle.js";
import type { Logger } from "./logging.js";
import type { Metrics } from "./metrics.js";
import type { Readiness } from "./readiness.js";
import {
  AUTH,
  CALLERS,
  CLOCK,
  FEEDBACK,
  INVITATIONS,
  LIFECYCLE,
  LOGGER,
  METRICS,
  READINESS,
} from "./tokens.js";

/** The invitation endpoints and what they need (ser-p04-02). */
export interface InvitationsDeps {
  readonly repository: InvitationRepository;
  /** Left out, the feedback endpoints are not served (ser-p05-01). */
  readonly feedback?: FeedbackRepository;
  readonly callers: Callers;
  readonly clock?: () => Date;
}

export interface AppModuleDeps {
  readonly readiness: Readiness;
  readonly metrics: Metrics;
  readonly lifecycle: Lifecycle;
  readonly logger: Logger;
  /** Left out, the invitation endpoints are not served (the probes-only tests). */
  readonly invitations?: InvitationsDeps;
  /**
   * Sign-in (ser-p01-10). Left out, the endpoints are not served; `null`, they
   * answer 503 (a deployed environment with no SMS provider yet).
   */
  readonly auth?: AuthService | null;
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
      controllers: [
        HealthController,
        ...(deps.invitations === undefined ? [] : [InvitationsController]),
        ...(deps.invitations?.feedback === undefined ? [] : [FeedbackController]),
        ...(deps.auth === undefined ? [] : [AuthController]),
      ],
      providers: [
        { provide: READINESS, useValue: deps.readiness },
        { provide: METRICS, useValue: deps.metrics },
        { provide: LIFECYCLE, useValue: deps.lifecycle },
        { provide: LOGGER, useValue: deps.logger },
        ...(deps.auth === undefined ? [] : [{ provide: AUTH, useValue: deps.auth }]),
        ...(deps.invitations === undefined
          ? []
          : [
              { provide: INVITATIONS, useValue: deps.invitations.repository },
              { provide: CALLERS, useValue: deps.invitations.callers },
              { provide: CLOCK, useValue: deps.invitations.clock ?? (() => new Date()) },
              ...(deps.invitations.feedback === undefined
                ? []
                : [{ provide: FEEDBACK, useValue: deps.invitations.feedback }]),
            ]),
      ],
    };
  }
}
