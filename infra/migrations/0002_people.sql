-- People: accounts, identity attestations, consent, profiles, photos and
-- matching policies (ARCH-001 §5). Statuses are text with CHECK constraints so
-- later migrations can change them without enum rewrites. No foreign key
-- cascades: deleting personal data is an explicit, audited job (ser-p05-06).

-- Up Migration

CREATE TABLE app.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'pending'
    CONSTRAINT users_status_check CHECK (status IN ('pending', 'active', 'paused', 'suspended', 'deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT users_deleted_at_check CHECK ((status = 'deleted') = (deleted_at IS NOT NULL))
);
CREATE INDEX users_status_idx ON app.users (status);

-- Only the provider's reference and its result; never ID document data (ARCH-001 §10.2).
CREATE TABLE app.identity_attestations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users (id),
  provider text NOT NULL,
  provider_ref text NOT NULL,
  age_verified boolean NOT NULL,
  real_person_verified boolean NOT NULL,
  verified_at timestamptz NOT NULL,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT identity_attestations_provider_ref_key UNIQUE (provider, provider_ref),
  CONSTRAINT identity_attestations_expiry_check CHECK (expires_at IS NULL OR expires_at > verified_at)
);
CREATE INDEX identity_attestations_user_idx ON app.identity_attestations (user_id);

CREATE TABLE app.consent_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users (id),
  scope text NOT NULL,
  recipient_class text NOT NULL,
  purpose text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT consent_grants_revoked_check CHECK (revoked_at IS NULL OR revoked_at >= granted_at)
);
-- At most one live grant per user, scope, recipient and purpose.
CREATE UNIQUE INDEX consent_grants_one_active_idx
  ON app.consent_grants (user_id, scope, recipient_class, purpose) WHERE revoked_at IS NULL;

CREATE TABLE app.profile_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users (id),
  version integer NOT NULL CHECK (version > 0),
  approval_state text NOT NULL DEFAULT 'draft'
    CONSTRAINT profile_versions_state_check CHECK (approval_state IN ('draft', 'approved', 'superseded', 'withdrawn')),
  structured_json jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  CONSTRAINT profile_versions_user_version_key UNIQUE (user_id, version),
  CONSTRAINT profile_versions_approved_at_check CHECK (approval_state <> 'approved' OR approved_at IS NOT NULL)
);
-- One approved (matchable) profile per user (ADR-009: profiles are user-approved and versioned).
CREATE UNIQUE INDEX profile_versions_one_approved_idx
  ON app.profile_versions (user_id) WHERE approval_state = 'approved';

-- Provenance, certainty and visibility vocabularies are defined by ser-p02-04.
CREATE TABLE app.profile_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_version_id uuid NOT NULL REFERENCES app.profile_versions (id),
  key text NOT NULL,
  value jsonb NOT NULL,
  provenance text NOT NULL,
  certainty text NOT NULL,
  visibility_scope text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT profile_facts_version_key_key UNIQUE (profile_version_id, key)
);

CREATE TABLE app.media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES app.users (id),
  object_key text NOT NULL CONSTRAINT media_assets_object_key_key UNIQUE,
  purpose text NOT NULL,
  content_hash text,
  retention_until timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CONSTRAINT media_assets_status_check CHECK (status IN ('pending', 'active', 'expired', 'deleted')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX media_assets_owner_idx ON app.media_assets (owner_user_id);
-- For the expiry clean-up job.
CREATE INDEX media_assets_retention_idx ON app.media_assets (retention_until) WHERE status <> 'deleted';

CREATE TABLE app.match_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app.users (id),
  version integer NOT NULL CHECK (version > 0),
  active boolean NOT NULL DEFAULT false,
  -- A coarse pilot area such as GZ_CORE (ARCH-001 §7.4); never a home address.
  region text NOT NULL,
  hard_rules jsonb NOT NULL DEFAULT '{}',
  soft_weights jsonb NOT NULL DEFAULT '{}',
  schedule_json jsonb NOT NULL DEFAULT '[]',
  budget_minor bigint CONSTRAINT match_policies_budget_check CHECK (budget_minor IS NULL OR budget_minor >= 0),
  auto_authority jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT match_policies_user_version_key UNIQUE (user_id, version)
);
CREATE UNIQUE INDEX match_policies_one_active_idx ON app.match_policies (user_id) WHERE active;
CREATE INDEX match_policies_region_active_idx ON app.match_policies (region) WHERE active;

-- Down Migration

DROP TABLE app.match_policies;
DROP TABLE app.media_assets;
DROP TABLE app.profile_facts;
DROP TABLE app.profile_versions;
DROP TABLE app.consent_grants;
DROP TABLE app.identity_attestations;
DROP TABLE app.users;
