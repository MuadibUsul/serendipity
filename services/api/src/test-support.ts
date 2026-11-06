// Helpers for the API's test suites.
import type { Environment } from "@serendipity/config";

import { createApi } from "./app.js";
import type { Api } from "./app.js";
import { createLogger } from "./logging.js";
import type { ReadinessResult, Readiness } from "./readiness.js";

export type LogLine = Record<string, unknown>;

/** A debug-level logger whose lines are kept, parsed, and also as raw text. */
export function captureLogs(): {
  logger: ReturnType<typeof createLogger>;
  lines: LogLine[];
  text: () => string;
} {
  const raw: string[] = [];
  const lines: LogLine[] = [];
  const logger = createLogger("debug", {
    write(chunk: string) {
      raw.push(chunk);
      for (const line of chunk.split("\n")) {
        if (line !== "") lines.push(JSON.parse(line) as LogLine);
      }
    },
  });
  return { logger, lines, text: () => raw.join("") };
}

export const READY: ReadinessResult = {
  checks: { database: "ok", migrations: "current" },
  pendingMigrations: 0,
  newerMigrations: 0,
};

/** Readiness that always answers `result` and counts how often it was asked. */
export function fixedReadiness(result: ReadinessResult): Readiness & { calls: number } {
  const readiness = {
    calls: 0,
    check(): Promise<ReadinessResult> {
      readiness.calls += 1;
      return Promise.resolve(result);
    },
  };
  return readiness;
}

export async function testApi(
  readiness: Readiness,
  env: Environment = "test",
): Promise<Api & ReturnType<typeof captureLogs>> {
  const logs = captureLogs();
  const api = await createApi({ env, logger: logs.logger, readiness });
  return { ...api, ...logs };
}
