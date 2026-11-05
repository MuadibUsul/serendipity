-- Venues, their slots, and dates with invitations, check-ins, feedback and
-- relationships (ARCH-001 §5, §8, §9).
--
-- A person cannot hold two dates in overlapping time: every date writes one
-- row per person into date_participants (by trigger, so no caller can skip
-- it), and an exclusion constraint forbids two overlapping rows of the same
-- person while their dates hold time.

-- Up Migration

CREATE TABLE app.venues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  region text NOT NULL,
  address text NOT NULL,
  location geography (Point, 4326) NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CONSTRAINT venues_status_check CHECK (status IN ('pending', 'active', 'suspended', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX venues_location_idx ON app.venues USING gist (location);
CREATE INDEX venues_region_idx ON app.venues (region) WHERE status = 'active';

CREATE TABLE app.venue_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  venue_id uuid NOT NULL REFERENCES app.venues (id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  -- Tables (one date each) the venue offers in this slot.
  capacity integer NOT NULL CHECK (capacity > 0),
  reserved integer NOT NULL DEFAULT 0 CHECK (reserved >= 0),
  status text NOT NULL DEFAULT 'open'
    CONSTRAINT venue_slots_status_check CHECK (status IN ('open', 'closed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT venue_slots_time_check CHECK (ends_at > starts_at),
  CONSTRAINT venue_slots_within_capacity_check CHECK (reserved <= capacity),
  CONSTRAINT venue_slots_venue_start_key UNIQUE (venue_id, starts_at)
);

-- The date states during which a person's time is held: from both accepting
-- (before any money is asked for) until the reveal, while the venue is being
-- rebooked, and during a safety hold (which may resume). Keep in step with
-- @serendipity/domain; the test suite compares the two.
CREATE FUNCTION app.date_status_holds_time (status text)
  RETURNS boolean
  LANGUAGE sql
  IMMUTABLE
  PARALLEL SAFE
  RETURN status IN ('BOTH_ACCEPTED', 'PAYMENT_PENDING', 'BOTH_PAID', 'VENUE_RESERVED', 'CONFIRMED',
    'VENUE_UNAVAILABLE', 'CHECKIN_PARTIAL', 'BOTH_CHECKED_IN', 'REVEALED', 'SAFETY_HOLD');

CREATE TABLE app.dates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a uuid NOT NULL REFERENCES app.users (id),
  user_b uuid NOT NULL REFERENCES app.users (id),
  candidate_pair_id uuid REFERENCES app.candidate_pairs (id),
  venue_id uuid REFERENCES app.venues (id),
  venue_slot_id uuid REFERENCES app.venue_slots (id),
  -- The state of the @serendipity/domain date machine (ARCH-001 §8.1).
  status text NOT NULL DEFAULT 'DRAFT'
    CONSTRAINT dates_status_check CHECK (status IN (
      'DRAFT', 'ELIGIBLE', 'INVITED', 'BOTH_ACCEPTED', 'PAYMENT_PENDING', 'BOTH_PAID',
      'VENUE_RESERVED', 'CONFIRMED', 'CHECKIN_PARTIAL', 'BOTH_CHECKED_IN', 'REVEALED',
      'COMPLETED', 'POST_DATE_FEEDBACK', 'CLOSED',
      'EXPIRED', 'CANCELLED_BEFORE_PAYMENT', 'CANCELLED_REFUND_PENDING', 'NO_SHOW_UNDER_REVIEW',
      'SAFETY_HOLD', 'VENUE_UNAVAILABLE', 'PARTIAL_REFUND', 'DISPUTED')),
  machine_version integer NOT NULL DEFAULT 1,
  -- Optimistic lock: the machine's revision; writers update WHERE revision = expected.
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  -- The machine's per-person facts (accepted, paid, checked in, venue, hold origin).
  machine_context jsonb NOT NULL DEFAULT '{}',
  start_at timestamptz,
  end_at timestamptz,
  booking_ref text CONSTRAINT dates_booking_ref_key UNIQUE,
  policy_snapshot_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dates_two_people_check CHECK (user_a <> user_b),
  CONSTRAINT dates_time_check CHECK ((start_at IS NULL) = (end_at IS NULL) AND (end_at IS NULL OR end_at > start_at)),
  CONSTRAINT dates_time_held_check CHECK (NOT app.date_status_holds_time(status) OR start_at IS NOT NULL)
);
CREATE INDEX dates_status_idx ON app.dates (status);
CREATE INDEX dates_user_a_idx ON app.dates (user_a);
CREATE INDEX dates_user_b_idx ON app.dates (user_b);

-- Derived from app.dates by trigger only; the application role can read it but not write it.
CREATE TABLE app.date_participants (
  date_id uuid NOT NULL REFERENCES app.dates (id) ON DELETE CASCADE,
  party char(1) NOT NULL CHECK (party IN ('A', 'B')),
  user_id uuid NOT NULL REFERENCES app.users (id),
  during tstzrange,
  holds_time boolean NOT NULL,
  PRIMARY KEY (date_id, party),
  CONSTRAINT date_participants_no_overlap
    EXCLUDE USING gist (user_id WITH =, during WITH &&) WHERE (holds_time)
);
REVOKE INSERT, UPDATE, DELETE ON app.date_participants FROM serendipity_app;

CREATE FUNCTION app.sync_date_participants ()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, app
  AS $$
DECLARE
  span tstzrange := CASE WHEN NEW.start_at IS NULL THEN NULL ELSE tstzrange(NEW.start_at, NEW.end_at, '[)') END;
  holds boolean := app.date_status_holds_time(NEW.status);
BEGIN
  INSERT INTO app.date_participants (date_id, party, user_id, during, holds_time)
  VALUES (NEW.id, 'A', NEW.user_a, span, holds), (NEW.id, 'B', NEW.user_b, span, holds)
  ON CONFLICT (date_id, party) DO UPDATE
    SET user_id = EXCLUDED.user_id, during = EXCLUDED.during, holds_time = EXCLUDED.holds_time;
  RETURN NULL;
END
$$;

CREATE TRIGGER dates_sync_participants
  AFTER INSERT OR UPDATE OF user_a, user_b, status, start_at, end_at ON app.dates
  FOR EACH ROW
  EXECUTE FUNCTION app.sync_date_participants ();

CREATE TABLE app.date_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date_id uuid NOT NULL REFERENCES app.dates (id),
  user_id uuid NOT NULL REFERENCES app.users (id),
  status text NOT NULL DEFAULT 'pending'
    CONSTRAINT date_invites_status_check CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'withdrawn')),
  responded_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT date_invites_date_user_key UNIQUE (date_id, user_id),
  CONSTRAINT date_invites_responded_check CHECK ((status IN ('accepted', 'declined')) = (responded_at IS NOT NULL))
);
CREATE INDEX date_invites_pending_idx ON app.date_invites (user_id) WHERE status = 'pending';

CREATE TABLE app.checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date_id uuid NOT NULL REFERENCES app.dates (id),
  user_id uuid NOT NULL REFERENCES app.users (id),
  method text NOT NULL
    CONSTRAINT checkins_method_check CHECK (method IN ('qr', 'staff_manual', 'sms_fallback', 'paper_fallback')),
  verified_at timestamptz NOT NULL DEFAULT now(),
  venue_attested boolean NOT NULL DEFAULT false,
  CONSTRAINT checkins_date_user_key UNIQUE (date_id, user_id)
);

CREATE TABLE app.post_date_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date_id uuid NOT NULL REFERENCES app.dates (id),
  user_id uuid NOT NULL REFERENCES app.users (id),
  mutual_interest boolean,
  comfort_rating smallint CONSTRAINT post_date_feedback_rating_check CHECK (comfort_rating BETWEEN 1 AND 5),
  safety_flag boolean NOT NULL DEFAULT false,
  encrypted_note_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT post_date_feedback_date_user_key UNIQUE (date_id, user_id)
);

CREATE TABLE app.relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date_id uuid NOT NULL CONSTRAINT relationships_date_key UNIQUE REFERENCES app.dates (id),
  user_a uuid NOT NULL REFERENCES app.users (id),
  user_b uuid NOT NULL REFERENCES app.users (id),
  mutual_opt_in_at timestamptz,
  chat_open boolean NOT NULL DEFAULT false,
  blocked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT relationships_two_people_check CHECK (user_a <> user_b),
  -- Chat opens only after both opted in, and never while blocked (ADR-008, PLAN-001 §8.3).
  CONSTRAINT relationships_chat_needs_opt_in_check CHECK (NOT chat_open OR mutual_opt_in_at IS NOT NULL),
  CONSTRAINT relationships_chat_not_blocked_check CHECK (NOT chat_open OR blocked_at IS NULL)
);

-- Down Migration

DROP TABLE app.relationships;
DROP TABLE app.post_date_feedback;
DROP TABLE app.checkins;
DROP TABLE app.date_invites;
DROP TRIGGER dates_sync_participants ON app.dates;
DROP FUNCTION app.sync_date_participants ();
DROP TABLE app.date_participants;
DROP TABLE app.dates;
DROP FUNCTION app.date_status_holds_time (text);
DROP TABLE app.venue_slots;
DROP TABLE app.venues;
