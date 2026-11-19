// Invitations against the real schema, as serendipity_app: opening, accept,
// decline, expiry, repeats, strangers, concurrency, audit, and that a
// person's records never carry anything of the other person.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { pgInvitationRepository } from "./invitations.js";
import type { InvitationRepository } from "./invitations.js";
import { migrate } from "./migrations.js";
import { createLoginRole, createTestDatabase, urlFor } from "./test-db.js";
import type { TestDatabase } from "./test-db.js";
import { seedInvitationDate } from "./test-invitations.js";
import type { InvitationFixture } from "./test-invitations.js";

const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const NOW = new Date("2026-11-18T04:00:00Z");
const DEADLINE = new Date("2026-11-19T04:00:00Z");
const AFTER = new Date("2026-11-19T04:00:01Z");

let db: TestDatabase;
let role: Awaited<ReturnType<typeof createLoginRole>>;
let admin: pg.Pool;
let pool: pg.Pool;
let invitations: InvitationRepository;

beforeAll(async () => {
  db = await createTestDatabase();
  await migrate(db.url, "up");
  role = await createLoginRole("serendipity_app");
  admin = new pg.Pool({ connectionString: db.url });
  pool = new pg.Pool({ connectionString: urlFor(db.name, role) });
  invitations = pgInvitationRepository(pool);
});

afterAll(async () => {
  await pool.end();
  await admin.end();
  await db.drop();
  await role.drop();
});

/** A fresh date with its invitations open. */
async function invited(): Promise<InvitationFixture> {
  const fixture = await seedInvitationDate(admin);
  expect(await invitations.open(fixture.dateId, DEADLINE)).toBe(true);
  return fixture;
}

async function stateOf(dateId: string) {
  const { rows } = await admin.query<{ status: string; revision: number }>(
    "SELECT status, revision FROM app.dates WHERE id = $1",
    [dateId],
  );
  return rows[0];
}

async function invitesOf(dateId: string) {
  const { rows } = await admin.query<{ user_id: string; status: string }>(
    "SELECT user_id, status FROM app.date_invites WHERE date_id = $1",
    [dateId],
  );
  return Object.fromEntries(rows.map((row) => [row.user_id, row.status]));
}

describe("open", () => {
  it("invites both people, pending until the deadline, and only once", async () => {
    const f = await seedInvitationDate(admin);
    expect(await invitations.open(f.dateId, DEADLINE, { traceId: TRACE_ID })).toBe(true);
    expect((await stateOf(f.dateId))?.status).toBe("INVITED");
    expect(await invitesOf(f.dateId)).toEqual({ [f.userA]: "pending", [f.userB]: "pending" });
    expect(await invitations.open(f.dateId, DEADLINE)).toBe(false);
  });
});

describe("reading", () => {
  it("gives each person their own side and nothing of the other's", async () => {
    const f = await invited();
    for (const [party, me, them] of [
      ["A", f.userA, "B"],
      ["B", f.userB, "A"],
    ] as const) {
      const mine = await invitations.forUser(me);
      expect(mine.map((r) => [r.dateId, r.party])).toEqual([[f.dateId, party]]);
      const text = JSON.stringify(mine);
      for (const secret of f.secretsOf[them]) expect(text).not.toContain(secret);
    }
  });

  it("shows a stranger nothing, and does not tell 'not yours' from 'no such date'", async () => {
    const f = await invited();
    expect(await invitations.forUser(f.stranger)).toEqual([]);
    expect(await invitations.forUserDate(f.stranger, f.dateId)).toBeNull();
    expect(
      await invitations.forUserDate(f.userA, "00000000-0000-4000-8000-000000000000"),
    ).toBeNull();
  });
});

describe("accept", () => {
  it("confirms the date once both accept, and a repeat changes nothing", async () => {
    const f = await invited();
    const first = await invitations.answer(f.userA, f.dateId, "accept", NOW, { traceId: TRACE_ID });
    expect(first).toMatchObject({ kind: "answered", changed: true });
    expect((await stateOf(f.dateId))?.status).toBe("INVITED");

    const second = await invitations.answer(f.userB, f.dateId, "accept", NOW);
    expect(second.kind === "answered" && second.record.date.state).toBe("BOTH_ACCEPTED");
    expect(await invitesOf(f.dateId)).toEqual({ [f.userA]: "accepted", [f.userB]: "accepted" });

    const before = await stateOf(f.dateId);
    expect(await invitations.answer(f.userA, f.dateId, "accept", NOW)).toMatchObject({
      kind: "answered",
      changed: false,
    });
    expect(await stateOf(f.dateId)).toEqual(before);
  });

  it("cancels a date both accepted, after the deadline too, and frees both people's time", async () => {
    const f = await invited();
    await invitations.answer(f.userA, f.dateId, "accept", NOW);
    await invitations.answer(f.userB, f.dateId, "accept", NOW);
    const cancelled = await invitations.answer(f.userA, f.dateId, "decline", AFTER);
    expect(cancelled).toMatchObject({ kind: "answered", changed: true });
    expect((await stateOf(f.dateId))?.status).toBe("CANCELLED_BEFORE_PAYMENT");
    expect(await invitesOf(f.dateId)).toEqual({ [f.userA]: "declined", [f.userB]: "accepted" });
    const other = await invitations.forUserDate(f.userB, f.dateId);
    expect(other?.date.state).toBe("CANCELLED_BEFORE_PAYMENT");
    const { rows } = await admin.query<{ holds: boolean }>(
      "SELECT bool_or(holds_time) AS holds FROM app.date_participants WHERE date_id = $1",
      [f.dateId],
    );
    expect(rows[0]?.holds).toBe(false);
  });

  it("takes two answers at the same moment one after the other", async () => {
    const f = await invited();
    const [a, b] = await Promise.all([
      invitations.answer(f.userA, f.dateId, "accept", NOW),
      invitations.answer(f.userB, f.dateId, "accept", NOW),
    ]);
    expect([a.kind, b.kind]).toEqual(["answered", "answered"]);
    expect(await stateOf(f.dateId)).toEqual({ status: "BOTH_ACCEPTED", revision: 4 });
  });
});

describe("decline", () => {
  it("ends the date, withdraws the other pending invitation, and closes it to answers", async () => {
    const f = await invited();
    expect(await invitations.answer(f.userB, f.dateId, "decline", NOW)).toMatchObject({
      kind: "answered",
      changed: true,
    });
    expect((await stateOf(f.dateId))?.status).toBe("CANCELLED_BEFORE_PAYMENT");
    expect(await invitesOf(f.dateId)).toEqual({ [f.userA]: "withdrawn", [f.userB]: "declined" });
    expect(await invitations.answer(f.userA, f.dateId, "accept", NOW)).toMatchObject({
      kind: "refused",
      refusal: "closed",
    });
  });

  it("leaves an acceptance in place but closes the date", async () => {
    const f = await invited();
    await invitations.answer(f.userA, f.dateId, "accept", NOW);
    await invitations.answer(f.userB, f.dateId, "decline", NOW);
    expect((await stateOf(f.dateId))?.status).toBe("CANCELLED_BEFORE_PAYMENT");
    expect(await invitesOf(f.dateId)).toEqual({ [f.userA]: "accepted", [f.userB]: "declined" });
  });
});

describe("expiry", () => {
  it("expires nothing before the deadline, then the date and its pending invitations", async () => {
    const f = await invited();
    await invitations.answer(f.userA, f.dateId, "accept", NOW);
    expect(await invitations.expireDue(NOW)).toBe(0);
    expect(await invitations.expireDue(AFTER)).toBeGreaterThanOrEqual(1);
    expect((await stateOf(f.dateId))?.status).toBe("EXPIRED");
    expect(await invitesOf(f.dateId)).toEqual({ [f.userA]: "accepted", [f.userB]: "expired" });
    expect(await invitations.answer(f.userB, f.dateId, "accept", AFTER)).toMatchObject({
      kind: "refused",
      refusal: "expired",
    });
  });

  it("refuses an answer past the deadline even before the job has run", async () => {
    const f = await invited();
    expect(await invitations.answer(f.userA, f.dateId, "accept", DEADLINE)).toMatchObject({
      kind: "refused",
      refusal: "expired",
    });
    expect((await stateOf(f.dateId))?.status).toBe("INVITED");
  });

  it("leaves a confirmed date alone", async () => {
    const f = await invited();
    await invitations.answer(f.userA, f.dateId, "accept", NOW);
    await invitations.answer(f.userB, f.dateId, "accept", NOW);
    await invitations.expireDue(AFTER);
    expect((await stateOf(f.dateId))?.status).toBe("BOTH_ACCEPTED");
  });
});

describe("strangers and audit", () => {
  it("ignores an invitation row wrongly filed under someone outside the date", async () => {
    const f = await invited();
    // A corrupt row: an invitation for a person who is neither side of the date.
    await admin.query(
      `INSERT INTO app.date_invites (date_id, user_id, expires_at) VALUES ($1, $2, $3)`,
      [f.dateId, f.stranger, DEADLINE],
    );
    expect(await invitations.forUser(f.stranger)).toEqual([]);
    expect(await invitations.forUserDate(f.stranger, f.dateId)).toBeNull();
    expect(await invitations.answer(f.stranger, f.dateId, "decline", NOW)).toEqual({
      kind: "not_found",
    });
    expect((await stateOf(f.dateId))?.status).toBe("INVITED");
  });

  it("does not let a stranger answer, and audits the attempt", async () => {
    const f = await invited();
    expect(await invitations.answer(f.stranger, f.dateId, "accept", NOW)).toEqual({
      kind: "not_found",
    });
    expect((await stateOf(f.dateId))?.status).toBe("INVITED");
    const { rows } = await admin.query<{ actor_id: string }>(
      `SELECT actor_id FROM app.audit_events WHERE action = 'date.invite.not_found' AND object_id = $1`,
      [f.dateId],
    );
    expect(rows.map((row) => row.actor_id)).toEqual([f.stranger]);
  });

  it("audits each answer with the request's trace id", async () => {
    const f = await invited();
    await invitations.answer(f.userA, f.dateId, "accept", NOW, { traceId: TRACE_ID });
    const { rows } = await admin.query<{
      actor_id: string;
      metadata_redacted: { trace_id: string };
    }>(
      `SELECT actor_id, metadata_redacted FROM app.audit_events
       WHERE action = 'date.invite.accepted' AND object_id = $1`,
      [f.dateId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actor_id).toBe(f.userA);
    expect(rows[0]?.metadata_redacted.trace_id).toBe(TRACE_ID);
  });
});
