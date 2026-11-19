-- Pausing matching (PLAN-001 P05-04): why a person paused, and since when.
-- A pause for account deletion leaves the reason empty; resuming clears both.

-- Up Migration

ALTER TABLE app.users
  ADD COLUMN paused_reason text
    CONSTRAINT users_paused_reason_check CHECK (paused_reason IN ('break', 'relationship')),
  ADD COLUMN paused_at timestamptz,
  ADD CONSTRAINT users_paused_only_when_paused_check
    CHECK ((paused_reason IS NULL AND paused_at IS NULL) OR status = 'paused');

-- Down Migration

ALTER TABLE app.users
  DROP CONSTRAINT users_paused_only_when_paused_check,
  DROP COLUMN paused_at,
  DROP COLUMN paused_reason;
