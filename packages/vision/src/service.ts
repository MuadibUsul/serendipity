import type { Authorizer } from "@serendipity/consent";
import type { MediaRepository, MediaService } from "@serendipity/media";

import { parseVisionFeatures, VisionError } from "./schema.js";
import type { VisionFeatures } from "./schema.js";

export interface VisionProvider {
  /** Returns untrusted model output; the service validates it before persistence. */
  extract(imageUrl: string): Promise<unknown>;
}

export interface VisionSnapshot {
  readonly assetId: string;
  readonly ownerUserId: string;
  readonly role: "self" | "reference";
  /** A reference is explicitly liked or disliked by the person, never inferred. */
  readonly preference: "like" | "dislike" | null;
  readonly features: VisionFeatures;
}

export interface VisionRepository {
  save(snapshot: VisionSnapshot): Promise<void>;
  /** Returns only snapshots backed by an active, unexpired asset. */
  activeForOwner(ownerUserId: string): Promise<readonly VisionSnapshot[]>;
}

export interface VisionService {
  analyze(input: {
    ownerUserId: string;
    assetId: string;
    role: "self" | "reference";
    preference?: "like" | "dislike";
  }): Promise<VisionSnapshot>;
  forMatching(ownerUserId: string): Promise<readonly VisionSnapshot[]>;
}

/** A reversible gate: turning the feature off or revoking consent stops both model calls and matching reads. */
export function createVisionService(deps: {
  enabled?: boolean;
  media: Pick<MediaService, "visionReadUrl">;
  assets: Pick<MediaRepository, "find">;
  consent: Authorizer;
  repository: VisionRepository;
  provider: VisionProvider;
  now?: () => Date;
}): VisionService {
  const now = deps.now ?? (() => new Date());
  const requireEnabled = (): void => {
    if (deps.enabled !== true) throw new VisionError("disabled");
  };
  const requireAsset = async (ownerUserId: string, assetId: string): Promise<void> => {
    const asset = await deps.assets.find(assetId);
    if (
      asset?.ownerUserId !== ownerUserId ||
      asset.status !== "active" ||
      asset.retentionUntil <= now()
    )
      throw new VisionError("not_found");
  };
  const requireMatchingGrant = async (ownerUserId: string): Promise<void> => {
    const decision = await deps.consent.authorize({
      subject: ownerUserId,
      resource: "visual_features",
      purpose: "matching",
      recipient: { kind: "matching_service" },
    });
    if (!decision.allowed) throw new VisionError("forbidden");
  };
  const requirePhotoGrant = async (ownerUserId: string): Promise<void> => {
    const decision = await deps.consent.authorize({
      subject: ownerUserId,
      resource: "match_photos",
      purpose: "visual_features",
      recipient: { kind: "vision_provider" },
    });
    if (!decision.allowed) throw new VisionError("forbidden");
  };
  return {
    async analyze(input) {
      requireEnabled();
      if (
        (input.role === "self" && input.preference !== undefined) ||
        (input.role === "reference" &&
          input.preference !== "like" &&
          input.preference !== "dislike")
      )
        throw new VisionError("invalid_input");
      await requireAsset(input.ownerUserId, input.assetId);
      await requireMatchingGrant(input.ownerUserId);
      await requirePhotoGrant(input.ownerUserId);
      // This call checks the live photo grant and produces a short-lived, private URL.
      const url = await deps.media.visionReadUrl(input.ownerUserId, input.assetId);
      let raw: unknown;
      try {
        raw = await deps.provider.extract(url);
      } catch {
        throw new VisionError("provider_failed");
      }
      const features = parseVisionFeatures(raw);
      // Consent may have been withdrawn, or the asset deleted, during model inference.
      await requireAsset(input.ownerUserId, input.assetId);
      await requirePhotoGrant(input.ownerUserId);
      await requireMatchingGrant(input.ownerUserId);
      const snapshot: VisionSnapshot = {
        assetId: input.assetId,
        ownerUserId: input.ownerUserId,
        role: input.role,
        preference: input.preference ?? null,
        features,
      };
      await deps.repository.save(snapshot);
      return snapshot;
    },
    async forMatching(ownerUserId) {
      requireEnabled();
      await requireMatchingGrant(ownerUserId);
      const snapshots = await deps.repository.activeForOwner(ownerUserId);
      return snapshots.map((snapshot) => {
        if (snapshot.ownerUserId !== ownerUserId) throw new VisionError("forbidden");
        return { ...snapshot, features: parseVisionFeatures(snapshot.features) };
      });
    },
  };
}
