import { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";

import { s3PrivateMediaStorage } from "./s3.js";

describe("private S3 upload policy", () => {
  it("signs a one-minute, size-bound POST requiring the KMS key and no public ACL", async () => {
    const client = new S3Client({
      region: "us-east-1",
      endpoint: "https://s3.private.invalid",
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
    });
    const storage = s3PrivateMediaStorage({
      client,
      bucket: "private-photos",
      kmsKeyId: "kms-test-key",
    });
    const form = await storage.uploadForm("photos/opaque", "image/jpeg", 1234, 60);
    const policy = JSON.parse(Buffer.from(form.fields["Policy"] ?? "", "base64").toString()) as {
      conditions: unknown[];
    };
    expect(form.url).toContain("private-photos");
    expect(form.fields).toMatchObject({
      key: "photos/opaque",
      "Content-Type": "image/jpeg",
      "x-amz-server-side-encryption": "aws:kms",
      "x-amz-server-side-encryption-aws-kms-key-id": "kms-test-key",
    });
    expect(policy.conditions).toContainEqual(["content-length-range", 1, 1234]);
    expect(policy.conditions).toContainEqual({ key: "photos/opaque" });
    expect(policy.conditions).toContainEqual({ "x-amz-server-side-encryption": "aws:kms" });
    expect(policy.conditions).toContainEqual({
      "x-amz-server-side-encryption-aws-kms-key-id": "kms-test-key",
    });
    expect(JSON.stringify(policy)).not.toContain("public-read");
    expect(form.fields["acl"]).toBeUndefined();
    const read = await storage.readUrl("photos/opaque", 60);
    expect(read).toContain("X-Amz-Expires=60");
    client.destroy();
  });
});
