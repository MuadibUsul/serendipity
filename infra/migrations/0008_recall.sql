-- Candidate recall (ARCH-001 §7.1 steps 0–3, ser-p03-02a, ADR-0012).
--
-- One row per person who may be recalled: the hard rules of their approved
-- profile in a form PostgreSQL can filter on, and optionally an embedding of
-- their approved profile summary. Derived and rebuildable: the approved
-- profile and the identity attestations stay the source of truth, and the
-- exact bilateral filter (@serendipity/matching decidePair) still decides
-- every pair recall puts forward. Never photos, voice or transcripts
-- (ARCH-001 §5): the embedding is of the approved, matching-visible summary.

-- Up Migration

CREATE TABLE app.recall_entries (
  user_id uuid PRIMARY KEY REFERENCES app.users (id),
  -- The approved version this entry was built from; recall ignores the entry
  -- once another version is approved.
  profile_version_id uuid NOT NULL REFERENCES app.profile_versions (id),
  region text NOT NULL,
  age integer NOT NULL CONSTRAINT recall_entries_age_check CHECK (age BETWEEN 18 AND 120),
  age_min integer NOT NULL,
  age_max integer NOT NULL,
  goal text NOT NULL,
  accepts_goals text[] NOT NULL CONSTRAINT recall_entries_accepts_goals_check CHECK (cardinality(accepts_goals) > 0),
  -- Weekly availability, one bit per quarter hour from Monday 00:00 local
  -- time: bit i is set when the whole quarter hour i is free.
  availability bit(672) NOT NULL,
  budget_currency text NOT NULL,
  budget_minor bigint NOT NULL CONSTRAINT recall_entries_budget_check CHECK (budget_minor >= 0),
  dealbreakers text[] NOT NULL DEFAULT '{}',
  self_tags text[] NOT NULL DEFAULT '{}',
  -- The identity verdict when the entry was built; null means it does not expire.
  eligible_until timestamptz,
  embedding_model text,
  embedding vector(1024),
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recall_entries_age_range_check CHECK (18 <= age_min AND age_min <= age_max),
  CONSTRAINT recall_entries_embedding_check CHECK ((embedding IS NULL) = (embedding_model IS NULL))
);
CREATE INDEX recall_entries_region_age_idx ON app.recall_entries (region, age);
-- No approximate (HNSW) index on the embedding: after the bilateral filters a
-- person's pool is a few hundred to a few thousand rows, which are ordered
-- exactly, and the planner does not choose an ANN index there (ADR-0012).

-- Down Migration

DROP TABLE app.recall_entries;
