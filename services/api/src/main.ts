// The API process: refuses to start unless @serendipity/config accepts its
// configuration, serves until SIGTERM or SIGINT, then drains and stops.
import "reflect-metadata";

import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import { formatProblems } from "@serendipity/config";
import { knownMigrations } from "@serendipity/db/migration-status";
import pg from "pg";

import { createApi } from "./app.js";
import { createLogger, revealsErrorMessages, safeError } from "./logging.js";
import { databaseReadiness } from "./readiness.js";
import { loadApiSettings } from "./settings.js";

/**
 * infra/migrations: three levels up from this file, both in the repository
 * (services/api/src/main.ts) and in the image (services/api/dist/main.js).
 */
const MIGRATIONS_DIR = fileURLToPath(new URL("../../../infra/migrations", import.meta.url));

/** After this long past the drain delay, a shutdown that has not finished exits anyway. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main(): Promise<void> {
  const loaded = loadApiSettings(process.env);
  if (!loaded.ok) {
    process.stderr.write(`${formatProblems(loaded.problems)}\n`);
    process.exit(1);
  }
  const { app: config, port, host, shutdownDelayMs } = loaded.settings;
  const logger = createLogger(config.logLevel);
  const withMessages = revealsErrorMessages(config.env);

  const known = await knownMigrations(MIGRATIONS_DIR);
  if (known.length === 0) throw new Error(`no migrations in ${MIGRATIONS_DIR}`);

  const pool = new pg.Pool({
    connectionString: config.database.url,
    application_name: "serendipity-api",
    max: 10,
    connectionTimeoutMillis: 2_000,
    query_timeout: 5_000,
    idleTimeoutMillis: 30_000,
  });
  pool.on("error", (error) => {
    logger.warn({ err: safeError(error, withMessages) }, "idle database connection failed");
  });

  const readiness = databaseReadiness(pool, known, (check, error) => {
    logger.debug({ check, err: safeError(error, withMessages) }, "readiness check failed");
  });
  const api = await createApi({ env: config.env, logger, readiness });
  await api.app.listen({ port, host });
  const address = api.app.getHttpAdapter().getInstance().addresses()[0];
  logger.info(
    { env: config.env, host, port: address?.port ?? port, migrations: known.length },
    "listening",
  );

  const stop = (signal: NodeJS.Signals): void => {
    logger.info({ signal, drain_ms: shutdownDelayMs }, "shutting down");
    api.lifecycle.drain();
    setTimeout(() => {
      logger.error("shutdown timed out");
      process.exit(1);
    }, shutdownDelayMs + SHUTDOWN_TIMEOUT_MS).unref();
    void (async () => {
      // Readiness reports draining first, so the platform stops routing here;
      // then the server stops accepting, finishes in-flight requests and closes.
      await sleep(shutdownDelayMs);
      await api.app.close();
      await pool.end();
      logger.info("stopped");
      process.exit(0);
    })().catch((error: unknown) => {
      logger.error({ err: safeError(error, withMessages) }, "shutdown failed");
      process.exit(1);
    });
  };
  // `once`: a second signal falls through to Node's default and ends the process at once.
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
}

try {
  await main();
} catch (error) {
  // Start-up failures involve no request data; the message is what an operator needs.
  const { type, message } = safeError(error, true);
  process.stderr.write(`failed to start: ${type}: ${message ?? ""}\n`);
  process.exit(1);
}
