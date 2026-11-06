// What a running process needs to know about migrations, without the migration
// runner: which ones a build ships with, and which of them a database lacks.
// Exported on its own (`@serendipity/db/migration-status`) so a service can
// check readiness without bundling node-pg-migrate.
import { readdir } from "node:fs/promises";

import type { Queryable } from "./queryable.js";

/** Where applied migrations are recorded. Also used by the `db:migrate` / `db:rollback` scripts. */
export const MIGRATIONS_SCHEMA = "public";
export const MIGRATIONS_TABLE = "schema_migrations";

/** The migrations in `dir` by name (the file name without `.sql`), in the order they apply. */
export async function knownMigrations(dir: string): Promise<string[]> {
  const files = await readdir(dir);
  return files
    .filter((file) => file.endsWith(".sql"))
    .map((file) => file.slice(0, -".sql".length))
    .sort();
}

export interface MigrationStatus {
  /** Migrations this build knows that the database has not applied. */
  readonly pending: readonly string[];
  /**
   * Migrations the database has applied that this build does not know: a newer
   * build migrated first, as every deploy does before its code rolls out.
   */
  readonly newer: readonly string[];
}

const UNDEFINED_TABLE = "42P01";

function isUndefinedTable(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "code" in error && error.code === UNDEFINED_TABLE
  );
}

/** Compares the migrations a build knows with those applied to `db`. A fresh database has none. */
export async function migrationStatus(
  db: Queryable,
  known: readonly string[],
): Promise<MigrationStatus> {
  let applied: string[];
  try {
    const { rows } = await db.query<{ name: string }>(
      `SELECT name FROM ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}`,
    );
    applied = rows.map((row) => row.name);
  } catch (error) {
    if (!isUndefinedTable(error)) throw error;
    applied = [];
  }
  const appliedSet = new Set(applied);
  const knownSet = new Set(known);
  return {
    pending: known.filter((name) => !appliedSet.has(name)),
    newer: applied.filter((name) => !knownSet.has(name)).sort(),
  };
}
