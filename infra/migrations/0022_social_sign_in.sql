-- Sign in with Apple and Google (ADR-0026).
--   auth_social_accounts  the provider's subject id, as a keyed hash, and the account it opens.
--                         One account per (provider, subject); never an email or a name.
--   auth_banned_social    subjects whose suspended account was deleted: they cannot start
--                         over (as auth_banned_phones does for numbers, migration 0014).
--   auth_nonces           one-time nonces handed to the platform's sign-in sheet, as hashes.

-- Up Migration

CREATE TABLE app.auth_social_accounts (
  provider text NOT NULL CONSTRAINT auth_social_accounts_provider_check CHECK (provider IN ('apple', 'google')),
  subject_hash text NOT NULL,
  user_id uuid NOT NULL REFERENCES app.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, subject_hash)
);
CREATE INDEX auth_social_accounts_user_idx ON app.auth_social_accounts (user_id);

CREATE TABLE app.auth_banned_social (
  provider text NOT NULL CONSTRAINT auth_banned_social_provider_check CHECK (provider IN ('apple', 'google')),
  subject_hash text NOT NULL,
  reason text NOT NULL
    CONSTRAINT auth_banned_social_reason_check CHECK (reason IN ('suspended_account_deleted')),
  banned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, subject_hash)
);

CREATE TABLE app.auth_nonces (
  nonce_hash text PRIMARY KEY,
  ip_hash text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  CONSTRAINT auth_nonces_expiry_check CHECK (expires_at > created_at)
);
CREATE INDEX auth_nonces_ip_idx ON app.auth_nonces (ip_hash, created_at);

-- Down Migration

DROP TABLE app.auth_nonces;
DROP TABLE app.auth_banned_social;
DROP TABLE app.auth_social_accounts;
