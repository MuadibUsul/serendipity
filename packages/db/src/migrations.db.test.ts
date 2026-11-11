import { readdirSync } from "node:fs";

import { DATE_STATES } from "@serendipity/domain";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MIGRATIONS_DIR, migrate } from "./migrations.js";
import { createLoginRole, createTestDatabase, fingerprint, urlFor, withClient } from "./test-db.js";
import type { TestDatabase } from "./test-db.js";

const MIGRATION_NAMES = readdirSync(MIGRATIONS_DIR)
  .filter((file) => file.endsWith(".sql"))
  .map((file) => file.replace(/\.sql$/, ""))
  .sort();

describe("every migration applies and rolls back cleanly", () => {
  let db: TestDatabase;
  beforeAll(async () => {
    db = await createTestDatabase();
  });
  afterAll(async () => {
    await db.drop();
  });

  it("finds the migrations", () => {
    expect(MIGRATION_NAMES.length).toBeGreaterThanOrEqual(6);
  });

  it("up one at a time, down one at a time back to each earlier state, then up again", async () => {
    const snapshot = () => withClient(db.url, fingerprint);
    const states = [await snapshot()];

    for (const name of MIGRATION_NAMES) {
      expect(await migrate(db.url, "up", 1)).toEqual([name]);
      states.push(await snapshot());
    }
    for (let applied = MIGRATION_NAMES.length; applied > 0; applied -= 1) {
      expect(await migrate(db.url, "down", 1)).toEqual([MIGRATION_NAMES[applied - 1]]);
      expect(await snapshot(), `state after rolling back to ${String(applied - 1)}`).toEqual(
        states[applied - 1],
      );
    }

    expect(await migrate(db.url, "up")).toEqual(MIGRATION_NAMES);
    expect(await snapshot()).toEqual(states.at(-1));
  });

  it("leaves nothing behind after rolling everything back", async () => {
    await migrate(db.url, "down");
    const empty = await withClient(db.url, fingerprint);
    expect(empty).toMatchObject({
      extensions: [],
      schemas: [],
      columns: [],
      functions: [],
      defaultAcl: [],
      migrations: [],
    });
  });
});

describe("schema contents", () => {
  let db: TestDatabase;
  const query = <Row extends pg.QueryResultRow>(sql: string) =>
    withClient(db.url, async (client) => (await client.query<Row>(sql)).rows);

  beforeAll(async () => {
    db = await createTestDatabase();
    await migrate(db.url, "up");
  });
  afterAll(async () => {
    await db.drop();
  });

  it("has PostGIS, pgvector and btree_gist", async () => {
    const rows = await query<{ extname: string }>(`SELECT extname FROM pg_extension ORDER BY 1`);
    expect(rows.map((row) => row.extname)).toEqual(
      expect.arrayContaining(["btree_gist", "postgis", "vector"]),
    );
    const [vector] = await query<{ distance: number }>(
      `SELECT '[1,2,3]'::vector <-> '[1,2,4]'::vector AS distance`,
    );
    expect(vector?.distance).toBe(1);
  });

  it("has every table of ARCH-001 §5 named in the task", async () => {
    const rows = await query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'app' ORDER BY 1`,
    );
    expect(rows.map((row) => row.table_name)).toEqual(
      [
        "audit_events",
        "candidate_pairs",
        "checkins",
        "consent_grants",
        "date_invites",
        "date_participants",
        "dates",
        "identity_attestations",
        "match_policies",
        "media_assets",
        "media_derivatives",
        "negotiations",
        "notification_outbox",
        "payment_orders",
        "payment_webhook_events",
        "post_date_feedback",
        "profile_facts",
        "profile_versions",
        "refunds",
        "relationships",
        "users",
        "venue_slots",
        "venues",
      ].sort(),
    );
  });

  it("stores every timestamp as timestamptz and every id as uuid", async () => {
    const odd = await query<{ column: string }>(
      `SELECT format('%s.%s %s', table_name, column_name, data_type) AS column
       FROM information_schema.columns
       WHERE table_schema = 'app'
         AND ((column_name LIKE '%\\_at' AND data_type <> 'timestamp with time zone')
           OR (column_name = 'id' AND data_type <> 'uuid'))`,
    );
    expect(odd).toEqual([]);
  });

  it("allows exactly the date states of @serendipity/domain", async () => {
    const [row] = await query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'dates_status_check'`,
    );
    const allowed = [...(row?.def ?? "").matchAll(/'([A-Z_]+)'::text/g)].map((match) => match[1]);
    expect([...allowed].sort()).toEqual([...DATE_STATES].sort());
  });

  it("holds a person's time from both accepting until the reveal", async () => {
    const rows = await query<{ status: string; holds: boolean }>(
      `SELECT s AS status, app.date_status_holds_time(s) AS holds
       FROM unnest(ARRAY[${DATE_STATES.map((state) => `'${state}'`).join(",")}]) AS s`,
    );
    expect(rows.filter((row) => row.holds).map((row) => row.status)).toEqual([
      "BOTH_ACCEPTED",
      "PAYMENT_PENDING",
      "BOTH_PAID",
      "VENUE_RESERVED",
      "CONFIRMED",
      "CHECKIN_PARTIAL",
      "BOTH_CHECKED_IN",
      "REVEALED",
      "SAFETY_HOLD",
      "VENUE_UNAVAILABLE",
    ]);
  });
});

describe("deny by default", () => {
  let db: TestDatabase;
  let nobody: Awaited<ReturnType<typeof createLoginRole>>;
  let api: Awaited<ReturnType<typeof createLoginRole>>;

  beforeAll(async () => {
    db = await createTestDatabase();
    await migrate(db.url, "up");
    nobody = await createLoginRole(null);
    api = await createLoginRole("serendipity_app");
  });
  afterAll(async () => {
    await db.drop();
    await nobody.drop();
    await api.drop();
  });

  const as = (role: { name: string; password: string }) => urlFor(db.name, role);

  it("gives a role without grants nothing in the app schema", async () => {
    await withClient(as(nobody), async (client) => {
      await expect(client.query(`SELECT count(*) FROM app.users`)).rejects.toMatchObject({
        code: "42501",
      });
      await expect(
        client.query(`SELECT app.date_status_holds_time('CONFIRMED')`),
      ).rejects.toMatchObject({
        code: "42501",
      });
    });
  });

  it("lets a member of serendipity_app read and write application tables", async () => {
    await withClient(as(api), async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO app.users (status) VALUES ('active') RETURNING id`,
      );
      expect(rows).toHaveLength(1);
      await expect(client.query(`UPDATE app.users SET status = 'paused'`)).resolves.toBeDefined();
    });
  });

  it("keeps date_participants derived: the application cannot write it, the trigger can", async () => {
    await withClient(as(api), async (client) => {
      const users = await client.query<{ id: string }>(
        `INSERT INTO app.users (status) VALUES ('active'), ('active') RETURNING id`,
      );
      const [a, b] = users.rows.map((row) => row.id);
      const date = await client.query<{ id: string }>(
        `INSERT INTO app.dates (user_a, user_b, status, start_at, end_at)
         VALUES ($1, $2, 'CONFIRMED', '2026-11-07 11:00Z', '2026-11-07 13:00Z') RETURNING id`,
        [a, b],
      );
      const participants = await client.query(
        `SELECT party FROM app.date_participants WHERE date_id = $1 ORDER BY party`,
        [date.rows[0]?.id],
      );
      expect(participants.rows).toEqual([{ party: "A" }, { party: "B" }]);
      await expect(
        client.query(`DELETE FROM app.date_participants WHERE date_id = $1`, [date.rows[0]?.id]),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });

  it("keeps audit_events append-only, for the application and the owner alike", async () => {
    await withClient(as(api), async (client) => {
      await client.query(
        `INSERT INTO app.audit_events (actor_type, action, object_type) VALUES ('system', 'test', 'test')`,
      );
      for (const sql of [
        `UPDATE app.audit_events SET action = 'changed'`,
        `DELETE FROM app.audit_events`,
        `TRUNCATE app.audit_events`,
      ]) {
        await expect(client.query(sql)).rejects.toMatchObject({ code: "42501" });
      }
    });
    await withClient(db.url, async (client) => {
      await expect(client.query(`UPDATE app.audit_events SET action = 'changed'`)).rejects.toThrow(
        /append-only/,
      );
      await expect(client.query(`DELETE FROM app.audit_events`)).rejects.toThrow(/append-only/);
      await expect(client.query(`TRUNCATE app.audit_events`)).rejects.toThrow(/append-only/);
    });
  });
});
