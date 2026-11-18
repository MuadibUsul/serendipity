// Anonymous invitations end to end: HTTP → controller → repository →
// PostgreSQL, as serendipity_app. The negative tests search every response a
// person gets for anything of the other person (their id, profile, photo and
// identity references); decline and expiry are walked over HTTP.
import { migrate, pgInvitationRepository } from "@serendipity/db";
import type { InvitationRepository } from "@serendipity/db";
import { createLoginRole, createTestDatabase, urlFor } from "@serendipity/db/test-db";
import type { TestDatabase } from "@serendipity/db/test-db";
import { seedInvitationDate } from "@serendipity/db/test-invitations";
import type { InvitationFixture } from "@serendipity/db/test-invitations";
import { VIEW_KEYS } from "@serendipity/invitations";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Api } from "./app.js";
import { DEV_CALLER_HEADER, devHeaderCallers } from "./callers.js";
import { READY, fixedReadiness, testApi } from "./test-support.js";

const DEADLINE = new Date("2026-11-19T04:00:00Z");
let now = new Date("2026-11-18T04:00:00Z");

let db: TestDatabase;
let role: Awaited<ReturnType<typeof createLoginRole>>;
let admin: pg.Pool;
let pool: pg.Pool;
let repository: InvitationRepository;
let api: Api;

beforeAll(async () => {
  db = await createTestDatabase();
  await migrate(db.url, "up");
  role = await createLoginRole("serendipity_app");
  admin = new pg.Pool({ connectionString: db.url });
  pool = new pg.Pool({ connectionString: urlFor(db.name, role) });
  repository = pgInvitationRepository(pool);
  api = await testApi(fixedReadiness(READY), "test", {
    repository,
    callers: devHeaderCallers("test"),
    clock: () => now,
  });
});

afterAll(async () => {
  await api.app.close();
  await pool.end();
  await admin.end();
  await db.drop();
  await role.drop();
});

async function invited(): Promise<InvitationFixture> {
  now = new Date("2026-11-18T04:00:00Z");
  const fixture = await seedInvitationDate(admin);
  expect(await repository.open(fixture.dateId, DEADLINE)).toBe(true);
  return fixture;
}

async function call(method: "GET" | "POST", url: string, userId: string) {
  const response = await api.app.inject({ method, url, headers: { [DEV_CALLER_HEADER]: userId } });
  return {
    status: response.statusCode,
    body: response.body,
    json: () => response.json<Record<string, unknown>>(),
  };
}

/** Every endpoint a person can reach for a date, read and write. */
async function everyResponse(f: InvitationFixture, userId: string) {
  return [
    await call("GET", "/v1/dates/upcoming", userId),
    await call("GET", `/v1/dates/${f.dateId}`, userId),
    await call("POST", `/v1/dates/${f.dateId}/accept`, userId),
    await call("GET", `/v1/dates/${f.dateId}`, userId),
    await call("POST", `/v1/dates/${f.dateId}/decline`, userId),
    await call("GET", "/v1/dates/upcoming", userId),
    await call("POST", `/v1/dates/${f.dateId}/accept`, userId),
  ];
}

describe("anonymity before the reveal (ADR-006)", () => {
  it("never returns anything of the other person, on any endpoint, in any state", async () => {
    for (const [me, them] of [
      ["A", "B"],
      ["B", "A"],
    ] as const) {
      const f = await invited();
      const userId = me === "A" ? f.userA : f.userB;
      const responses = await everyResponse(f, userId);
      expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 200, 409]);
      // Every successful answer is exactly the allowlisted view, nothing added.
      for (const response of responses.filter((r) => r.status === 200)) {
        const body = response.json();
        const views = "invitations" in body ? (body["invitations"] as object[]) : [body];
        for (const view of views) expect(Object.keys(view).sort()).toEqual([...VIEW_KEYS].sort());
      }
      for (const response of responses) {
        for (const secret of f.secretsOf[them]) expect(response.body).not.toContain(secret);
      }
      // Not even the caller's own id is echoed back.
      for (const response of responses) expect(response.body).not.toContain(userId);
    }
  });

  it("shows a stranger nothing: an empty list and 404 for the date", async () => {
    const f = await invited();
    expect((await call("GET", "/v1/dates/upcoming", f.stranger)).json()).toEqual({
      invitations: [],
    });
    for (const [method, path] of [
      ["GET", ""],
      ["POST", "/accept"],
      ["POST", "/decline"],
    ] as const) {
      const response = await call(method, `/v1/dates/${f.dateId}${path}`, f.stranger);
      expect(response.status).toBe(404);
      for (const secret of [...f.secretsOf.A, ...f.secretsOf.B]) {
        expect(response.body).not.toContain(secret);
      }
    }
    const { rows } = await admin.query<{ status: string }>(
      "SELECT status FROM app.dates WHERE id = $1",
      [f.dateId],
    );
    expect(rows[0]?.status).toBe("INVITED");
  });

  it("does not show whether the other person has accepted", async () => {
    const f = await invited();
    const before = (await call("GET", `/v1/dates/${f.dateId}`, f.userA)).json();
    await call("POST", `/v1/dates/${f.dateId}/accept`, f.userB);
    const after = (await call("GET", `/v1/dates/${f.dateId}`, f.userA)).json();
    expect(after).toEqual(before);
    expect(after["status"]).toBe("awaiting_you");
  });
});

describe("accept", () => {
  it("is confirmed for both once both accept", async () => {
    const f = await invited();
    expect((await call("POST", `/v1/dates/${f.dateId}/accept`, f.userA)).json()["status"]).toBe(
      "accepted",
    );
    expect((await call("POST", `/v1/dates/${f.dateId}/accept`, f.userB)).json()["status"]).toBe(
      "confirmed",
    );
    expect((await call("GET", `/v1/dates/${f.dateId}`, f.userA)).json()["status"]).toBe(
      "confirmed",
    );
  });
});

describe("decline", () => {
  it("closes the date for the other person without saying why", async () => {
    const f = await invited();
    const declined = await call("POST", `/v1/dates/${f.dateId}/decline`, f.userB);
    expect(declined.status).toBe(200);
    expect(declined.json()["status"]).toBe("declined");

    const forA = (await call("GET", `/v1/dates/${f.dateId}`, f.userA)).json();
    expect(forA).toMatchObject({ status: "closed", answer_by: null });
    expect(JSON.stringify(forA)).not.toMatch(/declin|refus|reject/i);

    const late = await call("POST", `/v1/dates/${f.dateId}/accept`, f.userA);
    expect(late.status).toBe(409);
    expect(late.body).not.toMatch(/declin/i);
  });

  it("looks exactly like an expiry to the other person", async () => {
    const declinedDate = await invited();
    await call("POST", `/v1/dates/${declinedDate.dateId}/decline`, declinedDate.userB);
    const afterDecline = (
      await call("GET", `/v1/dates/${declinedDate.dateId}`, declinedDate.userA)
    ).json();

    const expiredDate = await invited();
    now = new Date(DEADLINE.getTime() + 1000);
    await repository.expireDue(now);
    const afterExpiry = (
      await call("GET", `/v1/dates/${expiredDate.dateId}`, expiredDate.userA)
    ).json();

    // Everything but the date's own id is the same.
    expect({ ...afterDecline, date_id: "x" }).toEqual({ ...afterExpiry, date_id: "x" });
  });
});

describe("expiry", () => {
  it("refuses answers after the deadline with 410, before and after the job runs", async () => {
    const f = await invited();
    now = DEADLINE;
    const beforeJob = await call("POST", `/v1/dates/${f.dateId}/accept`, f.userA);
    expect(beforeJob.status).toBe(410);
    expect((await call("GET", `/v1/dates/${f.dateId}`, f.userA)).json()["status"]).toBe("closed");

    await repository.expireDue(now);
    const afterJob = await call("POST", `/v1/dates/${f.dateId}/decline`, f.userB);
    expect(afterJob.status).toBe(410);
    const { rows } = await admin.query<{ status: string }>(
      "SELECT status FROM app.dates WHERE id = $1",
      [f.dateId],
    );
    expect(rows[0]?.status).toBe("EXPIRED");
  });
});
