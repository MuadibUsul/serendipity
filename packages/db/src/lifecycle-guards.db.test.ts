// The lifecycle guards (migration 0009) against their TypeScript tables:
// for every table, every ordered pair of distinct states is tried as the
// application role, and the database must allow exactly the declared edges.
import type { Lifecycle } from "@serendipity/domain";
import { INVITE_LIFECYCLE } from "@serendipity/invitations";
import { MEDIA_LIFECYCLE } from "@serendipity/media";
import { VERSION_LIFECYCLE } from "@serendipity/profile";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrate } from "./migrations.js";
import { createLoginRole, createTestDatabase, urlFor } from "./test-db.js";
import type { TestDatabase } from "./test-db.js";

let db: TestDatabase;
let role: Awaited<ReturnType<typeof createLoginRole>>;
let admin: pg.Pool;
let app: pg.Pool;

beforeAll(async () => {
  db = await createTestDatabase();
  await migrate(db.url, "up");
  role = await createLoginRole("serendipity_app");
  admin = new pg.Pool({ connectionString: db.url });
  app = new pg.Pool({ connectionString: urlFor(db.name, role) });
});

afterAll(async () => {
  await app.end();
  await admin.end();
  await db.drop();
  await role.drop();
});

async function newUser(): Promise<string> {
  const { rows } = await admin.query<{ id: string }>(
    "INSERT INTO app.users (status) VALUES ('active') RETURNING id",
  );
  return rows[0]?.id ?? "";
}

/** How to put a row in a state, and how to try moving it. */
interface Table<S extends string> {
  readonly lifecycle: Lifecycle<S>;
  insert(state: S): Promise<string>;
  update(id: string, to: S): Promise<unknown>;
}

const RESPONDED = new Set(["accepted", "declined"]);

const invites: Table<(typeof INVITE_LIFECYCLE.states)[number]> = {
  lifecycle: INVITE_LIFECYCLE,
  async insert(state) {
    const [a, b] = [await newUser(), await newUser()];
    const { rows } = await admin.query<{ id: string }>(
      "INSERT INTO app.dates (user_a, user_b) VALUES ($1, $2) RETURNING id",
      [a, b],
    );
    const invite = await admin.query<{ id: string }>(
      `INSERT INTO app.date_invites (date_id, user_id, status, responded_at, expires_at)
       VALUES ($1, $2, $3, $4, now() + interval '1 day') RETURNING id`,
      [rows[0]?.id, a, state, RESPONDED.has(state) ? new Date() : null],
    );
    return invite.rows[0]?.id ?? "";
  },
  update: (id, to) =>
    app.query(
      `UPDATE app.date_invites
       SET status = $2, responded_at = CASE WHEN $3 THEN coalesce(responded_at, now()) END
       WHERE id = $1`,
      [id, to, RESPONDED.has(to)],
    ),
};

const versions: Table<(typeof VERSION_LIFECYCLE.states)[number]> = {
  lifecycle: VERSION_LIFECYCLE,
  async insert(state) {
    const { rows } = await admin.query<{ id: string }>(
      `INSERT INTO app.profile_versions (user_id, version, approval_state, approved_at)
       VALUES ($1, 1, $2, now()) RETURNING id`,
      [await newUser(), state],
    );
    return rows[0]?.id ?? "";
  },
  update: (id, to) =>
    app.query("UPDATE app.profile_versions SET approval_state = $2 WHERE id = $1", [id, to]),
};

const media: Table<(typeof MEDIA_LIFECYCLE.states)[number]> = {
  lifecycle: MEDIA_LIFECYCLE,
  async insert(state) {
    const { rows } = await admin.query<{ id: string }>(
      `INSERT INTO app.media_assets (owner_user_id, object_key, purpose, retention_until, status)
       VALUES ($1, 'photos/' || gen_random_uuid(), 'visual_matching', now() + interval '1 day', $2)
       RETURNING id`,
      [await newUser(), state],
    );
    return rows[0]?.id ?? "";
  },
  update: (id, to) => app.query("UPDATE app.media_assets SET status = $2 WHERE id = $1", [id, to]),
};

async function attempt(update: () => Promise<unknown>): Promise<"allowed" | "refused"> {
  try {
    await update();
    return "allowed";
  } catch (error) {
    // Only the guard's refusal counts; any other failure is a broken test.
    if ((error as { code?: string }).code !== "23514") throw error;
    expect((error as Error).message).toMatch(/is not an allowed move/);
    return "refused";
  }
}

describe.each([
  ["app.date_invites.status", invites],
  ["app.profile_versions.approval_state", versions],
  ["app.media_assets.status", media],
] as const)("%s", (_name, table: Table<string>) => {
  it("allows exactly the moves its lifecycle declares", async () => {
    const { lifecycle } = table;
    const seen: Record<string, "allowed" | "refused"> = {};
    const want: Record<string, "allowed" | "refused"> = {};
    for (const from of lifecycle.states) {
      for (const to of lifecycle.states) {
        if (from === to) continue;
        const id = await table.insert(from);
        seen[`${from}>${to}`] = await attempt(() => table.update(id, to));
        want[`${from}>${to}`] = lifecycle.can(from, to) ? "allowed" : "refused";
      }
    }
    expect(seen).toEqual(want);
  });

  it("never refuses staying in the same state", async () => {
    for (const state of table.lifecycle.states) {
      const id = await table.insert(state);
      expect(await attempt(() => table.update(id, state))).toBe("allowed");
    }
  });
});
