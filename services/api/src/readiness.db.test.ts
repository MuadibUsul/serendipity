// Readiness against a real PostgreSQL 17 + PostGIS + pgvector server.
import { MIGRATIONS_DIR, migrate } from "@serendipity/db";
import { knownMigrations } from "@serendipity/db/migration-status";
import { createLoginRole, createTestDatabase, urlFor } from "@serendipity/db/test-db";
import type { TestDatabase } from "@serendipity/db/test-db";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { databaseReadiness, isReady } from "./readiness.js";
import type { ReadinessChecks } from "./readiness.js";
import { testApi } from "./test-support.js";

describe("databaseReadiness", () => {
  let db: TestDatabase;
  let pool: pg.Pool;
  let known: string[];
  const failures: (keyof ReadinessChecks)[] = [];
  const readiness = () =>
    databaseReadiness(pool, known, (check) => {
      failures.push(check);
    });

  beforeAll(async () => {
    db = await createTestDatabase();
    pool = new pg.Pool({ connectionString: db.url });
    known = await knownMigrations(MIGRATIONS_DIR);
  });
  afterAll(async () => {
    await pool.end();
    await db.drop();
  });

  it("finds a database that was never migrated behind on every migration", async () => {
    const result = await readiness().check();
    expect(result).toEqual({
      checks: { database: "ok", migrations: "behind" },
      pendingMigrations: known.length,
      newerMigrations: 0,
    });
    expect(isReady(result)).toBe(false);
  });

  it("counts down as migrations are applied, and is ready when all are", async () => {
    await migrate(db.url, "up", 2);
    expect((await readiness().check()).pendingMigrations).toBe(known.length - 2);

    await migrate(db.url, "up");
    const result = await readiness().check();
    expect(result.checks).toEqual({ database: "ok", migrations: "current" });
    expect(isReady(result)).toBe(true);
  });

  it("stays ready when a newer build has migrated first", async () => {
    await pool.query(
      `INSERT INTO public.schema_migrations (name, run_on) VALUES ('9999_from_a_newer_build', now())`,
    );
    try {
      const result = await readiness().check();
      expect(result).toMatchObject({ pendingMigrations: 0, newerMigrations: 1 });
      expect(isReady(result)).toBe(true);
    } finally {
      await pool.query(
        `DELETE FROM public.schema_migrations WHERE name = '9999_from_a_newer_build'`,
      );
    }
  });

  it("serves 200 on /readyz for the migrated database and 503 for a fresh one", async () => {
    const migrated = await testApi(readiness());
    try {
      const response = await migrated.app.inject({ method: "GET", url: "/readyz" });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ status: "ready", migrations: { pending: 0 } });
    } finally {
      await migrated.app.close();
    }

    const fresh = await createTestDatabase();
    const freshPool = new pg.Pool({ connectionString: fresh.url });
    const api = await testApi(databaseReadiness(freshPool, known, () => undefined));
    try {
      const response = await api.app.inject({ method: "GET", url: "/readyz" });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({
        status: "not_ready",
        checks: { database: "ok", migrations: "behind" },
        migrations: { pending: known.length },
      });
    } finally {
      await api.app.close();
      await freshPool.end();
      await fresh.drop();
    }
  });

  it("reports migrations unchecked when it may not read them", async () => {
    const role = await createLoginRole(null);
    const rolePool = new pg.Pool({ connectionString: urlFor(db.name, role) });
    const seen: (keyof ReadinessChecks)[] = [];
    try {
      const result = await databaseReadiness(rolePool, known, (check) => {
        seen.push(check);
      }).check();
      expect(result.checks).toEqual({ database: "ok", migrations: "unchecked" });
      expect(isReady(result)).toBe(false);
      expect(seen).toEqual(["migrations"]);
    } finally {
      await rolePool.end();
      await role.drop();
    }
  });

  it("reports the database unreachable when nothing answers", async () => {
    const url = new URL(db.url);
    url.port = "1";
    const nowhere = new pg.Pool({
      connectionString: url.toString(),
      connectionTimeoutMillis: 2_000,
    });
    const seen: (keyof ReadinessChecks)[] = [];
    try {
      const result = await databaseReadiness(nowhere, known, (check) => {
        seen.push(check);
      }).check();
      expect(result.checks).toEqual({ database: "unreachable", migrations: "unchecked" });
      expect(seen).toEqual(["database"]);
    } finally {
      await nowhere.end();
    }
    expect(failures).toEqual([]);
  });
});
