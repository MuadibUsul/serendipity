-- Swapping contact details (PLAN-001 P05-03): each person's card for one
-- relationship. Shown to the other only once both have offered.

-- Up Migration

CREATE TABLE app.contact_offers (
  relationship_id uuid NOT NULL REFERENCES app.relationships (id),
  user_id uuid NOT NULL REFERENCES app.users (id),
  kind text NOT NULL CONSTRAINT contact_offers_kind_check CHECK (kind IN ('wechat', 'phone', 'other')),
  value text NOT NULL CONSTRAINT contact_offers_value_check CHECK (char_length(value) BETWEEN 1 AND 64),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (relationship_id, user_id)
);

-- Down Migration

DROP TABLE app.contact_offers;
