// Private feedback against the real schema, as serendipity_app.
import { deadlineOf } from "@serendipity/feedback";
import type { FeedbackAnswer } from "@serendipity/feedback";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { pgFeedbackRepository } from "./feedback.js";
import type { FeedbackRepository } from "./feedback.js";
import { migrate } from "./migrations.js";
import { createLoginRole, createTestDatabase, urlFor } from "./test-db.js";
import type { TestDatabase } from "./test-db.js";

const ENDED = new Date("2026-11-21T08:30:00Z");
const DURING = new Date(ENDED.getTime() + 60 * 60 * 1000);
const AFTER = deadlineOf(ENDED);
const yes: FeedbackAnswer = { feltSafe: true, comfort: 4, wantsToContinue: true };
const no: FeedbackAnswer = { feltSafe: false, comfort: 1, wantsToContinue: false };

let db: TestDatabase;
let role: Awaited<ReturnType<typeof createLoginRole>>;
let admin: pg.Pool;
let pool: pg.Pool;
let feedback: FeedbackRepository;

beforeAll(async () => {
  db = await createTestDatabase();
  await migrate(db.url, "up");
  role = await createLoginRole("serendipity_app");
  admin = new pg.Pool({ connectionString: db.url });
  pool = new pg.Pool({ connectionString: urlFor(db.name, role) });
  feedback = pgFeedbackRepository(pool);
});

afterAll(async () => {
  await pool.end();
  await admin.end();
  await db.drop();
  await role.drop();
});

/** Two people and their date, in `status`. */
async function date(status = "POST_DATE_FEEDBACK") {
  const { rows } = await admin.query<{ id: string }>(
    "INSERT INTO app.users (status) VALUES ('active'), ('active') RETURNING id",
  );
  const [a, b] = rows.map((row) => row.id) as [string, string];
  const created = await admin.query<{ id: string }>(
    `INSERT INTO app.dates (user_a, user_b, status, start_at, end_at)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [a, b, status, new Date(ENDED.getTime() - 90 * 60 * 1000), ENDED],
  );
  return { a, b, id: created.rows[0]?.id ?? "" };
}

describe("private feedback", () => {
  it("opens a relationship only when both say yes, and never chat by itself", async () => {
    const { a, b, id } = await date();
    expect(await feedback.submit(a, id, yes, DURING)).toEqual({
      kind: "answered",
      view: { status: "thanks" },
    });
    expect(await feedback.view(b, id, DURING)).toEqual({
      status: "awaiting_you",
      answer_by: AFTER.toISOString(),
    });
    expect(await feedback.submit(b, id, yes, DURING)).toEqual({
      kind: "answered",
      view: { status: "mutual" },
    });
    expect(await feedback.view(a, id, DURING)).toEqual({ status: "mutual" });
    const { rows } = await admin.query<{ chat_open: boolean; opted: boolean }>(
      "SELECT chat_open, mutual_opt_in_at IS NOT NULL AS opted FROM app.relationships WHERE date_id = $1",
      [id],
    );
    expect(rows).toEqual([{ chat_open: false, opted: true }]);
  });

  it("keeps a 'no' indistinguishable from silence, and opens nothing", async () => {
    const { a, b, id } = await date();
    await feedback.submit(a, id, yes, DURING);
    const silent = await feedback.view(a, id, DURING);
    await feedback.submit(b, id, no, DURING);
    expect(await feedback.view(a, id, DURING)).toEqual(silent);
    expect(await feedback.view(a, id, AFTER)).toEqual({ status: "closed" });
    const { rows } = await admin.query("SELECT 1 FROM app.relationships WHERE date_id = $1", [id]);
    expect(rows).toHaveLength(0);
  });

  it("takes one answer per person, while the window is open", async () => {
    const { a, b, id } = await date();
    await feedback.submit(a, id, no, DURING);
    expect(await feedback.submit(a, id, yes, DURING)).toEqual({
      kind: "refused",
      refusal: "already_answered",
    });
    expect(await feedback.submit(b, id, yes, AFTER)).toEqual({
      kind: "refused",
      refusal: "closed",
    });
    const early = await date("REVEALED");
    expect(await feedback.submit(early.a, early.id, yes, DURING)).toEqual({
      kind: "refused",
      refusal: "not_open",
    });
  });

  it("answers nothing about a date that is not the person's", async () => {
    const { id } = await date();
    const other = await date();
    expect(await feedback.view(other.a, id, DURING)).toBeNull();
    expect(await feedback.submit(other.a, id, yes, DURING)).toEqual({ kind: "not_found" });
  });

  it("audits that an answer came in, and a safety concern, but never the answer", async () => {
    const { a, id } = await date();
    await feedback.submit(a, id, no, DURING);
    const { rows } = await admin.query<{ action: string; metadata_redacted: unknown }>(
      "SELECT action, metadata_redacted FROM app.audit_events WHERE object_id = $1 ORDER BY at, id",
      [id],
    );
    expect(rows.map((row) => row.action)).toEqual(["date.feedback.submitted"]);
    const text = JSON.stringify(rows[0]?.metadata_redacted);
    expect(text).toContain("safety_concern");
    expect(text).not.toMatch(/comfort|continue|mutual/);
  });
});
