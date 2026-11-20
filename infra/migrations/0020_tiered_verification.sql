-- Tiered age and real-person checks (ADR-0024).
--   identity_attestations.level         liveness (selfie) or document (ID + selfie)
--   identity_attestations.estimated_age  a liveness check's age estimate; never proof alone
--   identity_attestations.face_match     whether the selfie matched the profile photos
--   users.birth_date                     the date of birth given at sign-up: never shown to
--                                        anyone, used only for the 18+ rule and to compare
--                                        with an age estimate

-- Up Migration

ALTER TABLE app.identity_attestations
  ADD COLUMN level text NOT NULL DEFAULT 'document'
    CONSTRAINT identity_attestations_level_check CHECK (level IN ('liveness', 'document')),
  ADD COLUMN estimated_age smallint
    CONSTRAINT identity_attestations_estimated_age_check CHECK (estimated_age BETWEEN 10 AND 120),
  ADD COLUMN face_match boolean,
  -- A liveness check never proves age.
  ADD CONSTRAINT identity_attestations_liveness_age_check CHECK (level = 'document' OR NOT age_verified);

ALTER TABLE app.users
  ADD COLUMN birth_date date
    CONSTRAINT users_birth_date_check CHECK (birth_date > DATE '1900-01-01');

-- Down Migration

ALTER TABLE app.users DROP COLUMN birth_date;
ALTER TABLE app.identity_attestations
  DROP CONSTRAINT identity_attestations_liveness_age_check,
  DROP COLUMN face_match,
  DROP COLUMN estimated_age,
  DROP COLUMN level;
