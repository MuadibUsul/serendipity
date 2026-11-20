# Serendip

An AI-native blind-date app for the US, launching first in the San Francisco Bay Area (ADR-0023).
A voice conversation builds your profile. Two scoped agents check the match from both sides, and
the two of you meet at a public place you both like, without photos or chat beforehand. In the early
phase dates are free and each person pays for themselves at the venue. You check in on arrival before
you see who the other person is. Chat opens only if both of you want to continue.

This directory is the engineering monorepo. The product documents and the task board live in the
Veynod workspace, namespace `serendipity` (see [docs/](docs/README.md)).

## Status

Prototype phase, no money flow: gate G0 (PLAN-001 §4) has not passed, so nothing here touches real
payments, real photos or real users. Done so far: the repository skeleton (`ser-p01-01`).

## Layout

```text
apps/       mobile, merchant-web, ops-web            → apps/README.md
services/   api, voice-gateway, worker               → services/README.md
packages/   domain, consent, schemas, ai-adapters, a2a-protocol, ui → packages/README.md
infra/      docker, migrations, monitoring           → infra/README.md
tests/      contracts, e2e, security, payment-chaos, model-evals → tests/README.md
docs/       ADRs, runbooks, compliance notes         → docs/README.md
```

## Develop

```bash
npm ci
npm run check   # format check + lint + typecheck + tests (what CI runs)

# Dev database in Docker (PostgreSQL 17 + PostGIS + pgvector, all migrations applied)
npm run dev:up        # DATABASE_URL=postgresql://serendipity:serendipity@127.0.0.1:55432/serendipity_dev
npm run dev:down

# The API from source against it (health, readiness, metrics on :4000)
APP_ENV=dev DATABASE_URL=postgresql://serendipity:serendipity@127.0.0.1:55432/serendipity_dev npm run dev:api

# Database suites: PostgreSQL 17 + PostGIS + pgvector (sudo infra/postgres/install-ubuntu.sh)
DATABASE_URL=postgresql://serendipity:serendipity@127.0.0.1:5432/postgres npm run test:db

# Fictional data for a local database (migrated and empty)
DATABASE_URL=postgresql://…/serendipity_dev npm run db:seed -- --seed 7
```

Read [CONTRIBUTING.md](CONTRIBUTING.md) before the first change. Toolchain choices are in
[ADR-0001](docs/adr/0001-monorepo-location-and-toolchain.md); why this repository exists is in
[ADR-0002](docs/adr/0002-dedicated-repository.md).
