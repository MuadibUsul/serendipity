import { readFileSync, readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { DEV_PASSWORD, ENVIRONMENTS, FEATURE_FLAGS, loadConfig, requireConfig } from "./config.js";
import type { Environment } from "./config.js";

const ENVIRONMENTS_DIR = new URL("../../../infra/environments/", import.meta.url);

interface Definition {
  env: Environment;
  database: { name: string; host: string | null; port: number; sslmode: string | null };
  secret_store: string;
  features: Record<string, boolean>;
}

const definitions: Definition[] = readdirSync(ENVIRONMENTS_DIR)
  .filter((file) => file.endsWith(".json"))
  .map((file) => JSON.parse(readFileSync(new URL(file, ENVIRONMENTS_DIR), "utf8")) as Definition);

/** The variables a process of `definition`'s environment would get; deploy-time values stand in where unset. */
function variablesFor(
  definition: Definition,
  password = "not-the-dev-password",
): Record<string, string> {
  const { name, host, port, sslmode } = definition.database;
  const url = new URL(
    `postgresql://serendipity_app:${password}@${host ?? `db.${definition.env}.example.invalid`}:${String(port)}/${name}`,
  );
  if (sslmode !== null) url.searchParams.set("sslmode", sslmode);
  return {
    APP_ENV: definition.env,
    DATABASE_URL: url.toString(),
    SECRET_STORE: definition.secret_store,
  };
}

const staging = { APP_ENV: "staging", SECRET_STORE: "secret-store://serendipity-staging" };
const stagingDb =
  "postgresql://serendipity_app:s3cret@db.example.invalid:5432/serendipity_staging?sslmode=verify-full";

function problemsOf(source: Record<string, string>): string[] {
  const result = loadConfig(source);
  return result.ok
    ? []
    : result.problems.map((problem) => `${problem.variable}: ${problem.message}`);
}

describe("environment definitions (infra/environments)", () => {
  it("define exactly the known environments", () => {
    expect(definitions.map((definition) => definition.env).sort()).toEqual(
      [...ENVIRONMENTS].sort(),
    );
  });

  it.each(definitions.map((definition) => [definition.env, definition] as const))(
    "%s is a configuration packages/config accepts",
    (_env, definition) => {
      expect(problemsOf(variablesFor(definition))).toEqual([]);
    },
  );

  it("never share a database or a secret store between dev, staging and prod", () => {
    const isolated = definitions.filter((definition) => definition.env !== "test");
    const databases = isolated.map((definition) => definition.database.name);
    const stores = isolated
      .filter((definition) => ["staging", "prod"].includes(definition.env))
      .map((definition) => definition.secret_store);
    expect(new Set(databases).size).toBe(databases.length);
    expect(new Set(stores).size).toBe(stores.length);
  });

  it("refuse each environment's database and secret store to every other environment", () => {
    for (const owner of definitions) {
      for (const other of definitions) {
        if (owner.env === other.env) continue;
        const borrowed = { ...variablesFor(owner), APP_ENV: other.env };
        const sharesStore = owner.secret_store === other.secret_store;
        const problems = problemsOf(borrowed);
        expect(problems, `${other.env} using ${owner.env}'s database`).not.toEqual([]);
        if (!sharesStore)
          expect(problems.join(" "), `${other.env} using ${owner.env}'s secrets`).toMatch(
            /SECRET_STORE|DATABASE_URL/,
          );
      }
    }
  });

  it("switch every feature flag off", () => {
    for (const definition of definitions) {
      expect(Object.keys(definition.features).sort()).toEqual(Object.keys(FEATURE_FLAGS).sort());
      expect(Object.values(definition.features).every((on) => !on)).toBe(true);
    }
  });
});

describe("deployed environments refuse unsafe databases", () => {
  it("accepts a proper staging configuration", () => {
    expect(problemsOf({ ...staging, DATABASE_URL: stagingDb })).toEqual([]);
  });

  it.each([
    [
      "a local host",
      "postgresql://serendipity_app:s3cret@127.0.0.1:5432/serendipity_staging?sslmode=require",
      /local database host/,
    ],
    [
      "the Compose host",
      "postgresql://serendipity_app:s3cret@postgres:5432/serendipity_staging?sslmode=require",
      /local database host/,
    ],
    [
      "no TLS",
      "postgresql://serendipity_app:s3cret@db.example.invalid:5432/serendipity_staging",
      /TLS/,
    ],
    [
      "sslmode=prefer",
      "postgresql://serendipity_app:s3cret@db.example.invalid:5432/serendipity_staging?sslmode=prefer",
      /TLS/,
    ],
    [
      "the dev database",
      "postgresql://serendipity_app:s3cret@db.example.invalid:5432/serendipity_dev?sslmode=require",
      /must use the database "serendipity_staging"/,
    ],
    [
      "the prod database",
      "postgresql://serendipity_app:s3cret@db.example.invalid:5432/serendipity_prod?sslmode=require",
      /must use the database "serendipity_staging"/,
    ],
    [
      "a prod host",
      "postgresql://serendipity_app:s3cret@prod-db.example.invalid:5432/serendipity_staging?sslmode=require",
      /host named for prod/,
    ],
    [
      "a fixture host",
      "postgresql://serendipity_app:s3cret@fixture.example.invalid:5432/serendipity_staging?sslmode=require",
      /fixture/,
    ],
    [
      "the dev password",
      `postgresql://serendipity_app:${DEV_PASSWORD}@db.example.invalid:5432/serendipity_staging?sslmode=require`,
      /development password/,
    ],
  ])("refuses %s", (_case, url, problem) => {
    expect(problemsOf({ ...staging, DATABASE_URL: url }).join("\n")).toMatch(problem);
  });

  it("refuses another environment's secret store, a local one, or none", () => {
    expect(
      problemsOf({
        ...staging,
        DATABASE_URL: stagingDb,
        SECRET_STORE: "secret-store://serendipity-prod",
      }).join("\n"),
    ).toMatch(/prod's secret store/);
    expect(
      problemsOf({ ...staging, DATABASE_URL: stagingDb, SECRET_STORE: "env://local" }).join("\n"),
    ).toMatch(/managed secret store/);
    expect(problemsOf({ APP_ENV: "staging", DATABASE_URL: stagingDb }).join("\n")).toMatch(
      /SECRET_STORE: is required/,
    );
  });

  it("keeps dev and test away from deployed secrets and databases", () => {
    const local = "postgresql://serendipity:serendipity@127.0.0.1:5432/serendipity_dev";
    expect(problemsOf({ APP_ENV: "dev", DATABASE_URL: local })).toEqual([]);
    expect(
      problemsOf({
        APP_ENV: "dev",
        DATABASE_URL: local,
        SECRET_STORE: "secret-store://serendipity-prod",
      }).join("\n"),
    ).toMatch(/must not read prod secrets/);
    expect(
      problemsOf({
        APP_ENV: "dev",
        DATABASE_URL: "postgresql://u:p@prod.example.invalid:5432/serendipity_dev",
      }).join("\n"),
    ).toMatch(/host named for prod/);
    expect(
      problemsOf({
        APP_ENV: "test",
        DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/serendipity_test_abc123",
      }),
    ).toEqual([]);
  });
});

describe("parsing", () => {
  it("requires a known APP_ENV", () => {
    expect(problemsOf({ DATABASE_URL: stagingDb })).toEqual([expect.stringMatching(/^APP_ENV/)]);
    expect(problemsOf({ APP_ENV: "production", DATABASE_URL: stagingDb })).toEqual([
      expect.stringMatching(/^APP_ENV/),
    ]);
  });

  it("requires a postgresql DATABASE_URL", () => {
    expect(problemsOf({ APP_ENV: "dev" }).join("\n")).toMatch(/DATABASE_URL: is required/);
    expect(problemsOf({ APP_ENV: "dev", DATABASE_URL: "mysql://u:p@h/db" }).join("\n")).toMatch(
      /postgresql/,
    );
    expect(problemsOf({ APP_ENV: "dev", DATABASE_URL: "not a url" }).join("\n")).toMatch(
      /not a URL/,
    );
  });

  it("parses feature flags strictly and defaults them off", () => {
    const base = {
      APP_ENV: "dev",
      DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/serendipity_dev",
    };
    const result = loadConfig({ ...base, FEATURE_LIVE_CHAT: "true" });
    expect(result.ok && result.config.features).toEqual({
      visualMatching: false,
      a2aNegotiation: false,
      paidBooking: false,
      liveChat: true,
    });
    expect(problemsOf({ ...base, FEATURE_PAID_BOOKING: "yes" }).join("\n")).toMatch(
      /FEATURE_PAID_BOOKING/,
    );
  });

  it("refuses debug logging in prod", () => {
    const prod = {
      APP_ENV: "prod",
      DATABASE_URL:
        "postgresql://serendipity_app:s3cret@db.example.invalid:5432/serendipity_prod?sslmode=verify-full",
      SECRET_STORE: "secret-store://serendipity-prod",
    };
    expect(problemsOf(prod)).toEqual([]);
    expect(problemsOf({ ...prod, LOG_LEVEL: "debug" }).join("\n")).toMatch(/debug/);
  });

  it("reports every problem at once, and requireConfig throws them together", () => {
    const source = {
      APP_ENV: "prod",
      DATABASE_URL: "postgresql://serendipity:serendipity@localhost/serendipity_dev",
    };
    expect(problemsOf(source).length).toBeGreaterThanOrEqual(5);
    expect(() => requireConfig(source)).toThrow(/invalid configuration:\n {2}DATABASE_URL/);
  });
});
