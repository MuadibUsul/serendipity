-- Upload intents and derived-object lineage for P02-06.
-- Up Migration

ALTER TABLE app.media_assets
  ADD COLUMN content_type text NOT NULL DEFAULT 'image/jpeg',
  ADD COLUMN max_bytes integer NOT NULL DEFAULT 10485760
    CONSTRAINT media_assets_max_bytes_check CHECK (max_bytes BETWEEN 1 AND 10485760);

CREATE TABLE app.media_derivatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id uuid NOT NULL REFERENCES app.media_assets (id),
  object_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX media_derivatives_asset_idx ON app.media_derivatives (asset_id);

-- Down Migration

DROP TABLE app.media_derivatives;
ALTER TABLE app.media_assets DROP COLUMN max_bytes, DROP COLUMN content_type;
