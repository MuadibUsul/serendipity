import type { VisionRepository, VisionSnapshot } from "@serendipity/vision";

import type { Queryable } from "./queryable.js";

interface FeatureRow {
  asset_id: string;
  owner_user_id: string;
  role: VisionSnapshot["role"];
  preference: VisionSnapshot["preference"];
  hair_length: VisionSnapshot["features"]["hair_length"]["value"];
  hair_confidence: number;
  clothing_style: VisionSnapshot["features"]["clothing_style"]["value"];
  clothing_confidence: number;
  photo_style: VisionSnapshot["features"]["photo_style"]["value"];
  photo_confidence: number;
}

/** Stores no model prose, face vector or sensitive inference. */
export function pgVisionRepository(db: Queryable): VisionRepository {
  return {
    async save(snapshot) {
      const f = snapshot.features;
      await db.query(
        `INSERT INTO app.visual_feature_snapshots
           (asset_id, owner_user_id, role, preference, hair_length, hair_confidence,
            clothing_style, clothing_confidence, photo_style, photo_confidence)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (asset_id) DO UPDATE SET
           role = EXCLUDED.role, preference = EXCLUDED.preference,
           hair_length = EXCLUDED.hair_length, hair_confidence = EXCLUDED.hair_confidence,
           clothing_style = EXCLUDED.clothing_style, clothing_confidence = EXCLUDED.clothing_confidence,
           photo_style = EXCLUDED.photo_style, photo_confidence = EXCLUDED.photo_confidence,
           updated_at = now()`,
        [
          snapshot.assetId,
          snapshot.ownerUserId,
          snapshot.role,
          snapshot.preference,
          f.hair_length.value,
          f.hair_length.confidence,
          f.clothing_style.value,
          f.clothing_style.confidence,
          f.photo_style.value,
          f.photo_style.confidence,
        ],
      );
    },
    async activeForOwner(ownerUserId) {
      const { rows } = await db.query<FeatureRow>(
        `SELECT v.asset_id, v.owner_user_id, v.role, v.preference,
                v.hair_length, v.hair_confidence, v.clothing_style, v.clothing_confidence,
                v.photo_style, v.photo_confidence
         FROM app.visual_feature_snapshots v
         JOIN app.media_assets m ON m.id = v.asset_id AND m.owner_user_id = v.owner_user_id
         WHERE v.owner_user_id = $1 AND m.status = 'active' AND m.retention_until > now()
         ORDER BY v.created_at, v.asset_id`,
        [ownerUserId],
      );
      return rows.map((row): VisionSnapshot => ({
        assetId: row.asset_id,
        ownerUserId: row.owner_user_id,
        role: row.role,
        preference: row.preference,
        features: {
          hair_length: { value: row.hair_length, confidence: row.hair_confidence },
          clothing_style: { value: row.clothing_style, confidence: row.clothing_confidence },
          photo_style: { value: row.photo_style, confidence: row.photo_confidence },
        },
      }));
    },
  };
}
