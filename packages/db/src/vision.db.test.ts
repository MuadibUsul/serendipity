import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { pgMediaRepository } from "./media.js";
import { migrate } from "./migrations.js";
import { createLoginRole, createTestDatabase, urlFor } from "./test-db.js";
import type { TestDatabase } from "./test-db.js";
import { pgVisionRepository } from "./vision.js";

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

describe("visual features in PostgreSQL", () => {
  it("stores only allowed columns, excludes inactive photos and removes features on cleanup", async () => {
    const media = pgMediaRepository(pool);
    const vision = pgVisionRepository(pool);
    const id = randomUUID();
    await media.create({
      id,
      ownerUserId: owner,
      objectKey: `photos/${id}`,
      purpose: "visual_matching",
      contentType: "image/jpeg",
      maxBytes: 100,
      createdAt: new Date(),
      retentionUntil: new Date(Date.now() + 86_400_000),
      status: "pending",
    });
    const snapshot = {
      assetId: id,
      ownerUserId: owner,
      role: "reference" as const,
      preference: "like" as const,
      features: {
        hair_length: { value: "short" as const, confidence: 0.8 },
        clothing_style: { value: "casual" as const, confidence: 0.6 },
        photo_style: { value: "outdoor" as const, confidence: 0.7 },
      },
    };
    await vision.save(snapshot);
    expect(await vision.activeForOwner(owner)).toEqual([]);
    expect(await media.activate(id)).toBe(true);
    expect(await vision.activeForOwner(owner)).toMatchObject([snapshot]);
    await media.finishDeletion(id);
    expect(await vision.activeForOwner(owner)).toEqual([]);
    const result = await pool.query(
      `SELECT count(*)::int AS count FROM app.visual_feature_snapshots WHERE asset_id = $1`,
      [id],
    );
    expect(result.rows[0]).toEqual({ count: 0 });
  });
});
