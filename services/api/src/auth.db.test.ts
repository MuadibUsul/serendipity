// Sign-in end to end: HTTP → AuthController → @serendipity/auth →
// pgAuthRepository → PostgreSQL as serendipity_app, then the token used on a
// real endpoint (the invitations) through sessionCallers.
import {
  MIN_SECRET_BYTES,
  createAuthService,
  createFakeSms,
  createHasher,
} from "@serendipity/auth";
import type { FakeSms } from "@serendipity/auth";
import { migrate, pgInvitationRepository } from "@serendipity/db";
import { pgAuthRepository } from "@serendipity/db/auth";
import { createLoginRole, createTestDatabase, urlFor } from "@serendipity/db/test-db";
import type { TestDatabase } from "@serendipity/db/test-db";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Api } from "./app.js";
import { DEV_CALLER_HEADER, sessionCallers } from "./callers.js";
import { READY, fixedReadiness, testApi } from "./test-support.js";
import type { captureLogs } from "./test-support.js";

let db: TestDatabase;
let role: Awaited<ReturnType<typeof createLoginRole>>;
let pool: pg.Pool;
let api: Api & ReturnType<typeof captureLogs>;
let sms: FakeSms;
let clock = new Date("2026-11-19T04:00:00Z").getTime();
let phones = 0;

const nextPhone = () => {
  phones += 1;
  return `137${String(phones).padStart(8, "0")}`;
};

beforeAll(async () => {
  db = await createTestDatabase();
  await migrate(db.url, "up");
  role = await createLoginRole("serendipity_app");
  pool = new pg.Pool({ connectionString: urlFor(db.name, role) });
  sms = createFakeSms();
  const auth = createAuthService({
    repository: pgAuthRepository(pool),
    sms,
    hasher: createHasher("h".repeat(MIN_SECRET_BYTES)),
    clock: () => new Date(clock),
  });
  api = await testApi(
    fixedReadiness(READY),
    "test",
    { repository: pgInvitationRepository(pool), callers: sessionCallers("test", auth) },
    auth,
  );
});

afterAll(async () => {
  await api.app.close();
  await pool.end();
  await db.drop();
  await role.drop();
});

async function post(url: string, payload?: unknown, headers: Record<string, string> = {}) {
  const response = await api.app.inject({
    method: "POST",
    url,
    headers,
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
  return {
    status: response.statusCode,
    headers: response.headers,
    json: () => response.json<Record<string, unknown>>(),
    body: response.body,
  };
}

const upcoming = async (headers: Record<string, string>) =>
  (await api.app.inject({ method: "GET", url: "/v1/dates/upcoming", headers })).statusCode;

async function signIn(phone: string) {
  expect((await post("/v1/auth/code", { phone })).status).toBe(202);
  const code = sms.lastCodeFor(`+86${phone}`);
  const response = await post("/v1/auth/session", { phone, code });
  expect(response.status).toBe(200);
  return response.json() as {
    user_id: string;
    new_account: boolean;
    access_token: string;
    refresh_token: string;
  };
}

describe("signing in over HTTP", () => {
  it("signs in, reaches a protected endpoint with the token, and finds the same account next time", async () => {
    const phone = nextPhone();
    const first = await signIn(phone);
    expect(first).toMatchObject({ new_account: true });
    expect(await upcoming({ authorization: `Bearer ${first.access_token}` })).toBe(200);
    clock += 61_000;
    const second = await signIn(phone);
    expect(second).toMatchObject({ user_id: first.user_id, new_account: false });
  });

  it("refreshes, then logs out", async () => {
    clock += 3_600_000;
    const session = await signIn(nextPhone());
    const refreshed = await post("/v1/auth/refresh", { refresh_token: session.refresh_token });
    expect(refreshed.status).toBe(200);
    const pair = refreshed.json() as { access_token: string; refresh_token: string };
    expect(await upcoming({ authorization: `Bearer ${session.access_token}` })).toBe(401);
    expect(await upcoming({ authorization: `Bearer ${pair.access_token}` })).toBe(200);
    expect(
      (await post("/v1/auth/logout", undefined, { authorization: `Bearer ${pair.access_token}` }))
        .status,
    ).toBe(204);
    expect(await upcoming({ authorization: `Bearer ${pair.access_token}` })).toBe(401);
    expect((await post("/v1/auth/refresh", { refresh_token: pair.refresh_token })).status).toBe(
      401,
    );
  });

  it("marks every response no-store and never echoes a number or a code", async () => {
    const phone = nextPhone();
    const code = await post("/v1/auth/code", { phone });
    expect(code.headers["cache-control"]).toBe("no-store");
    const wrong = await post("/v1/auth/session", { phone, code: "000001" });
    expect(wrong.headers["cache-control"]).toBe("no-store");
    expect(wrong.body).not.toContain(phone);
    const logged = api.text();
    expect(logged).not.toContain(phone);
    expect(logged).not.toContain(sms.lastCodeFor(`+86${phone}`) ?? "never");
  });
});

describe("refusals", () => {
  it("refuses a malformed number or body with 400", async () => {
    expect((await post("/v1/auth/code", { phone: "12345" })).json()).toMatchObject({
      status: 400,
      code: "invalid_request",
    });
    expect((await post("/v1/auth/code", {})).status).toBe(400);
    expect((await post("/v1/auth/code", { phone: 13800000000 })).status).toBe(400);
  });

  it("answers a wrong code with invalid_code, the same as no code at all", async () => {
    const neverAsked = await post("/v1/auth/session", { phone: nextPhone(), code: "123456" });
    const phone = nextPhone();
    await post("/v1/auth/code", { phone });
    const wrong = await post("/v1/auth/session", { phone, code: "000001" });
    for (const response of [neverAsked, wrong]) {
      expect(response.json()).toMatchObject({ status: 400, code: "invalid_code" });
    }
    expect(neverAsked.json()["detail"]).toBe(wrong.json()["detail"]);
  });

  it("answers too many codes with 429 and Retry-After", async () => {
    const phone = nextPhone();
    await post("/v1/auth/code", { phone });
    const again = await post("/v1/auth/code", { phone });
    expect(again.status).toBe(429);
    expect(Number(again.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("refuses a made-up, malformed or wrong-kind token", async () => {
    for (const authorization of ["Bearer sa_" + "A".repeat(43), "Bearer nonsense", "Basic abc"]) {
      expect(await upcoming({ authorization })).toBe(401);
    }
    const session = await signIn(nextPhone());
    expect(await upcoming({ authorization: `Bearer ${session.refresh_token}` })).toBe(401);
  });

  it("decides by the token alone when one is sent, even with the dev header", async () => {
    const session = await signIn(nextPhone());
    expect(
      await upcoming({
        authorization: "Bearer sa_" + "B".repeat(43),
        [DEV_CALLER_HEADER]: session.user_id,
      }),
    ).toBe(401);
  });
});

describe("deployed environments", () => {
  it("answer 503 for sign-in when they have no SMS provider, and ignore the dev header", async () => {
    const prod = await testApi(
      fixedReadiness(READY),
      "prod",
      { repository: pgInvitationRepository(pool), callers: sessionCallers("prod", null) },
      null,
    );
    try {
      const code = await prod.app.inject({
        method: "POST",
        url: "/v1/auth/code",
        payload: { phone: "13800000000" },
      });
      expect(code.json()).toMatchObject({ status: 503, code: "unavailable" });
      const devHeader = await prod.app.inject({
        method: "GET",
        url: "/v1/dates/upcoming",
        headers: { [DEV_CALLER_HEADER]: "00000000-0000-4000-8000-000000000001" },
      });
      expect(devHeader.statusCode).toBe(401);
    } finally {
      await prod.app.close();
    }
  });
});
