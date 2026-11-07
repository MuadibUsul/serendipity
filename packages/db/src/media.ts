import type { MediaAsset, MediaRepository } from "@serendipity/media";

import type { Queryable } from "./queryable.js";

interface AssetRow {
  id: string;
  owner_user_id: string;
  object_key: string;
  purpose: "visual_matching";
  content_type: string;
  max_bytes: number;
  retention_until: Date;
  created_at: Date;
  status: MediaAsset["status"];
}

const COLUMNS = `id, owner_user_id, object_key, purpose, content_type,
  max_bytes, retention_until, created_at, status`;

function assetOf(row: AssetRow): MediaAsset {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    objectKey: row.object_key,
    purpose: row.purpose,
    contentType: row.content_type,
    maxBytes: row.max_bytes,
    retentionUntil: row.retention_until,
    createdAt: row.created_at,
    status: row.status,
  };
}

/** Persistent photo metadata; object bytes always live outside PostgreSQL. */
export function pgMediaRepository(db: Queryable): MediaRepository {
  return {
    async create(asset) {
      await db.query(
        `INSERT INTO app.media_assets
           (id, owner_user_id, object_key, purpose, content_type, max_bytes,
            retention_until, created_at, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          asset.id,
          asset.ownerUserId,
          asset.objectKey,
          asset.purpose,
          asset.contentType,
          asset.maxBytes,
          asset.retentionUntil,
          asset.createdAt,
          asset.status,
        ],
      );
    },
    async find(id) {
      const { rows } = await db.query<AssetRow>(
        `SELECT ${COLUMNS} FROM app.media_assets WHERE id = $1 AND purpose = 'visual_matching'`,
        [id],
      );
      return rows[0] === undefined ? null : assetOf(rows[0]);
    },
    async activate(id) {
      const result = await db.query(
        `UPDATE app.media_assets SET status = 'active'
         WHERE id = $1 AND status = 'pending' AND retention_until > now()`,
        [id],
      );
      return result.rowCount === 1;
    },
    async reviewPage(afterId, limit) {
      const { rows } = await db.query<AssetRow>(
        `SELECT ${COLUMNS} FROM app.media_assets
         WHERE purpose = 'visual_matching' AND status <> 'deleted'
           AND ($1::uuid IS NULL OR id > $1::uuid)
         ORDER BY id LIMIT $2`,
        [afterId, limit],
      );
      return rows.map(assetOf);
    },
    async derivativeKeys(id) {
      const { rows } = await db.query<{ object_key: string }>(
        `SELECT object_key FROM app.media_derivatives WHERE asset_id = $1`,
        [id],
      );
      return rows.map((row) => row.object_key);
    },
    async finishDeletion(id) {
      await db.query(`DELETE FROM app.media_derivatives WHERE asset_id = $1`, [id]);
      await db.query(`UPDATE app.media_assets SET status = 'deleted' WHERE id = $1`, [id]);
    },
  };
}
