/**
 * Delivers queued notifications as push notifications (ADR-0030). Run every
 * minute in each environment, after `npm run dates:remind`.
 *
 * PUSH_PROVIDER picks the sender: `expo` (the Expo push service; set
 * EXPO_ACCESS_TOKEN if enhanced push security is on), or `fake` (dev and
 * test: nothing leaves the machine). With no provider set, nothing is sent
 * and the outbox waits.
 */
import { pgOutboxStore } from "@serendipity/db/push";
import { createExpoPushSender, createFakePushSender, deliverOutbox } from "@serendipity/notify";
import type { PushSender } from "@serendipity/notify";
import pg from "pg";

import { loadApiSettings } from "./settings.js";

function senderFor(env: string, provider: string | undefined): PushSender | null {
  if (provider === "expo") {
    const accessToken = process.env["EXPO_ACCESS_TOKEN"];
    return createExpoPushSender(accessToken ? { accessToken } : {});
  }
  if (provider === "fake" || ((provider ?? "") === "" && (env === "dev" || env === "test"))) {
    if (env !== "dev" && env !== "test")
      throw new Error("the fake push sender is for dev and test");
    return createFakePushSender();
  }
  if ((provider ?? "") === "") return null;
  throw new Error(`unknown PUSH_PROVIDER "${provider ?? ""}"`);
}

async function main(): Promise<void> {
  const loaded = loadApiSettings(process.env);
  if (!loaded.ok) throw new Error("invalid app configuration");
  const sender = senderFor(loaded.settings.app.env, process.env["PUSH_PROVIDER"]);
  if (sender === null) {
    process.stdout.write("notifications: no PUSH_PROVIDER set, nothing sent\n");
    return;
  }
  const pool = new pg.Pool({ connectionString: loaded.settings.app.database.url, max: 2 });
  try {
    const report = await deliverOutbox(pgOutboxStore(pool), sender, 500);
    process.stdout.write(
      `notifications via ${sender.name}: sent ${String(report.sent)}, failed ${String(report.failed)}, no device ${String(report.noDevice)}, devices forgotten ${String(report.tokensForgotten)}\n`,
    );
    if (report.failed > 0) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(
    `notifications failed: ${error instanceof Error ? error.message : "error"}\n`,
  );
  process.exitCode = 1;
}
