-- One card a day after a mutual yes (ADR-0021): each owner's deck settings,
-- and which cards each viewer has turned over. A card is stored as the
-- category and item the viewer saw; it is shown again only while it is
-- still in its owner's deck.

-- Up Migration

CREATE TABLE app.reveal_settings (
  user_id uuid PRIMARY KEY REFERENCES app.users (id),
  excluded text[] NOT NULL DEFAULT '{}',
  included text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.reveal_flips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id uuid NOT NULL REFERENCES app.relationships (id),
  viewer_id uuid NOT NULL REFERENCES app.users (id),
  category text NOT NULL,
  item text NOT NULL,
  flipped_at timestamptz NOT NULL,
  CONSTRAINT reveal_flips_once_key UNIQUE (relationship_id, viewer_id, category, item)
);
CREATE INDEX reveal_flips_viewer_idx ON app.reveal_flips (relationship_id, viewer_id, flipped_at);

-- Down Migration

DROP TABLE app.reveal_flips;
DROP TABLE app.reveal_settings;
