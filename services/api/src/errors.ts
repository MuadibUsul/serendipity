// The errors an API response may report, each with a stable code clients can
// branch on. Responses are RFC 9457 problem details and carry the trace id,
// so a person reporting a failure can quote one id that finds every log line
// and audit row of the request. Internal messages never reach a response.

export const PROBLEMS = {
  invalid_request: { status: 400, title: "Invalid request" },
  unauthenticated: { status: 401, title: "Authentication required" },
  forbidden: { status: 403, title: "Not allowed" },
  not_found: { status: 404, title: "Not found" },
  method_not_allowed: { status: 405, title: "Method not allowed" },
  conflict: { status: 409, title: "Conflict" },
  payload_too_large: { status: 413, title: "Payload too large" },
  unsupported_media_type: { status: 415, title: "Unsupported media type" },
  rate_limited: { status: 429, title: "Too many requests" },
  internal: { status: 500, title: "Internal error" },
  unavailable: { status: 503, title: "Temporarily unavailable" },
} as const;

export type ProblemCode = keyof typeof PROBLEMS;

export const PROBLEM_CONTENT_TYPE = "application/problem+json";

/**
 * An error that is part of the API's contract: thrown by domain code to
 * answer with `code`. `detail`, if given, is shown to the client, so it must
 * be written for them and never quote data or internals.
 */
export class ApiError extends Error {
  override readonly name = "ApiError";

  constructor(
    readonly code: ProblemCode,
    readonly detail?: string,
    options?: ErrorOptions,
  ) {
    super(detail ?? PROBLEMS[code].title, options);
  }

  get status(): number {
    return PROBLEMS[this.code].status;
  }
}

export interface Problem {
  readonly type: "about:blank";
  readonly title: string;
  readonly status: number;
  readonly code: ProblemCode;
  readonly detail?: string;
  readonly trace_id?: string;
}

const BY_STATUS = new Map<number, ProblemCode>(
  Object.entries(PROBLEMS).map(([code, { status }]) => [status, code as ProblemCode]),
);

/** The code for an HTTP status raised outside our own errors (routing, body limits, Nest built-ins). */
export function codeForStatus(status: number): ProblemCode {
  return BY_STATUS.get(status) ?? (status >= 500 ? "internal" : "invalid_request");
}

export function problem(code: ProblemCode, traceId: string | undefined, detail?: string): Problem {
  const { status, title } = PROBLEMS[code];
  return {
    type: "about:blank",
    title,
    status,
    code,
    ...(detail === undefined ? {} : { detail }),
    ...(traceId === undefined ? {} : { trace_id: traceId }),
  };
}
