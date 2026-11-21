-- Devices a venue scans check-in codes with (P04-08a, ADR-0028). Each holds a key, stored
-- here only as a keyed hash; ops registers a device and hands its key over once. A revoked
-- device stops working at once.

-- Up Migration

CREATE TABLE app.venue_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES app.venues (id),
  key_hash text NOT NULL CONSTRAINT venue_devices_key_hash_key UNIQUE,
  label text NOT NULL CONSTRAINT venue_devices_label_check CHECK (char_length(label) BETWEEN 1 AND 60),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT venue_devices_revoked_check CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);
CREATE INDEX venue_devices_venue_idx ON app.venue_devices (venue_id);

-- Down Migration

DROP TABLE app.venue_devices;
