-- The audit log (append-only) and the transactional notification outbox
-- (ARCH-001 §5, §8.1).

-- Up Migration

CREATE TABLE app.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_type text NOT NULL
    CONSTRAINT audit_events_actor_type_check CHECK (actor_type IN ('user', 'merchant', 'staff', 'system', 'agent')),
  actor_id uuid,
  action text NOT NULL,
  object_type text NOT NULL,
  object_id uuid,
  policy_version integer,
  at timestamptz NOT NULL DEFAULT now(),
  -- Never voice, photo, ID or secret content (ARCH-001 §10.2).
  metadata_redacted jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX audit_events_object_idx ON app.audit_events (object_type, object_id, at);
CREATE INDEX audit_events_at_idx ON app.audit_events (at);

-- Append-only for everyone, owner included; a retention purge needs a
-- deliberate, separately reviewed migration or maintenance role.
REVOKE UPDATE, DELETE, TRUNCATE ON app.audit_events FROM serendipity_app;

CREATE FUNCTION app.audit_events_append_only ()
  RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION 'app.audit_events is append-only (% refused)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER audit_events_no_update_or_delete
  BEFORE UPDATE OR DELETE ON app.audit_events
  FOR EACH ROW
  EXECUTE FUNCTION app.audit_events_append_only ();

CREATE TRIGGER audit_events_no_truncate
  BEFORE TRUNCATE ON app.audit_events
  FOR EACH STATEMENT
  EXECUTE FUNCTION app.audit_events_append_only ();

CREATE TABLE app.notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  kind text NOT NULL,
  recipient_user_id uuid REFERENCES app.users (id),
  payload jsonb NOT NULL DEFAULT '{}',
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz
);
CREATE INDEX notification_outbox_pending_idx ON app.notification_outbox (created_at) WHERE dispatched_at IS NULL;

-- Down Migration

DROP TABLE app.notification_outbox;
DROP TRIGGER audit_events_no_truncate ON app.audit_events;
DROP TRIGGER audit_events_no_update_or_delete ON app.audit_events;
DROP TABLE app.audit_events;
DROP FUNCTION app.audit_events_append_only ();
