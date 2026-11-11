import { createAuthorizer } from "@serendipity/consent";
import type { ConsentGrant } from "@serendipity/consent";
import type { MediaAsset } from "@serendipity/media";
import { describe, expect, it } from "vitest";

import { createVisionService } from "./service.js";
import type { VisionSnapshot } from "./service.js";
import { VALID } from "./schema.test.js";

const ALICE = "00000000-0000-4000-8000-000000000001";
const BOB = "00000000-0000-4000-8000-000000000002";
const ASSET = "00000000-0000-4000-8000-000000000003";

function setup(enabled = true) {
  let photoGrant = true;
  let matchGrant = true;
  let providerCalls = 0;
  let mediaCalls = 0;
  let modelOutput: unknown = VALID;
  const stored = new Map<string, VisionSnapshot>();
  const asset: MediaAsset = {
    id: ASSET,
    ownerUserId: ALICE,
    objectKey: `photos/${ASSET}`,
    purpose: "visual_matching",
    contentType: "image/jpeg",
    maxBytes: 100,
    createdAt: new Date("2026-11-07T00:00:00Z"),
    retentionUntil: new Date("2026-12-07T00:00:00Z"),
    status: "active",
  };
  const grant = (purpose: string, recipientClass: string): ConsentGrant => ({
    id: purpose,
    userId: ALICE,
    scope: "visual_matching",
    purpose,
    recipientClass,
    version: 1,
    revokedAt: null,
  });
  const consent = createAuthorizer({
    grants: {
      grantsFor(subject) {
        return Promise.resolve(
          subject === ALICE
            ? [
                {
                  ...grant("visual_features", "vision_provider"),
                  revokedAt: photoGrant ? null : new Date(),
                },
                {
                  ...grant("matching", "matching_service"),
                  revokedAt: matchGrant ? null : new Date(),
                },
              ]
            : [],
        );
      },
    },
    audit: {
      record() {
        return Promise.resolve();
      },
    },
  });
  const service = createVisionService({
    enabled,
    now: () => new Date("2026-11-07T01:00:00Z"),
    assets: {
      find(id) {
        return Promise.resolve(id === ASSET ? asset : null);
      },
    },
    media: {
      visionReadUrl() {
        mediaCalls += 1;
        return Promise.resolve("https://private.invalid/signed");
      },
    },
    consent,
    provider: {
      extract() {
        providerCalls += 1;
        return Promise.resolve(modelOutput);
      },
    },
    repository: {
      save(snapshot) {
        stored.set(snapshot.assetId, snapshot);
        return Promise.resolve();
      },
      activeForOwner(owner) {
        return Promise.resolve([...stored.values()].filter((row) => row.ownerUserId === owner));
      },
    },
  });
  return {
    service,
    stored,
    asset,
    revokePhoto: () => {
      photoGrant = false;
    },
    revokeMatching: () => {
      matchGrant = false;
    },
    output: (value: unknown) => {
      modelOutput = value;
    },
    counts: () => ({ mediaCalls, providerCalls }),
  };
}

describe("vision workflow", () => {
  it("stores own observations and explicitly liked aesthetic references without a score", async () => {
    const ctx = setup();
    const own = await ctx.service.analyze({ ownerUserId: ALICE, assetId: ASSET, role: "self" });
    expect(own).toMatchObject({ role: "self", preference: null, features: VALID });
    const reference = await ctx.service.analyze({
      ownerUserId: ALICE,
      assetId: ASSET,
      role: "reference",
      preference: "like",
    });
    expect(reference).toMatchObject({ role: "reference", preference: "like", features: VALID });
    expect(await ctx.service.forMatching(ALICE)).toEqual([reference]);
    expect(JSON.stringify(reference)).not.toMatch(/identity|personality|attractiveness|score/);
  });

  it("rejects another person's asset, a reference without preference and model extra fields", async () => {
    const ctx = setup();
    await expect(
      ctx.service.analyze({ ownerUserId: BOB, assetId: ASSET, role: "self" }),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      ctx.service.analyze({ ownerUserId: ALICE, assetId: ASSET, role: "reference" }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    ctx.output({ ...VALID, identity: "Alice" });
    await expect(
      ctx.service.analyze({ ownerUserId: ALICE, assetId: ASSET, role: "self" }),
    ).rejects.toMatchObject({ code: "invalid_output" });
    expect(ctx.stored.size).toBe(0);
  });

  it("turns off processing and matching immediately when the grant is revoked", async () => {
    const ctx = setup();
    await ctx.service.analyze({ ownerUserId: ALICE, assetId: ASSET, role: "self" });
    ctx.revokeMatching();
    await expect(ctx.service.forMatching(ALICE)).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      ctx.service.analyze({ ownerUserId: ALICE, assetId: ASSET, role: "self" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(ctx.counts().providerCalls).toBe(1);
  });

  it("stops photo processing when the photo-specific grant is revoked", async () => {
    const ctx = setup();
    ctx.revokePhoto();
    await expect(
      ctx.service.analyze({ ownerUserId: ALICE, assetId: ASSET, role: "self" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(ctx.counts().providerCalls).toBe(0);
  });

  it("never calls storage or the model while the feature flag is off", async () => {
    const ctx = setup(false);
    await expect(
      ctx.service.analyze({ ownerUserId: ALICE, assetId: ASSET, role: "self" }),
    ).rejects.toMatchObject({ code: "disabled" });
    await expect(ctx.service.forMatching(ALICE)).rejects.toMatchObject({ code: "disabled" });
    expect(ctx.counts()).toEqual({ mediaCalls: 0, providerCalls: 0 });
  });
});
