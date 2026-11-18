// Who is calling. Real sign-in (sessions and tokens) is not built yet; until
// it is, dev and test name the caller in a header, and every deployed
// environment refuses every request that needs a caller. Nothing here can
// let a request act as someone in staging or prod.
import type { IncomingHttpHeaders } from "node:http";

import type { Environment } from "@serendipity/config";

export interface Callers {
  /** The calling person's user id, or `null` when the request is not signed in. */
  callerOf(headers: IncomingHttpHeaders): string | null;
}

/** The header dev and test use to say who is calling. */
export const DEV_CALLER_HEADER = "x-dev-user-id";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/**
 * Dev and test: the caller is whoever `x-dev-user-id` names. Staging and
 * prod: nobody, ever (401), until real sign-in replaces this.
 */
export function devHeaderCallers(env: Environment): Callers {
  const trusted = env === "dev" || env === "test";
  return {
    callerOf(headers) {
      if (!trusted) return null;
      const value = headers[DEV_CALLER_HEADER];
      return typeof value === "string" && isUuid(value) ? value : null;
    },
  };
}
