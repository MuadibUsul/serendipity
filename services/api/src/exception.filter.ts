import { Catch, HttpException } from "@nestjs/common";
import type { ArgumentsHost, ExceptionFilter } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";

import { ApiError, PROBLEM_CONTENT_TYPE, codeForStatus, problem } from "./errors.js";
import type { ProblemCode } from "./errors.js";
import { safeError } from "./logging.js";
import type { Logger } from "./logging.js";
import { UNMATCHED_ROUTE } from "./metrics.js";
import type { Metrics } from "./metrics.js";
import { traceOf } from "./tracing.js";

/**
 * Every exception a request raises ends here and answers as problem+json with
 * a stable code and the trace id (ADR-0006).
 *
 * - `ApiError`: its code, and its client-facing detail if any.
 * - Nest's HTTP exceptions (routing, built-in pipes): the code for their
 *   status; their message is not passed on.
 * - Anything else is a bug: a bare 500, counted, and logged by type and code,
 *   with its message only where `withMessages` (dev, test), because messages
 *   can quote personal data.
 */
@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly logger: Logger,
    private readonly metrics: Metrics,
    private readonly withMessages: boolean,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const reply = http.getResponse<FastifyReply>();
    const request = http.getRequest<FastifyRequest>();
    const traceId = traceOf(request)?.traceId;
    const route = request.routeOptions.url ?? UNMATCHED_ROUTE;

    let code: ProblemCode;
    let detail: string | undefined;
    if (exception instanceof ApiError) {
      code = exception.code;
      detail = exception.detail;
      if (exception.status >= 500) {
        this.logger.warn(
          { route, code, err: safeError(exception.cause, this.withMessages) },
          "request failed",
        );
      }
    } else if (exception instanceof HttpException) {
      code = codeForStatus(exception.getStatus());
    } else {
      code = "internal";
      this.metrics.observeUnhandledError();
      this.logger.error({ route, err: safeError(exception, this.withMessages) }, "unhandled error");
    }

    const body = problem(code, traceId, detail);
    void reply.status(body.status).header("content-type", PROBLEM_CONTENT_TYPE).send(body);
  }
}
