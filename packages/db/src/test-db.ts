// Throwaway databases for the *.db.test.ts suites (`@serendipity/db/test-db`); for tests only.
import { randomUUID } from "node:crypto";

import pg from "pg";

/** A superuser connection to a maintenance database, e.g. postgresql://…/postgres. */
export function adminUrl(): string {
  const url = process.env["DATABASE_URL"];
  if (url === undefined || url === "") {
    throw new Error(
      "DATABASE_URL is not set: point it at a PostgreSQL 17 + PostGIS + pgvector server " +
        "(see infra/postgres/install-ubuntu.sh)",
    );
  }
  return url;
}

export function urlFor(database: string, user?: { name: string; password: string }): string {
  const url = new URL(adminUrl());
  url.pathname = `/${database}`;
  if (user !== undefined) {
    url.username = user.name;
    url.password = user.password;
  }
  return url.toString();
}

/** Runs `fn` with a client connected to `url`, then disconnects. */
export async function withClient<T>(
  url: string,
  fn: (client: pg.Client) => Promise<T>,
): Promise<T> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export interface TestDatabase {
  readonly name: string;
  readonly url: string;
  drop(): Promise<void>;
}

/** Creates an empty database with a random name; `drop()` removes it. */
export async function createTestDatabase(): Promise<TestDatabase> {
  const name = `serendipity_test_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  await withClient(adminUrl(), (client) => client.query(`CREATE DATABASE ${name}`));
  return {
    name,
    url: urlFor(name),
    drop: async () => {
      await withClient(adminUrl(), (client) =>
        client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`),
      );
    },
  };
}

/** A login role for the duration of a suite; `drop()` removes it after its database is gone. */
export async function createLoginRole(memberOf: string | null): Promise<{
  name: string;
  password: string;
  drop(): Promise<void>;
}> {
  const name = `serendipity_test_role_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const password = randomUUID();
  await withClient(adminUrl(), async (client) => {
    await client.query(`CREATE ROLE ${name} LOGIN PASSWORD '${password}'`);
    if (memberOf !== null) await client.query(`GRANT ${memberOf} TO ${name}`);
  });
  return {
    name,
    password,
    drop: async () => {
      await withClient(adminUrl(), (client) => client.query(`DROP ROLE IF EXISTS ${name}`));
    },
  };
}

/**
 * Everything the migrations create, as comparable text: extensions, the app
 * schema with its columns, constraints, indexes, functions, triggers and
 * grants, default privileges, and the applied-migrations list.
 */
export async function fingerprint(client: pg.Client): Promise<Record<string, unknown>> {
  const sections: Record<string, string> = {
    extensions: `SELECT extname FROM pg_extension WHERE extname <> 'plpgsql' ORDER BY 1`,
    schemas: `SELECT nspname FROM pg_namespace WHERE nspname = 'app'`,
    columns: `SELECT format('%s.%s %s %s %s', table_name, column_name, udt_name, is_nullable, column_default)
              FROM information_schema.columns WHERE table_schema = 'app' ORDER BY table_name, ordinal_position`,
    constraints: `SELECT format('%s.%s %s', cl.relname, c.conname, pg_get_constraintdef(c.oid))
                  FROM pg_constraint c JOIN pg_class cl ON cl.oid = c.conrelid
                  JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'app' ORDER BY 1`,
    indexes: `SELECT indexdef FROM pg_indexes WHERE schemaname = 'app' ORDER BY indexname`,
    functions: `SELECT pg_get_functiondef(p.oid) FROM pg_proc p
                JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'app' ORDER BY p.proname`,
    triggers: `SELECT pg_get_triggerdef(t.oid) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
               JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'app' AND NOT t.tgisinternal ORDER BY t.tgname`,
    grants: `SELECT format('%s %s %s', table_name, grantee, privilege_type)
             FROM information_schema.role_table_grants WHERE table_schema = 'app' ORDER BY 1`,
    defaultAcl: `SELECT format('%s %s', defaclobjtype, defaclacl) FROM pg_default_acl ORDER BY 1`,
  };
  const result: Record<string, unknown> = {};
  for (const [key, sql] of Object.entries(sections)) {
    const rows = await client.query<Record<string, string>>(sql);
    result[key] = rows.rows.map((row) => Object.values(row).join(" "));
  }
  const table = await client.query<{ exists: boolean }>(
    `SELECT to_regclass('public.schema_migrations') IS NOT NULL AS exists`,
  );
  result["migrations"] = table.rows[0]?.exists
    ? (
        await client.query<{ name: string }>(
          `SELECT name FROM public.schema_migrations ORDER BY id`,
        )
      ).rows.map((row) => row.name)
    : [];
  return result;
}
