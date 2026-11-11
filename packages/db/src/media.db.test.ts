import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { pgMediaRepository } from "./media.js";
import { migrate } from "./migrations.js";
import { createLoginRole, createTestDatabase, urlFor } from "./test-db.js";
import type { TestDatabase } from "./test-db.js";

let db: TestDatabase;
let role: Awaited<ReturnType<typeof createLoginRole>>;
let pool: pg.Pool;
let owner: string;

beforeAll(async () => {
  db = await createTestDatabase();
  await migrate(db.url, "up");
  role = await createLoginRole("serendipity_app");
  pool = new pg.Pool({ connectionString: urlFor(db.name, role) });
  const result = await pool.query<{ id: string }>(
    `INSERT INTO app.users (status) VALUES ('active') RETURNING id`,
  );
  owner = result.rows[0]?.id ?? "";
});

afterAll(async () => {
  await pool.end();
  await db.drop();
  await role.drop();
});

describe("photo metadata in PostgreSQL", () => {
  it("persists upload intent, activates once, and removes derived lineage on deletion", async () => {
    const repository = pgMediaRepository(pool);
    const id = randomUUID();
    const asset = {
      id,
      ownerUserId: owner,
      objectKey: `photos/${id}`,
      purpose: "visual_matching" as const,
      contentType: "image/jpeg",
      maxBytes: 1024,
      retentionUntil: new Date(Date.now() + 86_400_000),
      createdAt: new Date(),
      status: "pending" as const,
    };
    await repository.create(asset);
    expect(await repository.find(id)).toMatchObject({ id, ownerUserId: owner, status: "pending" });
    expect(await repository.activate(id)).toBe(true);
    expect(await repository.activate(id)).toBe(false);
    expect((await repository.reviewPage(null, 100)).map((row) => row.id)).toContain(id);
    await pool.query(`INSERT INTO app.media_derivatives (asset_id, object_key) VALUES ($1, $2)`, [
      id,
      `derived/${id}`,
    ]);
    expect(await repository.derivativeKeys(id)).toEqual([`derived/${id}`]);
    await repository.finishDeletion(id);
    expect(await repository.derivativeKeys(id)).toEqual([]);
    expect(await repository.find(id)).toMatchObject({ status: "deleted" });
    expect((await repository.reviewPage(null, 100)).map((row) => row.id)).not.toContain(id);
  });
});
