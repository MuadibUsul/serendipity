/** Scheduled account-deletion worker. Run at least once per minute. */
import { S3Client } from "@aws-sdk/client-s3";
import { createAuthorizer } from "@serendipity/consent";
import {
  pgAuditSink,
  pgGrantSource,
  pgMediaRepository,
  pgPrivacyRepository,
} from "@serendipity/db";
import { createMediaService, s3PrivateMediaStorage } from "@serendipity/media";
import { createPrivacyService } from "@serendipity/privacy";
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
    const repository = pgPrivacyRepository(pool);
    const media = createMediaService({
      repository: pgMediaRepository(pool),
      storage: s3PrivateMediaStorage({ client, bucket, kmsKeyId }),
      consent: createAuthorizer({ grants: pgGrantSource(pool), audit: pgAuditSink(pool) }),
    });
    const privacy = createPrivacyService({ repository, media });
    let completed = 0;
    let failed = 0;
    for (const userId of await repository.pendingDeletionUserIds(100)) {
      try {
        const result = await privacy.processDeletion(userId);
        if (result.status === "completed") completed += 1;
      } catch {
        failed += 1;
      }
    }
    process.stdout.write(
      `privacy cleanup completed ${String(completed)}, failed ${String(failed)} requests\n`,
    );
    if (failed > 0) process.exitCode = 1;
  } finally {
    client.destroy();
    await pool.end();
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(
    `privacy cleanup failed: ${error instanceof Error ? error.name : "unknown"}\n`,
  );
  process.exitCode = 1;
}
