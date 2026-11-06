# ADR-0004: Environments and runtime configuration

- **Status:** accepted
- **Date:** 2026-11-06
- **Task:** `ser-p01-02a` (PLAN-001 P01-02, the part that needs no hosting decision)

## Context

PLAN-001 P01-02 asks for dev, staging and prod that share no database and no secrets. Where staging
and prod run is decided with the pilot region and legal entity (`ser-p00-02`); until then only dev
runs. Mistakes that join environments are usually copy-paste: a staging process started with the
prod connection string, or a laptop pointed at a deployed secret store.

## Decision

1. **Four environments:** `dev` (a developer machine), `test` (automated suites), `staging` and
   `prod`. Each has a definition in `infra/environments/<env>.json`, holding names and shapes,
   never secret values. Staging and prod hosts stay unset until `ser-p01-02b`.
2. **One configuration loader:** every process reads its settings through `@serendipity/config`.
   `requireConfig(process.env)` refuses to start on any problem, and lists all problems at once.
3. **Isolation is structural**, not a convention:
   - The database must be named `serendipity_<env>`; test suites may add a suffix. A process of
     one environment therefore cannot open another environment's database, even on the same server.
   - A staging or prod secret store must be a managed store whose name carries that environment,
     and must not name any other. Dev and test read local environment variables and may not name
     a deployed environment's store.
   - No environment may use a database host named for another environment.
4. **Deployed environments refuse anything local or weak:**
   - Staging and prod refuse local hosts (including the Compose host `postgres`), connections
     without TLS (`sslmode=require`, `verify-ca` or `verify-full`), the development password, and
     anything named `fixture`.
   - Prod refuses debug logging.
5. **Feature flags** (`visualMatching`, `a2aNegotiation`, `paidBooking`, `liveChat`; ARCH-001
   §13.2) are off unless an environment variable switches them on, and every environment
   definition keeps them off.
6. **The dev environment is Docker Compose** (`infra/docker/compose.dev.yml`, started with
   `npm run dev:up`):
   - The image `infra/docker/postgres` is the official PostgreSQL 17 on Debian bookworm with
     pgvector 0.8.1, plus PostGIS 3 from apt.postgresql.org. The `postgis/postgis:17-3.5` image
     was rejected: it is based on bullseye, which apt.postgresql.org no longer serves.
   - The database reports health through `pg_isready`, and a one-shot `migrate` service applies
     every migration once it is healthy.
   - The `dev-stack` CI job runs exactly that command and checks that every migration was applied.

## Consequences

- A service only needs `requireConfig(process.env)` at start-up to get all of these guarantees.
  The API skeleton (`ser-p01-09`, [ADR-0005](0005-api-service-skeleton.md)) is the first to use it.
- The secret-store URIs in the staging and prod definitions are placeholders for the provider
  chosen in `ser-p00-02`. When that provider is known, its scheme replaces `secret-store://` and the
  name rule stays the same.
- Rollback to a previous image, service health, metrics and alerts per environment arrive with a
  deployable service and hosting (`ser-p01-02b`).
