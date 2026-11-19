// Reports, holds, blocks and appeals against the real schema, as serendipity_app.
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { pgFeedbackRepository } from "./feedback.js";
import { migrate } from "./migrations.js";
import { pgRelationshipRepository } from "./relationships.js";
import { pgSafetyRepository } from "./safety.js";
import type { SafetyRepository } from "./safety.js";
import { createLoginRole, createTestDatabase, urlFor } from "./test-db.js";
import type { TestDatabase } from "./test-db.js";

const NOW = new Date("2026-11-22T10:00:00Z");
const STAFF = "5ea5ea5e-0000-4000-8000-000000000001";

let db: TestDatabase;
let role: Awaited<ReturnType<typeof createLoginRole>>;
let admin: pg.Pool;
let pool: pg.Pool;
let safety: SafetyRepository;

beforeAll(async () => {
  db = await createTestDatabase();
  await migrate(db.url, "up");
  role = await createLoginRole("serendipity_app");
  admin = new pg.Pool({ connectionString: db.url });
  pool = new pg.Pool({ connectionString: urlFor(db.name, role) });
  safety = pgSafetyRepository(pool);
});

afterAll(async () => {
  await pool.end();
  await admin.end();
  await db.drop();
  await role.drop();
});

/** Two people, their date, and their open chat. */
async function pair(dateStatus = "CLOSED") {
  const { rows } = await admin.query<{ id: string }>(
    "INSERT INTO app.users (status) VALUES ('active'), ('active') RETURNING id",
  );
  const [a, b] = rows.map((row) => row.id) as [string, string];
  const date = await admin.query<{ id: string }>(
    `INSERT INTO app.dates (user_a, user_b, status, start_at, end_at)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      a,
      b,
      dateStatus,
      new Date(NOW.getTime() - 3 * 3_600_000),
      new Date(NOW.getTime() - 3_600_000),
    ],
  );
  const dateId = date.rows[0]?.id ?? "";
  const rel = await admin.query<{ id: string }>(
    `INSERT INTO app.relationships (date_id, user_a, user_b, mutual_opt_in_at, chat_open)
     VALUES ($1, $2, $3, now(), true) RETURNING id`,
    [dateId, a, b],
  );
  return { a, b, dateId, relId: rel.rows[0]?.id ?? "" };
}

const user = async (id: string) =>
  (
    await admin.query<{ status: string; held: boolean }>(
      "SELECT status, match_hold_at IS NOT NULL AS held FROM app.users WHERE id = $1",
      [id],
    )
  ).rows[0];

const blocked = async (blocker: string, blockedId: string) =>
  ((
    await admin.query("SELECT 1 FROM app.user_blocks WHERE blocker_id = $1 AND blocked_id = $2", [
      blocker,
      blockedId,
    ])
  ).rowCount ?? 0) > 0;

describe("reporting", () => {
  it("blocks a standard report's two people from meeting again, without holding anyone", async () => {
    const { a, b, dateId, relId } = await pair();
    expect(await safety.report(a, dateId, "no_show", null, NOW)).toMatchObject({
      kind: "received",
      risk: "standard",
    });
    expect(await blocked(a, b)).toBe(true);
    expect(await user(b)).toEqual({ status: "active", held: false });
    const chat = await admin.query<{ chat_open: boolean }>(
      "SELECT chat_open FROM app.relationships WHERE id = $1",
      [relId],
    );
    expect(chat.rows[0]?.chat_open).toBe(true);
  });

  it("holds the other person and closes chat at once on a high-risk report", async () => {
    const { a, b, dateId, relId } = await pair();
    expect(await safety.report(a, dateId, "stalking", "followed me", NOW)).toMatchObject({
      risk: "high",
    });
    expect(await user(b)).toEqual({ status: "active", held: true });
    const chat = await pgRelationshipRepository(pool).send(b, relId, "hi", NOW);
    expect(chat).toEqual({ kind: "refused", refusal: "blocked" });
  });

  it("only about someone the reporter had a date with", async () => {
    const { dateId } = await pair();
    const stranger = await pair();
    expect(await safety.report(stranger.a, dateId, "scam", null, NOW)).toEqual({
      kind: "not_found",
    });
  });

  it("tells the reporter received, then handled, never the outcome; audits no details", async () => {
    const { a, dateId } = await pair();
    const filed = await safety.report(a, dateId, "harassment", "秘密细节", NOW);
    expect(await safety.ownReports(a)).toMatchObject([
      { category: "harassment", status: "received" },
    ]);
    if (filed.kind !== "received") throw new Error("not filed");
    await safety.decide(filed.id, STAFF, "warn", NOW);
    expect(await safety.ownReports(a)).toMatchObject([{ status: "handled" }]);
    const { rows } = await admin.query(
      "SELECT metadata_redacted FROM app.audit_events WHERE object_id = $1",
      [filed.id],
    );
    expect(JSON.stringify(rows)).not.toContain("秘密");
  });

  it("files 'I did not feel safe' from feedback as a report", async () => {
    const { a, b, dateId } = await pair("POST_DATE_FEEDBACK");
    await pgFeedbackRepository(pool).submit(
      a,
      dateId,
      { feltSafe: false, comfort: 1, wantsToContinue: false },
      NOW,
    );
    const { rows } = await admin.query<{ category: string; subject_id: string }>(
      "SELECT category, subject_id FROM app.safety_reports WHERE reporter_id = $1",
      [a],
    );
    expect(rows).toEqual([{ category: "felt_unsafe", subject_id: b }]);
  });
});

describe("staff decisions and appeals", () => {
  it("puts high-risk reports first in the queue", async () => {
    const first = await pair();
    const second = await pair();
    await safety.report(first.a, first.dateId, "scam", null, NOW);
    await safety.report(
      second.a,
      second.dateId,
      "threat_or_violence",
      null,
      new Date(NOW.getTime() + 1000),
    );
    const queue = await safety.queue(100);
    const mine = queue.filter((r) => [first.b, second.b].includes(r.subjectId));
    expect(mine.map((r) => r.risk)).toEqual(["high", "standard"]);
  });

  it("dismissing releases the hold; suspending suspends; an appeal can overturn it", async () => {
    const { a, b, dateId } = await pair();
    const held = await safety.report(a, dateId, "sexual_misconduct", null, NOW);
    if (held.kind !== "received") throw new Error("not filed");
    expect(await safety.decide(held.id, STAFF, "suspend", NOW)).toBe(true);
    expect(await user(b)).toEqual({ status: "suspended", held: true });
    expect(await safety.decide(held.id, STAFF, "dismiss", NOW)).toBe(false);

    const appeal = await safety.recordAppeal(held.id, "It was a misunderstanding.", STAFF, NOW);
    expect(appeal).not.toBeNull();
    expect(await safety.recordAppeal(held.id, "again", STAFF, NOW)).toBeNull();
    expect(await safety.decideAppeal(appeal ?? "", STAFF, "overturned", NOW)).toBe(true);
    expect(await user(b)).toEqual({ status: "active", held: false });

    const other = await pair();
    const dismissed = await safety.report(other.a, other.dateId, "stalking", null, NOW);
    if (dismissed.kind !== "received") throw new Error("not filed");
    await safety.decide(dismissed.id, STAFF, "dismiss", NOW);
    expect(await user(other.b)).toEqual({ status: "active", held: false });
    // A block stays: the reporter never meets them again, whatever the decision.
    expect(await blocked(other.a, other.b)).toBe(true);
  });

  it("keeps a person held while another high-risk report about them is open", async () => {
    const one = await pair();
    const { rows } = await admin.query<{ id: string }>(
      "INSERT INTO app.users (status) VALUES ('active') RETURNING id",
    );
    const third = rows[0]?.id ?? "";
    const date2 = await admin.query<{ id: string }>(
      "INSERT INTO app.dates (user_a, user_b, status) VALUES ($1, $2, 'CLOSED') RETURNING id",
      [third, one.b],
    );
    const r1 = await safety.report(one.a, one.dateId, "stalking", null, NOW);
    await safety.report(third, date2.rows[0]?.id ?? "", "threat_or_violence", null, NOW);
    if (r1.kind !== "received") throw new Error("not filed");
    await safety.decide(r1.id, STAFF, "dismiss", NOW);
    expect(await user(one.b)).toEqual({ status: "active", held: true });
  });
});
