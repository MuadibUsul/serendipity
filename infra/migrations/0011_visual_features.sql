-- Coarse, allow-listed visual observations and explicit aesthetic references.
-- No free text, face embedding, identity or personality columns are stored.
-- Up Migration

ALTER TABLE app.media_assets ADD CONSTRAINT media_assets_id_owner_key UNIQUE (id, owner_user_id);

CREATE TABLE app.visual_feature_snapshots (
  asset_id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('self', 'reference')),
  preference text CHECK (preference IN ('like', 'dislike')),
  hair_length text NOT NULL CHECK (hair_length IN ('short', 'medium', 'long', 'not_visible')),
  hair_confidence double precision NOT NULL CHECK (hair_confidence BETWEEN 0 AND 1),
  clothing_style text NOT NULL CHECK (clothing_style IN ('casual', 'formal', 'sporty', 'other', 'not_visible')),
  clothing_confidence double precision NOT NULL CHECK (clothing_confidence BETWEEN 0 AND 1),
  photo_style text NOT NULL CHECK (photo_style IN ('natural', 'studio', 'outdoor', 'other', 'not_visible')),
  photo_confidence double precision NOT NULL CHECK (photo_confidence BETWEEN 0 AND 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT visual_feature_asset_owner_fk FOREIGN KEY (asset_id, owner_user_id)
    REFERENCES app.media_assets (id, owner_user_id),
  CONSTRAINT visual_feature_role_preference_check CHECK (
    (role = 'self' AND preference IS NULL) OR
    (role = 'reference' AND preference IS NOT NULL)
  )
);
CREATE INDEX visual_feature_owner_idx ON app.visual_feature_snapshots (owner_user_id);

-- Down Migration

DROP TABLE app.visual_feature_snapshots;
ALTER TABLE app.media_assets DROP CONSTRAINT media_assets_id_owner_key;
