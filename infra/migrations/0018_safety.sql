-- Reports, holds, blocks and appeals (PLAN-001 P05-05, ADR-0022).
--   app.user_blocks       who must never be matched with whom again
--   app.users.match_hold_at  a high-risk report holds a person from matching until staff decide
--   app.safety_reports    a report about someone the reporter had a date with
--   app.safety_appeals    an appeal against a suspension, decided by a person

-- Up Migration

CREATE TABLE app.user_blocks (
  blocker_id uuid NOT NULL REFERENCES app.users (id),
  blocked_id uuid NOT NULL REFERENCES app.users (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT user_blocks_two_people_check CHECK (blocker_id <> blocked_id)
);
CREATE INDEX user_blocks_blocked_idx ON app.user_blocks (blocked_id);

ALTER TABLE app.users ADD COLUMN match_hold_at timestamptz;

CREATE TABLE app.safety_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES app.users (id),
  subject_id uuid NOT NULL REFERENCES app.users (id),
  date_id uuid REFERENCES app.dates (id),
  category text NOT NULL CONSTRAINT safety_reports_category_check CHECK (category IN (
    'threat_or_violence', 'sexual_misconduct', 'stalking', 'minor_suspected',
    'harassment', 'fake_identity', 'scam', 'no_show', 'inappropriate_content', 'felt_unsafe', 'other')),
  risk text NOT NULL CONSTRAINT safety_reports_risk_check CHECK (risk IN ('high', 'standard')),
  -- For staff only; never shown to the reported person.
  details text CONSTRAINT safety_reports_details_check CHECK (char_length(details) <= 1000),
  status text NOT NULL DEFAULT 'open'
    CONSTRAINT safety_reports_status_check CHECK (status IN ('open', 'actioned', 'dismissed', 'overturned')),
  decision text CONSTRAINT safety_reports_decision_check CHECK (decision IN ('suspend', 'warn', 'dismiss')),
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT safety_reports_two_people_check CHECK (reporter_id <> subject_id),
  CONSTRAINT safety_reports_decided_check CHECK ((status = 'open') = (decided_at IS NULL))
);
CREATE INDEX safety_reports_queue_idx ON app.safety_reports (status, risk, created_at);
CREATE INDEX safety_reports_subject_idx ON app.safety_reports (subject_id);

CREATE TABLE app.safety_appeals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES app.safety_reports (id),
  statement text NOT NULL CONSTRAINT safety_appeals_statement_check CHECK (char_length(statement) BETWEEN 1 AND 2000),
  status text NOT NULL DEFAULT 'open'
    CONSTRAINT safety_appeals_status_check CHECK (status IN ('open', 'upheld', 'overturned')),
  recorded_by text NOT NULL,
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT safety_appeals_decided_check CHECK ((status = 'open') = (decided_at IS NULL))
);
CREATE UNIQUE INDEX safety_appeals_one_open_idx ON app.safety_appeals (report_id) WHERE status = 'open';

CREATE TRIGGER safety_reports_status_guard
  BEFORE UPDATE OF status ON app.safety_reports
  FOR EACH ROW
  EXECUTE FUNCTION app.guard_transition ('status', 'open>actioned', 'open>dismissed', 'actioned>overturned');

-- Down Migration

DROP TRIGGER safety_reports_status_guard ON app.safety_reports;
DROP TABLE app.safety_appeals;
DROP TABLE app.safety_reports;
ALTER TABLE app.users DROP COLUMN match_hold_at;
DROP TABLE app.user_blocks;
