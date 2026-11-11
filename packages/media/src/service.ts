import { randomUUID } from "node:crypto";

import type { Authorizer, Decision } from "@serendipity/consent";

import type { MediaStorage, UploadForm } from "./storage.js";

export type PhotoPurpose = "visual_matching";
export type MediaStatus = "pending" | "active" | "expired" | "deleted";

export interface MediaAsset {
  readonly id: string;
  readonly ownerUserId: string;
  readonly objectKey: string;
  readonly purpose: PhotoPurpose;
  readonly contentType: string;
  readonly maxBytes: number;
  readonly retentionUntil: Date;
  readonly createdAt: Date;
  readonly status: MediaStatus;
}

export interface MediaRepository {
  create(asset: MediaAsset): Promise<void>;
  find(id: string): Promise<MediaAsset | null>;
  activate(id: string): Promise<boolean>;
  /** Paginated scan, including active assets whose grant may have been revoked. */
  reviewPage(afterId: string | null, limit: number): Promise<readonly MediaAsset[]>;
  derivativeKeys(id: string): Promise<readonly string[]>;
  finishDeletion(id: string): Promise<void>;
}

export interface UploadIntent {
  readonly assetId: string;
  readonly form: UploadForm;
  readonly expiresAt: Date;
}

export class MediaError extends Error {
  constructor(
    readonly code: "disabled" | "invalid_input" | "forbidden" | "not_found" | "invalid_upload",
  ) {
    super(code);
  }
}

export interface MediaService {
  createUploadIntent(input: {
    ownerUserId: string;
    purpose: string;
    contentType: string;
    bytes: number;
  }): Promise<UploadIntent>;
  completeUpload(ownerUserId: string, assetId: string): Promise<void>;
  visionReadUrl(assetId: string): Promise<string>;
  remove(ownerUserId: string, assetId: string): Promise<void>;
  /** Run repeatedly with nextCursor until null; the caller schedules this job. */
  cleanup(
    afterId?: string | null,
  ): Promise<{ reviewed: number; removed: number; nextCursor: string | null }>;
}

const MAX_BYTES = 10 * 1024 * 1024;
const UPLOAD_SECONDS = 60;
const READ_SECONDS = 60;
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const PENDING_MS = 5 * 60 * 1000;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** No real photo path is enabled before the G1 gate and explicit configuration. */
export function createMediaService(deps: {
  repository: MediaRepository;
  storage: MediaStorage;
  consent: Authorizer;
  realPhotosEnabled?: boolean;
  now?: () => Date;
}): MediaService {
  const now = deps.now ?? (() => new Date());
  const requireEnabled = (): void => {
    if (deps.realPhotosEnabled !== true) throw new MediaError("disabled");
  };
  const checkGrant = (ownerUserId: string): Promise<Decision> =>
    deps.consent.authorize({
      subject: ownerUserId,
      resource: "match_photos",
      purpose: "visual_features",
      recipient: { kind: "vision_provider" },
    });
  const requireGrant = async (ownerUserId: string): Promise<void> => {
    const decision = await checkGrant(ownerUserId);
    if (!decision.allowed) throw new MediaError("forbidden");
  };
  const purge = async (asset: MediaAsset): Promise<void> => {
    for (const key of await deps.repository.derivativeKeys(asset.id))
      await deps.storage.delete(key);
    await deps.storage.delete(asset.objectKey);
    await deps.repository.finishDeletion(asset.id);
  };
  return {
    async createUploadIntent(input) {
      requireEnabled();
      if (
        input.purpose !== "visual_matching" ||
        !TYPES.has(input.contentType) ||
        !Number.isSafeInteger(input.bytes) ||
        input.bytes < 1 ||
        input.bytes > MAX_BYTES ||
        !/^[0-9a-f-]{36}$/i.test(input.ownerUserId)
      )
        throw new MediaError("invalid_input");
      await requireGrant(input.ownerUserId);
      const issuedAt = now();
      const id = randomUUID();
      const asset: MediaAsset = {
        id,
        ownerUserId: input.ownerUserId,
        objectKey: `photos/${id}`,
        purpose: "visual_matching",
        contentType: input.contentType,
        maxBytes: input.bytes,
        retentionUntil: new Date(issuedAt.getTime() + RETENTION_MS),
        createdAt: issuedAt,
        status: "pending",
      };
      await deps.repository.create(asset);
      const form = await deps.storage.uploadForm(
        asset.objectKey,
        asset.contentType,
        asset.maxBytes,
        UPLOAD_SECONDS,
      );
      return { assetId: id, form, expiresAt: new Date(issuedAt.getTime() + UPLOAD_SECONDS * 1000) };
    },
    async completeUpload(ownerUserId, assetId) {
      requireEnabled();
      const asset = await deps.repository.find(assetId);
      if (asset?.ownerUserId !== ownerUserId || asset.status !== "pending")
        throw new MediaError("not_found");
      await requireGrant(ownerUserId);
      // A POST policy can be replayed until it expires. Never expose its object
      // while the caller can still overwrite the verified bytes.
      if (now().getTime() < asset.createdAt.getTime() + UPLOAD_SECONDS * 1000)
        throw new MediaError("invalid_upload");
      if (now().getTime() - asset.createdAt.getTime() > PENDING_MS)
        throw new MediaError("invalid_upload");
      const object = await deps.storage.describe(asset.objectKey);
      if (
        object?.contentType !== asset.contentType ||
        object.bytes < 1 ||
        object.bytes > asset.maxBytes ||
        !object.encryptedWithKms ||
        !object.imageSignatureValid
      )
        throw new MediaError("invalid_upload");
      if (!(await deps.repository.activate(asset.id))) throw new MediaError("not_found");
    },
    async visionReadUrl(assetId) {
      requireEnabled();
      const asset = await deps.repository.find(assetId);
      if (asset?.status !== "active" || asset.retentionUntil <= now())
        throw new MediaError("not_found");
      await requireGrant(asset.ownerUserId);
      return deps.storage.readUrl(asset.objectKey, READ_SECONDS);
    },
    async remove(ownerUserId, assetId) {
      const asset = await deps.repository.find(assetId);
      if (asset?.ownerUserId !== ownerUserId || asset.status === "deleted")
        throw new MediaError("not_found");
      await purge(asset);
    },
    async cleanup(afterId = null) {
      const page = await deps.repository.reviewPage(afterId, 100);
      let removed = 0;
      for (const asset of page) {
        const expired = asset.retentionUntil <= now();
        const stalePending =
          asset.status === "pending" && now().getTime() - asset.createdAt.getTime() > PENDING_MS;
        let revoked = false;
        if (asset.status === "active" && !expired) {
          const decision = await checkGrant(asset.ownerUserId);
          if (!decision.allowed) {
            if (["no_grant", "grant_revoked", "grant_outdated"].includes(decision.reason))
              revoked = true;
            else throw new MediaError("forbidden");
          }
        }
        if (expired || stalePending || revoked || asset.status === "expired") {
          await purge(asset);
          removed += 1;
        }
      }
      return {
        reviewed: page.length,
        removed,
        nextCursor: page.length === 100 ? (page[99]?.id ?? null) : null,
      };
    },
  };
}
