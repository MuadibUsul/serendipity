-- Starting checks and forgetting them (ADR-0025).
--   verification_sessions     each check a person started: which vendor, its reference and
--                             level. Counts the daily limit, and lists what to delete later.
--   vendor_deletion_requests  references a vendor still has to delete (the selfie video, any
--                             ID). No user id: a request outlives the account it came from,
--                             and stays until the vendor accepts it.

-- Up Migration

CREATE TABLE app.verification_sessions (
  provider text NOT NULL,
  provider_ref text NOT NULL,
  user_id uuid NOT NULL REFERENCES app.users (id),
  level text NOT NULL CONSTRAINT verification_sessions_level_check CHECK (level IN ('liveness', 'document')),
  started_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, provider_ref)
);
CREATE INDEX verification_sessions_user_idx ON app.verification_sessions (user_id, started_at);

CREATE TABLE app.vendor_deletion_requests (
  provider text NOT NULL,
  provider_ref text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0 CONSTRAINT vendor_deletion_requests_attempts_check CHECK (attempts >= 0),
  last_attempt_at timestamptz,
  completed_at timestamptz,
  PRIMARY KEY (provider, provider_ref)
);
CREATE INDEX vendor_deletion_requests_pending_idx
  ON app.vendor_deletion_requests (requested_at) WHERE completed_at IS NULL;

-- Down Migration

DROP TABLE app.vendor_deletion_requests;
DROP TABLE app.verification_sessions;
