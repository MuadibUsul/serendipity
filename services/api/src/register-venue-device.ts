/**
 * Registers a venue's scanning device (ADR-0028) and prints its key once.
 *
 *   npm run venue:device -- <venue-id> "<label>"
 *
 * The key is stored only as a keyed hash: if it is lost, register a new
 * device and revoke the old one. Run by ops, against the environment's
 * database, with its AUTH_SECRET.
 */
import { deviceKeyHash, newDeviceKey } from "@serendipity/checkin";
import { pgCheckinRepository } from "@serendipity/db/checkin";
import pg from "pg";

import { loadApiSettings } from "./settings.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function main(): Promise<void> {
  const [venueId = "", label = ""] = process.argv.slice(2);
  if (!UUID.test(venueId) || label.trim() === "" || label.length > 60) {
    throw new Error('usage: npm run venue:device -- <venue-id> "<label, up to 60 characters>"');
  }
  const loaded = loadApiSettings(process.env);
  if (!loaded.ok) throw new Error("invalid app configuration");
  const pool = new pg.Pool({ connectionString: loaded.settings.app.database.url, max: 1 });
  try {
    const key = newDeviceKey();
    const secret = `checkin:${loaded.settings.authSecret}`;
    const id = await pgCheckinRepository(pool).registerDevice(
      venueId,
      label.trim(),
      deviceKeyHash(secret, key),
    );
    process.stdout.write(`device ${id}\nkey ${key}\n(shown once: enter it on the device now)\n`);
  } finally {
    await pool.end();
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "failed"}\n`);
  process.exitCode = 1;
}
