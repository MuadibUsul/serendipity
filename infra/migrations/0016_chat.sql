-- Chat after a mutual yes (PLAN-001 P05-02): messages, and leaving or
-- blocking a relationship. A message can be written only while chat is open
-- and only by one of the two people; the trigger refuses anything else,
-- whatever the application does.

-- Up Migration

ALTER TABLE app.relationships
  ADD COLUMN left_at timestamptz,
  ADD COLUMN left_by uuid REFERENCES app.users (id),
  ADD COLUMN blocked_by uuid REFERENCES app.users (id),
  ADD CONSTRAINT relationships_chat_not_left_check CHECK (NOT chat_open OR left_at IS NULL),
  ADD CONSTRAINT relationships_left_by_check CHECK ((left_at IS NULL) = (left_by IS NULL)),
  ADD CONSTRAINT relationships_blocked_by_check CHECK ((blocked_at IS NULL) = (blocked_by IS NULL));

CREATE TABLE app.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  relationship_id uuid NOT NULL REFERENCES app.relationships (id),
  sender_id uuid NOT NULL REFERENCES app.users (id),
  body text NOT NULL CONSTRAINT chat_messages_body_check CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chat_messages_relationship_idx ON app.chat_messages (relationship_id, created_at, id);

CREATE FUNCTION app.chat_message_guard() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM app.relationships r
    WHERE r.id = NEW.relationship_id AND r.chat_open
      AND NEW.sender_id IN (r.user_a, r.user_b)
  ) THEN
    RAISE EXCEPTION 'chat is not open for this sender' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER chat_messages_guard
  BEFORE INSERT ON app.chat_messages
  FOR EACH ROW EXECUTE FUNCTION app.chat_message_guard();

-- Down Migration

DROP TRIGGER chat_messages_guard ON app.chat_messages;
DROP FUNCTION app.chat_message_guard();
DROP TABLE app.chat_messages;
ALTER TABLE app.relationships
  DROP CONSTRAINT relationships_blocked_by_check,
  DROP CONSTRAINT relationships_left_by_check,
  DROP CONSTRAINT relationships_chat_not_left_check,
  DROP COLUMN blocked_by,
  DROP COLUMN left_by,
  DROP COLUMN left_at;
