-- What the venue planner reads from a venue's listing (P03-10, ADR-0027).
--   area                    the home area it sits in (SFB_*): journeys are estimated from it
--   price_per_person_minor  what a date there costs each person, in cents; the budget is a hard rule
--   accommodates            dietary needs it can serve (CHG-001 D4); filled by its reviewed listing
-- A venue without an area or a price is not offered to the planner yet.
-- The date's slot is recorded on app.dates (venue_slot_id) when the date is planned.

-- Up Migration

ALTER TABLE app.venues
  ADD COLUMN area text CONSTRAINT venues_area_check CHECK (area ~ '^[A-Z]{2,4}_[A-Z0-9_]{2,24}$'),
  ADD COLUMN price_per_person_minor integer
    CONSTRAINT venues_price_check CHECK (price_per_person_minor BETWEEN 0 AND 100000),
  ADD COLUMN accommodates text[] NOT NULL DEFAULT '{}';

-- At most one planned date per candidate pair.
CREATE UNIQUE INDEX dates_candidate_pair_key ON app.dates (candidate_pair_id)
  WHERE candidate_pair_id IS NOT NULL;

-- Down Migration

DROP INDEX app.dates_candidate_pair_key;
ALTER TABLE app.venues
  DROP COLUMN accommodates,
  DROP COLUMN price_per_person_minor,
  DROP COLUMN area;
