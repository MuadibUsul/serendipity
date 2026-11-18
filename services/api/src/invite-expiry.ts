/**
 * Scheduled expiry of date invitations (ser-p04-02). Run at least once per
 * minute in each environment. Answers past the deadline are refused even
 * between runs; this job moves the dates to EXPIRED and their pending
 * invitations to expired, each audited.
 */
import { pgInvitationRepository } from "@serendipity/db";
import pg from "pg";

import { loadApiSettings } from "./settings.js";

async function main(): Promise<void> {
  const loaded = loadApiSettings(process.env);
  if (!loaded.ok) throw new Error("invalid app configuration");
  const pool = new pg.Pool({ connectionString: loaded.settings.app.database.url, max: 2 });
  try {
    const invitations = pgInvitationRepository(pool);
    let expired = 0;
    let batch: number;
    do {
      batch = await invitations.expireDue(new Date(), 100);
      expired += batch;
    } while (batch === 100);
    process.stdout.write(`invite expiry closed ${String(expired)} dates\n`);
  } finally {
    await pool.end();
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(`invite expiry failed: ${error instanceof Error ? error.name : "error"}\n`);
  process.exitCode = 1;
}
