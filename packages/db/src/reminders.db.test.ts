// Queuing reminders before confirmed dates against the real schema (ADR-0029).
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { migrate } from "./migrations.js";
import { pgReminderQueue } from "./reminders.js";
import { createLoginRole, createTestDatabase, urlFor } from "./test-db.js";
import type { TestDatabase } from "./test-db.js";

const START = new Date("2026-11-22T03:00:00Z"); // 7:00 PM on the 21st in San Francisco
const before = (minutes: number) => new Date(START.getTime() - minutes * 60_000);

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

beforeEach(async () => {
  await admin.query("DELETE FROM app.notification_outbox");
  await admin.query("DELETE FROM app.dates");
});

afterAll(async () => {
  await pool.end();
  await admin.end();
  await db.drop();
  await role.drop();
});

async function date(status = "CONFIRMED", start = START) {
  const users = await admin.query<{ id: string }>(
    "INSERT INTO app.users (status) VALUES ('active'), ('active') RETURNING id",
  );
  const [a, b] = users.rows.map((row) => row.id).sort();
  const venue = await admin.query<{ id: string }>(
    `INSERT INTO app.venues (name, region, address, location, status)
     VALUES ('Foreign Cinema', 'SFB_BAYAREA', '2534 Mission St', 'SRID=4326;POINT(-122.42 37.76)', 'active')
     RETURNING id`,
  );
  const { rows } = await admin.query<{ id: string }>(
    `INSERT INTO app.dates (user_a, user_b, venue_id, status, start_at, end_at)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [a, b, venue.rows[0]?.id, status, start, new Date(start.getTime() + 7_200_000)],
  );
  return { dateId: rows[0]?.id ?? "", a: a ?? "", b: b ?? "" };
}

const queued = async (dateId: string) =>
  (
    await admin.query<{ kind: string; recipient_user_id: string; payload: Record<string, string> }>(
      `SELECT kind, recipient_user_id, payload FROM app.notification_outbox
       WHERE aggregate_id = $1 ORDER BY created_at, kind, recipient_user_id`,
      [dateId],
    )
  ).rows;

describe("reminders", () => {
  it("queues each moment once for each person, as the date comes closer", async () => {
    const { dateId, a, b } = await date();
    const queue = pgReminderQueue(pool);
    expect(await queue.enqueueDue(before(25 * 60))).toBe(0);
    expect(await queue.enqueueDue(before(23 * 60))).toBe(2);
    expect(await queue.enqueueDue(before(22 * 60))).toBe(0);
    expect(await queue.enqueueDue(before(119))).toBe(2);
    expect(await queue.enqueueDue(before(29))).toBe(2);
    expect(await queue.enqueueDue(before(5))).toBe(0);
    const rows = await queued(dateId);
    expect(rows.map((row) => row.kind)).toEqual([
      "date.reminder.day_before",
      "date.reminder.day_before",
      "date.reminder.leave_soon",
      "date.reminder.leave_soon",
      "date.reminder.checkin_open",
      "date.reminder.checkin_open",
    ]);
    expect(new Set(rows.map((row) => row.recipient_user_id))).toEqual(new Set([a, b]));
    expect(rows[0]?.payload).toEqual({
      date_id: dateId,
      title: "Your date is tomorrow",
      body: "7:00 PM at Foreign Cinema. See you there.",
    });
  });

  it("names neither person in what it queues", async () => {
    const { dateId, a, b } = await date();
    await pgReminderQueue(pool).enqueueDue(before(60));
    const text = JSON.stringify((await queued(dateId)).map((row) => row.payload));
    expect(text).not.toContain(a);
    expect(text).not.toContain(b);
  });

  it("sends only the latest moment when confirmed at short notice", async () => {
    const { dateId } = await date();
    await pgReminderQueue(pool).enqueueDue(before(90));
    expect((await queued(dateId)).map((row) => row.kind)).toEqual([
      "date.reminder.leave_soon",
      "date.reminder.leave_soon",
    ]);
  });

  it("reminds only for confirmed dates, and not a person whose account is closed", async () => {
    const held = await date("SAFETY_HOLD");
    await pgReminderQueue(pool).enqueueDue(before(60));
    expect(await queued(held.dateId)).toEqual([]);

    const { dateId, a, b } = await date();
    await admin.query("UPDATE app.users SET status = 'suspended' WHERE id = $1", [a]);
    await pgReminderQueue(pool).enqueueDue(before(60));
    expect((await queued(dateId)).map((row) => row.recipient_user_id)).toEqual([b]);
  });

  it("does not queue twice when two workers run at once", async () => {
    const { dateId } = await date();
    const queue = pgReminderQueue(pool);
    await Promise.all([queue.enqueueDue(before(60)), queue.enqueueDue(before(60))]);
    expect(await queued(dateId)).toHaveLength(2);
  });
});
