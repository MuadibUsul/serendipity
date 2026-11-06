import type { Queryable } from "@serendipity/db";
import { migrationStatus } from "@serendipity/db/migration-status";

export interface ReadinessChecks {
  readonly database: "ok" | "unreachable" | "unchecked";
  readonly migrations: "current" | "behind" | "unchecked";
}

export interface ReadinessResult {
  readonly checks: ReadinessChecks;
  /** Migrations this build expects that the database lacks. */
  readonly pendingMigrations: number;
  /** Migrations applied by a newer build; harmless, since deploys migrate before code rolls out. */
  readonly newerMigrations: number;
}

export interface Readiness {
  check(): Promise<ReadinessResult>;
}

export const NOT_CHECKED: ReadinessResult = {
  checks: { database: "unchecked", migrations: "unchecked" },
  pendingMigrations: 0,
  newerMigrations: 0,
};

/** Ready to serve: the database answers and has every migration this build expects. */
export function isReady(result: ReadinessResult): boolean {
  return result.checks.database === "ok" && result.checks.migrations === "current";
}

/**
 * Readiness against a real database. `known` is the migrations this build
 * ships with; `onError` hears why a check failed (to log it safely).
 */
export function databaseReadiness(
  db: Queryable,
  known: readonly string[],
  onError: (check: keyof ReadinessChecks, error: unknown) => void,
): Readiness {
  return {
    async check() {
      try {
        await db.query("SELECT 1");
      } catch (error) {
        onError("database", error);
        return { ...NOT_CHECKED, checks: { database: "unreachable", migrations: "unchecked" } };
      }
      try {
        const status = await migrationStatus(db, known);
        return {
          checks: {
            database: "ok",
            migrations: status.pending.length === 0 ? "current" : "behind",
          },
          pendingMigrations: status.pending.length,
          newerMigrations: status.newer.length,
        };
      } catch (error) {
        onError("migrations", error);
        return { ...NOT_CHECKED, checks: { database: "ok", migrations: "unchecked" } };
      }
    },
  };
}
