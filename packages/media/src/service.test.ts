import { createAuthorizer } from "@serendipity/consent";
import type { ConsentGrant } from "@serendipity/consent";
import { describe, expect, it } from "vitest";

import { createMediaService, MediaError } from "./service.js";
import type { MediaAsset, MediaRepository } from "./service.js";
import type { MediaStorage } from "./storage.js";

const ALICE = "00000000-0000-4000-8000-000000000001";
const BOB = "00000000-0000-4000-8000-000000000002";
const START = new Date("2026-11-07T00:00:00Z");

function setup(enabled = true) {
  let clock = START;
  const grants: ConsentGrant[] = [];
  const assets = new Map<string, MediaAsset>();
  const objects = new Map<
    string,
    { contentType: string; bytes: number; encryptedWithKms: boolean; imageSignatureValid: boolean }
  >();
  const derivatives = new Map<string, string[]>();
  const deleted: string[] = [];
  let auditFails = false;
  const repository: MediaRepository = {
    create(asset) {
      assets.set(asset.id, asset);
      return Promise.resolve();
    },
    find(id) {
      return Promise.resolve(assets.get(id) ?? null);
    },
    activate(id) {
      const asset = assets.get(id);
      if (asset?.status !== "pending") return Promise.resolve(false);
      assets.set(id, { ...asset, status: "active" });
      return Promise.resolve(true);
    },
    reviewPage(afterId, limit) {
      return Promise.resolve(
        [...assets.values()]
          .filter((asset) => asset.status !== "deleted" && (afterId === null || asset.id > afterId))
          .sort((a, b) => a.id.localeCompare(b.id))
          .slice(0, limit),
      );
    },
    derivativeKeys(id) {
      return Promise.resolve(derivatives.get(id) ?? []);
    },
    finishDeletion(id) {
      const asset = assets.get(id);
      if (asset !== undefined) assets.set(id, { ...asset, status: "deleted" });
      derivatives.delete(id);
      return Promise.resolve();
    },
  };
  const storage: MediaStorage = {
    uploadForm(key, contentType, maxBytes, ttlSeconds) {
      return Promise.resolve({
        url: `https://private.invalid/${key}?expires=${String(ttlSeconds)}`,
        fields: { key, "Content-Type": contentType, maxBytes: String(maxBytes) },
      });
    },
    describe(key) {
      return Promise.resolve(objects.get(key) ?? null);
    },
    readUrl(key, ttlSeconds) {
      return Promise.resolve(`https://private.invalid/${key}?expires=${String(ttlSeconds)}`);
    },
    delete(key) {
      deleted.push(key);
      objects.delete(key);
      return Promise.resolve();
    },
  };
  const consent = createAuthorizer({
    grants: {
      grantsFor(subject) {
        return Promise.resolve(grants.filter((grant) => grant.userId === subject));
      },
    },
    audit: {
      record() {
        return auditFails ? Promise.reject(new Error("audit unavailable")) : Promise.resolve();
      },
    },
  });
  const service = createMediaService({
    repository,
    storage,
    consent,
    realPhotosEnabled: enabled,
    now: () => clock,
  });
  const grant = (userId = ALICE, purpose = "visual_features") => {
    grants.push({
      id: String(grants.length + 1),
      userId,
      scope: "visual_matching",
      purpose,
      recipientClass: "vision_provider",
      version: 1,
      revokedAt: null,
    });
  };
  return {
    service,
    grant,
    grants,
    assets,
    objects,
    derivatives,
    deleted,
    advance: (ms: number) => {
      clock = new Date(clock.getTime() + ms);
    },
    failAudit: () => {
      auditFails = true;
    },
  };
}

describe("private photo lifecycle", () => {
  it("blocks real photos before G1 and requires the exact visual purpose grant", async () => {
    const off = setup(false);
    off.grant();
    await expect(
      off.service.createUploadIntent({
        ownerUserId: ALICE,
        purpose: "visual_matching",
        contentType: "image/jpeg",
        bytes: 100,
      }),
    ).rejects.toMatchObject({ code: "disabled" });
    const ctx = setup();
    ctx.grant(ALICE, "identity_verification");
    await expect(
      ctx.service.createUploadIntent({
        ownerUserId: ALICE,
        purpose: "visual_matching",
        contentType: "image/jpeg",
        bytes: 100,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      ctx.service.createUploadIntent({
        ownerUserId: ALICE,
        purpose: "identity_verification",
        contentType: "image/jpeg",
        bytes: 100,
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(ctx.assets.size).toBe(0);
  });

  it("limits the upload, validates the private encrypted object, and issues short reads only with a live grant", async () => {
    const ctx = setup();
    ctx.grant();
    const intent = await ctx.service.createUploadIntent({
      ownerUserId: ALICE,
      purpose: "visual_matching",
      contentType: "image/jpeg",
      bytes: 100,
    });
    expect(intent.expiresAt.getTime() - START.getTime()).toBe(60_000);
    expect(intent.form.fields).toMatchObject({ "Content-Type": "image/jpeg", maxBytes: "100" });
    const asset = ctx.assets.get(intent.assetId);
    expect(asset?.objectKey).toBe(`photos/${intent.assetId}`);
    if (asset === undefined) throw new Error("missing asset");
    await expect(ctx.service.completeUpload(BOB, asset.id)).rejects.toMatchObject({
      code: "not_found",
    });
    ctx.objects.set(asset.objectKey, {
      contentType: "image/jpeg",
      bytes: 100,
      encryptedWithKms: false,
      imageSignatureValid: true,
    });
    await expect(ctx.service.completeUpload(ALICE, asset.id)).rejects.toMatchObject({
      code: "invalid_upload",
    });
    ctx.advance(60_000);
    await expect(ctx.service.completeUpload(ALICE, asset.id)).rejects.toMatchObject({
      code: "invalid_upload",
    });
    ctx.objects.set(asset.objectKey, {
      contentType: "image/jpeg",
      bytes: 100,
      encryptedWithKms: true,
      imageSignatureValid: false,
    });
    await expect(ctx.service.completeUpload(ALICE, asset.id)).rejects.toMatchObject({
      code: "invalid_upload",
    });
    ctx.objects.set(asset.objectKey, {
      contentType: "image/jpeg",
      bytes: 100,
      encryptedWithKms: true,
      imageSignatureValid: true,
    });
    await ctx.service.completeUpload(ALICE, asset.id);
    expect(await ctx.service.visionReadUrl(asset.id)).toContain("expires=60");
    const firstGrant = ctx.grants[0];
    if (firstGrant === undefined) throw new Error("missing grant");
    ctx.grants[0] = { ...firstGrant, revokedAt: START };
    await expect(ctx.service.visionReadUrl(asset.id)).rejects.toMatchObject({ code: "forbidden" });
  });

  it("removes revoked, expired and derived objects, and never lets another owner delete", async () => {
    const ctx = setup();
    ctx.grant();
    const intent = await ctx.service.createUploadIntent({
      ownerUserId: ALICE,
      purpose: "visual_matching",
      contentType: "image/png",
      bytes: 200,
    });
    const asset = ctx.assets.get(intent.assetId);
    if (asset === undefined) throw new Error("missing asset");
    ctx.objects.set(asset.objectKey, {
      contentType: "image/png",
      bytes: 150,
      encryptedWithKms: true,
      imageSignatureValid: true,
    });
    ctx.advance(60_000);
    await ctx.service.completeUpload(ALICE, asset.id);
    ctx.derivatives.set(asset.id, ["derived/one"]);
    await expect(ctx.service.remove(BOB, asset.id)).rejects.toMatchObject({ code: "not_found" });
    const firstGrant = ctx.grants[0];
    if (firstGrant === undefined) throw new Error("missing grant");
    ctx.grants[0] = { ...firstGrant, revokedAt: START };
    const result = await ctx.service.cleanup();
    expect(result).toMatchObject({ reviewed: 1, removed: 1, nextCursor: null });
    expect(ctx.deleted).toEqual(["derived/one", asset.objectKey]);
    expect(ctx.assets.get(asset.id)?.status).toBe("deleted");
    await expect(ctx.service.visionReadUrl(asset.id)).rejects.toBeInstanceOf(MediaError);
  });

  it("cleans uncompleted uploads after five minutes", async () => {
    const ctx = setup();
    ctx.grant();
    const intent = await ctx.service.createUploadIntent({
      ownerUserId: ALICE,
      purpose: "visual_matching",
      contentType: "image/webp",
      bytes: 200,
    });
    ctx.advance(5 * 60_000 + 1);
    expect((await ctx.service.cleanup()).removed).toBe(1);
    expect(ctx.assets.get(intent.assetId)?.status).toBe("deleted");
  });

  it("cleans active assets when retention expires", async () => {
    const ctx = setup();
    ctx.grant();
    const intent = await ctx.service.createUploadIntent({
      ownerUserId: ALICE,
      purpose: "visual_matching",
      contentType: "image/webp",
      bytes: 200,
    });
    const asset = ctx.assets.get(intent.assetId);
    if (asset === undefined) throw new Error("missing asset");
    ctx.objects.set(asset.objectKey, {
      contentType: "image/webp",
      bytes: 150,
      encryptedWithKms: true,
      imageSignatureValid: true,
    });
    ctx.advance(60_000);
    await ctx.service.completeUpload(ALICE, asset.id);
    ctx.advance(30 * 24 * 60 * 60 * 1000);
    await expect(ctx.service.visionReadUrl(asset.id)).rejects.toMatchObject({ code: "not_found" });
    expect((await ctx.service.cleanup()).removed).toBe(1);
    expect(ctx.assets.get(asset.id)?.status).toBe("deleted");
  });

  it("does not delete photos during an audit outage", async () => {
    const ctx = setup();
    ctx.grant();
    const intent = await ctx.service.createUploadIntent({
      ownerUserId: ALICE,
      purpose: "visual_matching",
      contentType: "image/jpeg",
      bytes: 200,
    });
    const asset = ctx.assets.get(intent.assetId);
    if (asset === undefined) throw new Error("missing asset");
    ctx.objects.set(asset.objectKey, {
      contentType: "image/jpeg",
      bytes: 150,
      encryptedWithKms: true,
      imageSignatureValid: true,
    });
    ctx.advance(60_000);
    await ctx.service.completeUpload(ALICE, asset.id);
    ctx.failAudit();
    await expect(ctx.service.cleanup()).rejects.toMatchObject({ code: "forbidden" });
    expect(ctx.assets.get(asset.id)?.status).toBe("active");
    expect(ctx.deleted).toEqual([]);
  });
});
