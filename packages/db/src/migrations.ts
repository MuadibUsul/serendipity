import { fileURLToPath } from "node:url";

import { runner } from "node-pg-migrate";

/** The SQL migrations, one file per migration with `-- Up Migration` and `-- Down Migration`. */
export const MIGRATIONS_DIR = fileURLToPath(new URL("../../../infra/migrations", import.meta.url));

/** Where applied migrations are recorded. Also used by the `db:migrate` / `db:rollback` scripts. */
export const MIGRATIONS_SCHEMA = "public";
export const MIGRATIONS_TABLE = "schema_migrations";

/**
 * Applies (`up`) or rolls back (`down`) `count` migrations, each pending batch
 * in one transaction. `count` defaults to all of them.
 */
export async function migrate(
  databaseUrl: string,
  direction: "up" | "down",
  count = Number.POSITIVE_INFINITY,
): Promise<string[]> {
  const applied = await runner({
    databaseUrl,
    dir: MIGRATIONS_DIR,
    direction,
    count,
    migrationsSchema: MIGRATIONS_SCHEMA,
    migrationsTable: MIGRATIONS_TABLE,
    checkOrder: true,
    singleTransaction: true,
    log: () => undefined,
  });
  return applied.map((migration) => migration.name);
}
