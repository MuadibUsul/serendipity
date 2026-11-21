-- Phones that receive push notifications (ADR-0030): each person's Expo push tokens. A token
-- belongs to one person at a time: signing in on a phone someone else used moves it. A token
-- the push service no longer knows is deleted; so are all of a person's when the account goes.

-- Up Migration

CREATE TABLE app.push_devices (
  token text PRIMARY KEY CONSTRAINT push_devices_token_check CHECK (char_length(token) BETWEEN 10 AND 250),
  user_id uuid NOT NULL REFERENCES app.users (id),
  platform text NOT NULL CONSTRAINT push_devices_platform_check CHECK (platform IN ('ios', 'android')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_devices_user_idx ON app.push_devices (user_id);

-- Down Migration

DROP TABLE app.push_devices;
