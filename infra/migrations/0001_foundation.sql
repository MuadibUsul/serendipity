-- Extensions, the `app` schema and deny-by-default privileges.
--
-- PUBLIC gets nothing in `app`. Services connect with their own login roles
-- and are granted the NOLOGIN group role `serendipity_app` (set up per
-- environment by ser-p01-02); tables and functions created by later
-- migrations are granted to that role by default and to nobody else.

-- Up Migration

CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE SCHEMA app;
COMMENT ON SCHEMA app IS 'Serendipity application data (ARCH-001 §5). Deny by default: only serendipity_app is granted.';
REVOKE ALL ON SCHEMA app FROM PUBLIC;

DO $$
BEGIN
  CREATE ROLE serendipity_app NOLOGIN;
EXCEPTION
  -- The role is cluster-wide and may exist already (another database of the
  -- same cluster, or a concurrent migration).
  WHEN duplicate_object OR unique_violation THEN NULL;
END
$$;

GRANT USAGE ON SCHEMA app TO serendipity_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO serendipity_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT EXECUTE ON FUNCTIONS TO serendipity_app;

-- Down Migration

ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE EXECUTE ON FUNCTIONS FROM serendipity_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA app REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM serendipity_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA app GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
DROP SCHEMA app;

DROP EXTENSION IF EXISTS vector;
DROP EXTENSION IF EXISTS postgis;
DROP EXTENSION IF EXISTS btree_gist;

DO $$
BEGIN
  DROP ROLE IF EXISTS serendipity_app;
EXCEPTION
  -- Still used by another database of this cluster: leave it.
  WHEN dependent_objects_still_exist THEN
    RAISE NOTICE 'serendipity_app is still used elsewhere in this cluster; not dropped';
END
$$;
