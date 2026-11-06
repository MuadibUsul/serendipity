# 不期 Serendipity

An AI-native blind-date app. A voice conversation builds your profile, two scoped agents check the
match from both sides, and the two of you meet at a partner venue without photos or chat beforehand.
Each person pays their own share through a licensed payment provider, and you check in at the venue
before identities are revealed. Chat opens only if both of you want to continue.

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

# Database suites: PostgreSQL 17 + PostGIS + pgvector (sudo infra/postgres/install-ubuntu.sh)
DATABASE_URL=postgresql://serendipity:serendipity@127.0.0.1:5432/postgres npm run test:db

# Fictional data for a local database (migrated and empty)
DATABASE_URL=postgresql://…/serendipity_dev npm run db:seed -- --seed 7
```

Read [CONTRIBUTING.md](CONTRIBUTING.md) before the first change. Toolchain choices are in
[ADR-0001](docs/adr/0001-monorepo-location-and-toolchain.md); why this repository exists is in
[ADR-0002](docs/adr/0002-dedicated-repository.md).
