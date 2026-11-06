import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type pg from "pg";
import { describe, expect, it } from "vitest";

import { knownMigrations, migrationStatus } from "./migration-status.js";
import { MIGRATIONS_DIR } from "./migrations.js";
import type { Queryable } from "./queryable.js";

function database(answer: () => string[]): Queryable {
  return {
    query: <Row extends pg.QueryResultRow>() =>
      Promise.resolve({
        rows: answer().map((name) => ({ name })),
      } as unknown as pg.QueryResult<Row>),
  };
}

const failing = (error: unknown): Queryable =>
  database(() => {
    throw error;
  });

describe("knownMigrations", () => {
  it("lists infra/migrations by name, in order", async () => {
    const names = await knownMigrations(MIGRATIONS_DIR);
    expect(names.length).toBeGreaterThanOrEqual(6);
    expect(names[0]).toBe("0001_foundation");
    expect(names).toEqual([...names].sort());
    expect(names.every((name) => /^\d{4}_[a-z0-9_]+$/.test(name))).toBe(true);
  });

  it("counts only .sql files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "migrations-"));
    try {
      for (const file of ["0002_b.sql", "README.md", "0001_a.sql", "0003_c.sql.bak"]) {
        await writeFile(join(dir, file), "");
      }
      expect(await knownMigrations(dir)).toEqual(["0001_a", "0002_b"]);
    } finally {
      await rm(dir, { recursive: true });
    }
  });
});

describe("migrationStatus", () => {
  const known = ["0001_a", "0002_b", "0003_c"];

  it("lists what the database lacks, in order", async () => {
    const partly = database(() => ["0001_a"]);
    expect(await migrationStatus(partly, known)).toEqual({
      pending: ["0002_b", "0003_c"],
      newer: [],
    });
  });

  it("is current when every known migration is applied, newer ones aside", async () => {
    const applied = ["0001_a", "0002_b", "0003_c", "0005_e", "0004_d"];
    const ahead = database(() => applied);
    expect(await migrationStatus(ahead, known)).toEqual({
      pending: [],
      newer: ["0004_d", "0005_e"],
    });
  });

  it("treats a database that was never migrated as lacking everything", async () => {
    expect(await migrationStatus(failing({ code: "42P01" }), known)).toEqual({
      pending: known,
      newer: [],
    });
  });

  it("passes any other failure on", async () => {
    await expect(migrationStatus(failing({ code: "42501" }), known)).rejects.toEqual({
      code: "42501",
    });
  });
});
