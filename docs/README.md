# docs/

The product documents are kept in the Veynod workspace, namespace `serendipity`, and are the source
of truth; do not copy them here.

| Document                | Veynod address                    |
| ----------------------- | --------------------------------- |
| PRD — 完整产品设计      | `doc://product-prd`               |
| ARCH-001 — 技术架构设计 | `doc://technical-architecture`    |
| PLAN-001 — 工程实施方案 | `doc://engineering-delivery-plan` |

Work is tracked as the Veynod task tree `serendipity-mvp` (EPIC-00 … EPIC-06, task keys `ser-pNN-NN`).

This directory holds what belongs next to the code:

- `adr/` — architecture decision records for this codebase ([ADR-0001](adr/0001-monorepo-location-and-toolchain.md) toolchain, [ADR-0002](adr/0002-dedicated-repository.md) this repository, [ADR-0003](adr/0003-database-schema-and-migrations.md) database schema and migrations, [ADR-0004](adr/0004-environments-and-configuration.md) environments and configuration, [ADR-0005](adr/0005-api-service-skeleton.md) the API service skeleton, [ADR-0006](adr/0006-audit-tracing-redaction-and-alerts.md) audit trail, [ADR-0007](adr/0007-profile-facts-and-versions.md) profile facts and versions, [ADR-0008](adr/0008-identity-and-age-verification.md) identity and age verification, [ADR-0009](adr/0009-bilateral-eligibility-and-hard-filters.md) bilateral eligibility and hard filters, [ADR-0010](adr/0010-mobile-shell.md) the mobile app shell, [ADR-0011](adr/0011-anonymous-invitations.md) anonymous date invitations, [ADR-0012](adr/0012-candidate-recall.md) candidate recall, [ADR-0013](adr/0013-sign-in.md) sign-in by phone and code, [ADR-0014](adr/0014-ranking-baseline.md) the ranking baseline, [ADR-0015](adr/0015-a2a-protocol.md) the A2A protocol, [ADR-0016](adr/0016-food-taste-and-dietary-restrictions.md) food taste and dietary restrictions, [ADR-0017](adr/0017-soft-distance.md) soft distance, [ADR-0018](adr/0018-pause-and-resume.md) pausing and resuming).
- [`state-machines.md`](state-machines.md) — every status that changes, its allowed moves and what enforces them (partly generated: `npm run docs:state-machines`).
- `runbooks/` — incident runbooks from PLAN-001 §12.2 (`ser-p05-05`).
- `compliance/` — engineering notes for the privacy data ledger (`ser-p00-07`).
