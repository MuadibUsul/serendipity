import { Catch, HttpException } from "@nestjs/common";
import type { ArgumentsHost, ExceptionFilter } from "@nestjs/common";
import type { FastifyReply, FastifyRequest } from "fastify";

import { safeError } from "./logging.js";
import type { Logger } from "./logging.js";
import { UNMATCHED_ROUTE } from "./metrics.js";

/**
 * Every exception a request raises ends here. HTTP exceptions answer as Nest
 * would; anything else answers a bare 500 and is logged by type and code,
 * with its message only where `withMessages` (dev, test): messages can quote
 * personal data, and the client never sees them.
 */
@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly logger: Logger,
    private readonly withMessages: boolean,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const reply = http.getResponse<FastifyReply>();
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      void reply
        .status(status)
        .send(typeof response === "string" ? { statusCode: status, message: response } : response);
      return;
    }
    const request = http.getRequest<FastifyRequest>();
    this.logger.error(
      {
        req_id: request.id,
        route: request.routeOptions.url ?? UNMATCHED_ROUTE,
        err: safeError(exception, this.withMessages),
      },
      "unhandled error",
    );
    void reply.status(500).send({ statusCode: 500, message: "Internal Server Error" });
  }
}
