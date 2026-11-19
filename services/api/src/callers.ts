// Who is calling: the person behind a session's access token
// (`Authorization: Bearer sa_…`, ser-p01-10). Dev and test may also name the
// caller in a header, for tools and tests; no deployed environment ever
// trusts that header.
import type { IncomingHttpHeaders } from "node:http";

import type { AuthService } from "@serendipity/auth";
import type { Environment } from "@serendipity/config";

export interface Callers {
  /** The calling person's user id, or `null` when the request is not signed in. */
  callerOf(headers: IncomingHttpHeaders): Promise<string | null>;
}

/** The header dev and test use to say who is calling. */
export const DEV_CALLER_HEADER = "x-dev-user-id";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/**
 * Dev and test: the caller is whoever `x-dev-user-id` names. Staging and
 * prod: nobody, ever.
 */
export function devHeaderCallers(env: Environment): Callers {
  const trusted = env === "dev" || env === "test";
  return {
    callerOf(headers) {
      if (!trusted) return Promise.resolve(null);
      const value = headers[DEV_CALLER_HEADER];
      return Promise.resolve(typeof value === "string" && isUuid(value) ? value : null);
    },
  };
}

/** The token in `Authorization: Bearer <token>`, or `null`. */
export function bearerOf(headers: IncomingHttpHeaders): string | null {
  const value = headers.authorization;
  if (typeof value !== "string") return null;
  const match = /^Bearer ([A-Za-z0-9_-]{1,200})$/.exec(value);
  return match?.[1] ?? null;
}

/**
 * The caller is whoever the access token belongs to. A request with a token
 * is decided by the token alone, even in dev; one without falls back to the
 * dev header in dev and test only.
 */
export function sessionCallers(env: Environment, auth: AuthService | null): Callers {
  const dev = devHeaderCallers(env);
  return {
    async callerOf(headers) {
      const token = bearerOf(headers);
      if (token !== null) return auth === null ? null : auth.callerFor(token);
      return dev.callerOf(headers);
    },
  };
}
