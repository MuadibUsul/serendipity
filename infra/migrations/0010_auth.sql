-- Sign-in by phone and one-time code (ser-p01-10, CHG-001 D9). Nothing here
-- holds a phone number, a network address, a code or a token in the clear:
-- every one is an HMAC under the API's AUTH_SECRET (@serendipity/auth), so a
-- copy of these tables can neither be read back nor replayed.

-- Up Migration

-- Which account a phone number signs in to.
CREATE TABLE app.auth_phone_accounts (
  phone_hash text PRIMARY KEY,
  user_id uuid NOT NULL CONSTRAINT auth_phone_accounts_user_key UNIQUE REFERENCES app.users (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One-time codes. At most one pending code per number: a new one replaces it.
CREATE TABLE app.auth_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_hash text NOT NULL,
  ip_hash text NOT NULL,
  code_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CONSTRAINT auth_challenges_status_check CHECK (status IN ('pending', 'used', 'expired', 'locked')),
  attempts integer NOT NULL DEFAULT 0 CONSTRAINT auth_challenges_attempts_check CHECK (attempts >= 0),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  ended_at timestamptz,
  CONSTRAINT auth_challenges_ended_check CHECK ((status = 'pending') = (ended_at IS NULL))
);
CREATE UNIQUE INDEX auth_challenges_one_pending_idx ON app.auth_challenges (phone_hash) WHERE status = 'pending';
CREATE INDEX auth_challenges_phone_created_idx ON app.auth_challenges (phone_hash, created_at);
CREATE INDEX auth_challenges_ip_created_idx ON app.auth_challenges (ip_hash, created_at);

-- Sessions. A refresh replaces a session with a new one in the same family;
-- a refresh token used twice revokes the whole family.
CREATE TABLE app.auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES app.users (id),
  status text NOT NULL DEFAULT 'active'
    CONSTRAINT auth_sessions_status_check CHECK (status IN ('active', 'rotated', 'revoked')),
  access_hash text NOT NULL CONSTRAINT auth_sessions_access_hash_key UNIQUE,
  access_expires_at timestamptz NOT NULL,
  refresh_hash text NOT NULL CONSTRAINT auth_sessions_refresh_hash_key UNIQUE,
  refresh_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  ended_at timestamptz,
  CONSTRAINT auth_sessions_ended_check CHECK ((status = 'active') = (ended_at IS NULL))
);
CREATE INDEX auth_sessions_family_idx ON app.auth_sessions (family_id);
CREATE INDEX auth_sessions_user_idx ON app.auth_sessions (user_id);

-- Lifecycle guards (docs/state-machines.md; @serendipity/auth).
CREATE TRIGGER auth_challenges_status_guard
  BEFORE UPDATE OF status ON app.auth_challenges
  FOR EACH ROW
  EXECUTE FUNCTION app.guard_transition ('status',
    'pending>used', 'pending>expired', 'pending>locked');

CREATE TRIGGER auth_sessions_status_guard
  BEFORE UPDATE OF status ON app.auth_sessions
  FOR EACH ROW
  EXECUTE FUNCTION app.guard_transition ('status',
    'active>rotated', 'active>revoked', 'rotated>revoked');

-- Down Migration

DROP TABLE app.auth_sessions;
DROP TABLE app.auth_challenges;
DROP TABLE app.auth_phone_accounts;
