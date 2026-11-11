/** Scheduled deletion worker. Run at least once per minute in each environment. */
import { S3Client } from "@aws-sdk/client-s3";
import { createAuthorizer } from "@serendipity/consent";
import { pgAuditSink, pgGrantSource, pgMediaRepository } from "@serendipity/db";
import { createMediaService, s3PrivateMediaStorage } from "@serendipity/media";
import pg from "pg";

import { loadApiSettings } from "./settings.js";

async function main(): Promise<void> {
  const loaded = loadApiSettings(process.env);
  if (!loaded.ok) throw new Error("invalid app configuration");
  const bucket = process.env["MEDIA_BUCKET"];
  const kmsKeyId = process.env["MEDIA_KMS_KEY_ID"];
  const region = process.env["AWS_REGION"];
  if (!bucket || !kmsKeyId || !region)
    throw new Error("MEDIA_BUCKET, MEDIA_KMS_KEY_ID and AWS_REGION are required");
  const pool = new pg.Pool({ connectionString: loaded.settings.app.database.url, max: 2 });
  const client = new S3Client({ region });
  try {
    const service = createMediaService({
      repository: pgMediaRepository(pool),
      storage: s3PrivateMediaStorage({ client, bucket, kmsKeyId }),
      consent: createAuthorizer({ grants: pgGrantSource(pool), audit: pgAuditSink(pool) }),
    });
    let cursor: string | null = null;
    let removed = 0;
    do {
      const page = await service.cleanup(cursor);
      removed += page.removed;
      cursor = page.nextCursor;
    } while (cursor !== null);
    process.stdout.write(`media cleanup removed ${String(removed)} assets\n`);
  } finally {
    client.destroy();
    await pool.end();
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(
    `media cleanup failed: ${error instanceof Error ? error.name : "unknown"}\n`,
  );
  process.exitCode = 1;
}
