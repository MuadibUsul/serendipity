-- A durable, retryable deletion receipt. Account rows and transaction/audit
-- records are retained as tombstones; source and derived matching data are not.
-- Up Migration

CREATE TABLE app.account_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES app.users (id),
  status text NOT NULL CHECK (status IN ('requested', 'purging', 'failed', 'completed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  failure_stage text CHECK (failure_stage IN ('media', 'database')),
  retained_summary jsonb NOT NULL DEFAULT '{}',
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_deletion_completion_check CHECK ((status = 'completed') = (completed_at IS NOT NULL)),
  CONSTRAINT account_deletion_failure_check CHECK ((status = 'failed') = (failure_stage IS NOT NULL))
);
CREATE INDEX account_deletion_status_idx ON app.account_deletion_requests (status, updated_at);

-- Serialize photo creation/activation with a deletion request's user-row lock.
CREATE FUNCTION app.media_requires_open_account () RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, app
  AS $$
DECLARE account_status text;
BEGIN
  IF NEW.status IN ('pending', 'active') THEN
    SELECT status INTO account_status FROM app.users WHERE id = NEW.owner_user_id FOR UPDATE;
    IF account_status NOT IN ('pending', 'active') OR account_status IS NULL THEN
      RAISE EXCEPTION 'media owner account is not open' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER media_requires_open_account
  BEFORE INSERT OR UPDATE OF status ON app.media_assets
  FOR EACH ROW EXECUTE FUNCTION app.media_requires_open_account ();

-- Down Migration

DROP TRIGGER media_requires_open_account ON app.media_assets;
DROP FUNCTION app.media_requires_open_account ();
DROP TABLE app.account_deletion_requests;
