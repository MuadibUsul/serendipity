-- Lifecycle guards (docs/state-machines.md). Each status below may only move
-- along the edges its lifecycle declares in TypeScript:
--   app.date_invites.status              @serendipity/invitations INVITE_LIFECYCLE
--   app.profile_versions.approval_state  @serendipity/profile     VERSION_LIFECYCLE
--   app.media_assets.status              @serendipity/media       MEDIA_LIFECYCLE
-- The repositories already only make these moves; the guard makes any other
-- write fail loudly, whoever issues it (a new code path, an agent, a hand-run
-- query). Staying in the same state is not a move and is never refused.
-- Inserts are not guarded: fixtures and seeds create rows in any state.
-- packages/db/src/lifecycle-guards.db.test.ts tries every pair of states on
-- each table and checks the database allows exactly the declared edges.

-- Up Migration

-- TG_ARGV[0] is the column; the other arguments are the allowed edges as
-- 'from>to'.
CREATE FUNCTION app.guard_transition ()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, app
  AS $$
DECLARE
  column_name text := TG_ARGV[0];
  old_state text := to_jsonb(OLD) ->> column_name;
  new_state text := to_jsonb(NEW) ->> column_name;
BEGIN
  IF old_state IS DISTINCT FROM new_state
     AND NOT (old_state || '>' || new_state) = ANY (TG_ARGV[1:TG_NARGS - 1]) THEN
    RAISE EXCEPTION '%.%: % → % is not an allowed move', TG_TABLE_NAME, column_name, old_state, new_state
      USING ERRCODE = 'check_violation',
            HINT = 'Allowed moves are listed in docs/state-machines.md.';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER date_invites_status_guard
  BEFORE UPDATE OF status ON app.date_invites
  FOR EACH ROW
  EXECUTE FUNCTION app.guard_transition ('status',
    'pending>accepted', 'pending>declined', 'pending>expired', 'pending>withdrawn',
    'accepted>declined');

CREATE TRIGGER profile_versions_approval_state_guard
  BEFORE UPDATE OF approval_state ON app.profile_versions
  FOR EACH ROW
  EXECUTE FUNCTION app.guard_transition ('approval_state',
    'draft>approved', 'approved>superseded', 'approved>withdrawn');

CREATE TRIGGER media_assets_status_guard
  BEFORE UPDATE OF status ON app.media_assets
  FOR EACH ROW
  EXECUTE FUNCTION app.guard_transition ('status',
    'pending>active', 'pending>expired', 'pending>deleted',
    'active>expired', 'active>deleted',
    'expired>deleted');

-- Down Migration

DROP TRIGGER media_assets_status_guard ON app.media_assets;
DROP TRIGGER profile_versions_approval_state_guard ON app.profile_versions;
DROP TRIGGER date_invites_status_guard ON app.date_invites;
DROP FUNCTION app.guard_transition ();
