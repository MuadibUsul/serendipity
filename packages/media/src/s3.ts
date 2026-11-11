import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import type { S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type { MediaStorage } from "./storage.js";

function validSignature(contentType: string, bytes: Uint8Array): boolean {
  if (contentType === "image/jpeg")
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (contentType === "image/png")
    return (
      bytes.length >= 8 &&
      [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
    );
  if (contentType === "image/webp")
    return (
      bytes.length >= 12 &&
      Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" &&
      Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP"
    );
  return false;
}

/** Bucket access is private by IAM and Block Public Access; every upload uses one KMS key. */
export function s3PrivateMediaStorage(options: {
  client: S3Client;
  bucket: string;
  kmsKeyId: string;
}): MediaStorage {
  const { client, bucket, kmsKeyId } = options;
  if (!bucket || !kmsKeyId) throw new Error("private media bucket and KMS key are required");
  return {
    async uploadForm(key, contentType, maxBytes, ttlSeconds) {
      const fields = {
        key,
        "Content-Type": contentType,
        "x-amz-server-side-encryption": "aws:kms",
        "x-amz-server-side-encryption-aws-kms-key-id": kmsKeyId,
      };
      const post = await createPresignedPost(client, {
        Bucket: bucket,
        Key: key,
        Fields: fields,
        Conditions: [
          ["content-length-range", 1, maxBytes],
          { key },
          { "Content-Type": contentType },
          { "x-amz-server-side-encryption": "aws:kms" },
          { "x-amz-server-side-encryption-aws-kms-key-id": kmsKeyId },
        ],
        Expires: ttlSeconds,
      });
      return { url: post.url, fields: post.fields };
    },
    async describe(key) {
      try {
        const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        const sample = await client.send(
          new GetObjectCommand({
            Bucket: bucket,
            Key: key,
            Range: "bytes=0-15",
          }),
        );
        const prefix = await sample.Body?.transformToByteArray();
        return {
          contentType: head.ContentType ?? "",
          bytes: head.ContentLength ?? -1,
          encryptedWithKms:
            head.ServerSideEncryption === "aws:kms" && head.SSEKMSKeyId === kmsKeyId,
          imageSignatureValid:
            prefix !== undefined && validSignature(head.ContentType ?? "", prefix),
        };
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "name" in error &&
          (error.name === "NotFound" || error.name === "NoSuchKey")
        )
          return null;
        throw error;
      }
    },
    readUrl(key, ttlSeconds) {
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          ResponseCacheControl: "private, no-store",
        }),
        { expiresIn: ttlSeconds },
      );
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}
