-- Candidate pairs and their A2A negotiations (ARCH-001 §7).

-- Up Migration

CREATE TABLE app.candidate_pairs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a uuid NOT NULL REFERENCES app.users (id),
  user_b uuid NOT NULL REFERENCES app.users (id),
  policy_version_a integer NOT NULL,
  policy_version_b integer NOT NULL,
  safety_eligibility text NOT NULL,
  retrieval_version text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Canonical order, so (A, B) and (B, A) are the same pair.
  CONSTRAINT candidate_pairs_ordered_check CHECK (user_a < user_b),
  CONSTRAINT candidate_pairs_user_a_user_b_retrieval_version_key UNIQUE (user_a, user_b, retrieval_version)
);
CREATE INDEX candidate_pairs_user_b_idx ON app.candidate_pairs (user_b);

CREATE TABLE app.negotiations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_pair_id uuid NOT NULL REFERENCES app.candidate_pairs (id),
  -- RUNNING, then one of the a2a-match/0.1 verdicts (ARCH-001 §7.3).
  status text NOT NULL DEFAULT 'RUNNING'
    CONSTRAINT negotiations_status_check
    CHECK (status IN ('RUNNING', 'PASS', 'REJECT', 'NEEDS_USER_CLARIFICATION', 'NO_DECISION')),
  protocol_version text NOT NULL,
  attempt integer NOT NULL DEFAULT 1 CHECK (attempt > 0),
  outcome_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT negotiations_pair_attempt_key UNIQUE (candidate_pair_id, attempt),
  CONSTRAINT negotiations_completed_check CHECK ((status = 'RUNNING') = (completed_at IS NULL))
);

-- Down Migration

DROP TABLE app.negotiations;
DROP TABLE app.candidate_pairs;
