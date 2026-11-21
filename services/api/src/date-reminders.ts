/**
 * Scheduled reminders before confirmed dates (P04-09, ADR-0029). Run every
 * few minutes in each environment: each run queues the reminders now due
 * into app.notification_outbox, each at most once per person; a push
 * sender delivers them.
 */
import { pgReminderQueue } from "@serendipity/db/reminders";
import pg from "pg";

import { loadApiSettings } from "./settings.js";

async function main(): Promise<void> {
  const loaded = loadApiSettings(process.env);
  if (!loaded.ok) throw new Error("invalid app configuration");
  const pool = new pg.Pool({ connectionString: loaded.settings.app.database.url, max: 2 });
  try {
    const queued = await pgReminderQueue(pool).enqueueDue(new Date(), 500);
    process.stdout.write(`date reminders queued ${String(queued)}\n`);
  } finally {
    await pool.end();
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(`date reminders failed: ${error instanceof Error ? error.name : "error"}\n`);
  process.exitCode = 1;
}
