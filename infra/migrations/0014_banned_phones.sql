-- A suspended person cannot escape the suspension by deleting their account
-- and signing up again with the same number (owner decision, 2026-11-19).
--
-- When a suspended account is deleted, only the keyed hash of its phone
-- number is kept here: no user id, no profile, nothing else. Sign-in refuses
-- a number on this list exactly as it refuses a closed account.

-- Up Migration

CREATE TABLE app.auth_banned_phones (
  phone_hash text PRIMARY KEY,
  reason text NOT NULL
    CONSTRAINT auth_banned_phones_reason_check CHECK (reason IN ('suspended_account_deleted')),
  banned_at timestamptz NOT NULL DEFAULT now()
);

-- Down Migration

DROP TABLE app.auth_banned_phones;
