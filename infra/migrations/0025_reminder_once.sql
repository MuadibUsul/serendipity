-- Date reminders (P04-09, ADR-0029) go through app.notification_outbox. Each kind of
-- notification about one thing reaches one person at most once, even if two workers run.

-- Up Migration

CREATE UNIQUE INDEX notification_outbox_once_key
  ON app.notification_outbox (aggregate_type, aggregate_id, kind, recipient_user_id);

-- Down Migration

DROP INDEX app.notification_outbox_once_key;
