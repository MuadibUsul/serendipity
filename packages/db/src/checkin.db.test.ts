// Checking in at the venue and the reveal against the real schema (ADR-0028),
// as the application role.
import { checkinOpen } from "@serendipity/checkin";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { pgCheckinRepository } from "./checkin.js";
import { migrate } from "./migrations.js";
import { createLoginRole, createTestDatabase, urlFor } from "./test-db.js";
import type { TestDatabase } from "./test-db.js";

const START = new Date("2026-11-22T03:00:00Z");
const END = new Date("2026-11-22T05:00:00Z");
const DURING = new Date("2026-11-22T02:50:00Z");

let db: TestDatabase;
let role: Awaited<ReturnType<typeof createLoginRole>>;
let admin: pg.Pool;
let pool: pg.Pool;

beforeAll(async () => {
  db = await createTestDatabase();
  await migrate(db.url, "up");
  role = await createLoginRole("serendipity_app");
  admin = new pg.Pool({ connectionString: db.url });
  pool = new pg.Pool({ connectionString: urlFor(db.name, role) });
});

afterAll(async () => {
  await pool.end();
  await admin.end();
  await db.drop();
  await role.drop();
});

async function venue(): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    `INSERT INTO app.venues (name, region, address, location, status)
     VALUES ('Test venue', 'SFB_BAYAREA', '1 Test St', 'SRID=4326;POINT(-122.42 37.76)', 'active')
     RETURNING id`,
  );
  return rows[0]?.id ?? "";
}

async function confirmedDate(venueId: string) {
  const users = await admin.query<{ id: string }>(
    "INSERT INTO app.users (status) VALUES ('active'), ('active') RETURNING id",
  );
  const [a, b] = users.rows.map((row) => row.id).sort();
  const context = {
    accepted: { A: true, B: true },
    paymentsOpened: true,
    paid: { A: true, B: true },
    venueConfirmed: true,
    checkedIn: { A: false, B: false },
    heldFrom: null,
  };
  const { rows } = await admin.query<{ id: string }>(
    `INSERT INTO app.dates (user_a, user_b, venue_id, status, machine_context, start_at, end_at)
     VALUES ($1, $2, $3, 'CONFIRMED', $4, $5, $6) RETURNING id`,
    [a, b, venueId, JSON.stringify(context), START, END],
  );
  return { dateId: rows[0]?.id ?? "", a: a ?? "", b: b ?? "" };
}

const repo = () => pgCheckinRepository(pool);

describe("devices", () => {
  it("knows a live device's venue, and nothing once it is revoked", async () => {
    const venueId = await venue();
    const deviceId = await repo().registerDevice(venueId, "Front desk iPad", "hash-1");
    expect(await repo().deviceVenue("hash-1")).toBe(venueId);
    expect(await repo().deviceVenue("hash-unknown")).toBeNull();
    expect(await repo().revokeDevice(deviceId)).toBe(true);
    expect(await repo().deviceVenue("hash-1")).toBeNull();
  });

  it("stops working when its venue is no longer active", async () => {
    const venueId = await venue();
    await repo().registerDevice(venueId, "Bar", "hash-2");
    await admin.query("UPDATE app.venues SET status = 'suspended' WHERE id = $1", [venueId]);
    expect(await repo().deviceVenue("hash-2")).toBeNull();
  });
});

describe("checking in", () => {
  it("checks both in, records each once, and then reveals", async () => {
    const venueId = await venue();
    const { dateId, a, b } = await confirmedDate(venueId);
    expect(await repo().reveal(venueId, dateId)).toEqual({ kind: "waiting" });
    expect(await repo().checkIn(venueId, dateId, "A", DURING, checkinOpen)).toEqual({
      kind: "checked_in",
      both: false,
      repeated: false,
    });
    expect(await repo().checkIn(venueId, dateId, "A", DURING, checkinOpen)).toEqual({
      kind: "checked_in",
      both: false,
      repeated: true,
    });
    expect(await repo().ownCheckin(a, dateId)).toMatchObject({ party: "A", checkedIn: true });
    expect(await repo().ownCheckin(b, dateId)).toMatchObject({ party: "B", checkedIn: false });
    expect(await repo().checkIn(venueId, dateId, "B", DURING, checkinOpen)).toEqual({
      kind: "checked_in",
      both: true,
      repeated: false,
    });
    const rows = await admin.query<{ user_id: string; method: string; venue_attested: boolean }>(
      "SELECT user_id, method, venue_attested FROM app.checkins WHERE date_id = $1 ORDER BY user_id",
      [dateId],
    );
    expect(rows.rows).toEqual([
      { user_id: a, method: "qr", venue_attested: true },
      { user_id: b, method: "qr", venue_attested: true },
    ]);
    expect(await repo().reveal(venueId, dateId)).toEqual({ kind: "revealed", repeated: false });
    expect(await repo().reveal(venueId, dateId)).toEqual({ kind: "revealed", repeated: true });
    const status = await admin.query("SELECT status FROM app.dates WHERE id = $1", [dateId]);
    expect(status.rows[0]).toEqual({ status: "REVEALED" });
  });

  it("acts only on dates at the device's own venue", async () => {
    const venueId = await venue();
    const other = await venue();
    const { dateId } = await confirmedDate(venueId);
    expect(await repo().checkIn(other, dateId, "A", DURING, checkinOpen)).toEqual({
      kind: "not_found",
    });
    expect(await repo().reveal(other, dateId)).toEqual({ kind: "not_found" });
    const status = await admin.query("SELECT status FROM app.dates WHERE id = $1", [dateId]);
    expect(status.rows[0]).toEqual({ status: "CONFIRMED" });
  });

  it("works only around the date", async () => {
    const venueId = await venue();
    const { dateId } = await confirmedDate(venueId);
    for (const at of [new Date("2026-11-22T02:00:00Z"), END]) {
      expect(await repo().checkIn(venueId, dateId, "A", at, checkinOpen)).toEqual({
        kind: "closed",
      });
    }
  });

  it("refuses a date that is not on, through the machine", async () => {
    const venueId = await venue();
    const { dateId } = await confirmedDate(venueId);
    await admin.query("UPDATE app.dates SET status = 'SAFETY_HOLD' WHERE id = $1", [dateId]);
    expect(await repo().checkIn(venueId, dateId, "A", DURING, checkinOpen)).toEqual({
      kind: "refused",
    });
    expect(
      (await admin.query("SELECT 1 FROM app.checkins WHERE date_id = $1", [dateId])).rowCount,
    ).toBe(0);
  });

  it("tells a person only their own side, and nothing about another's date", async () => {
    const venueId = await venue();
    const { dateId, a } = await confirmedDate(venueId);
    const stranger = await admin.query<{ id: string }>(
      "INSERT INTO app.users (status) VALUES ('active') RETURNING id",
    );
    expect(await repo().ownCheckin(a, dateId)).toEqual({
      party: "A",
      startAt: START,
      endAt: END,
      showing: true,
      checkedIn: false,
    });
    expect(await repo().ownCheckin(stranger.rows[0]?.id ?? "", dateId)).toBeNull();
  });

  it("audits every scan as the venue, without naming anyone", async () => {
    const venueId = await venue();
    const { dateId, a, b } = await confirmedDate(venueId);
    await repo().checkIn(venueId, dateId, "A", DURING, checkinOpen);
    await repo().checkIn(venueId, dateId, "A", new Date("2026-11-21T00:00:00Z"), checkinOpen);
    const audit = await admin.query<{ actor_type: string; actor_id: string; text: string }>(
      `SELECT actor_type, actor_id, metadata_redacted::text AS text FROM app.audit_events
       WHERE object_id = $1 AND action LIKE 'date.checkin%'`,
      [dateId],
    );
    expect(audit.rows).toHaveLength(2);
    for (const row of audit.rows) {
      expect(row).toMatchObject({ actor_type: "merchant", actor_id: venueId });
      expect(row.text).not.toContain(a);
      expect(row.text).not.toContain(b);
    }
  });
});
