/**
 * Sign-in against the real API (ser-p01-10): `POST /v1/auth/code` and
 * `POST /v1/auth/session`. Only the two sign-in calls go over the network for
 * now; the rest of the app still plays the mock until its endpoints exist.
 * Every failure is mapped to a problem the sign-in screen knows how to say.
 */
import type { Session } from "../shell/state";

import type { Api, CodeResult, SignInProblem, SignInResult } from "./types";

type Fetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{
  readonly status: number;
  json(): Promise<unknown>;
}>;

async function post(fetchImpl: Fetch, url: string, body: Record<string, string>) {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
  });
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  const record = typeof json === "object" && json !== null ? (json as Record<string, unknown>) : {};
  return { status: response.status, json: record };
}

function problemOf(status: number, code: unknown): SignInProblem {
  if (status === 429) return "rate_limited";
  if (status === 400) return code === "invalid_code" ? "invalid_code" : "invalid_phone";
  return "unavailable";
}

const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;

export function createHttpAuth(
  baseUrl: string,
  fetchImpl: Fetch = fetch,
): Pick<Api, "requestCode" | "signIn"> {
  const root = baseUrl.replace(/\/+$/, "");
  return {
    async requestCode(phone): Promise<CodeResult> {
      const { status, json } = await post(fetchImpl, `${root}/v1/auth/code`, { phone });
      return status === 202
        ? { ok: true }
        : { ok: false, problem: problemOf(status, json["code"]) };
    },
    async signIn(phone, code): Promise<SignInResult> {
      const { status, json } = await post(fetchImpl, `${root}/v1/auth/session`, { phone, code });
      if (status !== 200) return { ok: false, problem: problemOf(status, json["code"]) };
      const { user_id, access_token, refresh_token } = json;
      if (!isText(user_id) || !isText(access_token) || !isText(refresh_token)) {
        return { ok: false, problem: "unavailable" };
      }
      const session: Session = {
        userId: user_id,
        tokens: { accessToken: access_token, refreshToken: refresh_token },
      };
      return { ok: true, session };
    },
  };
}
