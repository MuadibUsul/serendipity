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

- `adr/` — architecture decision records for this codebase ([ADR-0001](adr/0001-monorepo-location-and-toolchain.md) toolchain, [ADR-0002](adr/0002-dedicated-repository.md) this repository, [ADR-0003](adr/0003-database-schema-and-migrations.md) database schema and migrations, [ADR-0004](adr/0004-environments-and-configuration.md) environments and configuration, [ADR-0005](adr/0005-api-service-skeleton.md) the API service skeleton, [ADR-0006](adr/0006-audit-tracing-redaction-and-alerts.md) audit trail, [ADR-0007](adr/0007-profile-facts-and-versions.md) profile facts and versions, [ADR-0008](adr/0008-identity-and-age-verification.md) identity and age verification, [ADR-0009](adr/0009-bilateral-eligibility-and-hard-filters.md) bilateral eligibility and hard filters, [ADR-0010](adr/0010-mobile-shell.md) the mobile app shell, [ADR-0011](adr/0011-anonymous-invitations.md) anonymous date invitations, [ADR-0012](adr/0012-candidate-recall.md) candidate recall, [ADR-0013](adr/0013-sign-in.md) sign-in by phone and code, [ADR-0014](adr/0014-ranking-baseline.md) the ranking baseline, [ADR-0015](adr/0015-a2a-protocol.md) the A2A protocol, [ADR-0016](adr/0016-food-taste-and-dietary-restrictions.md) food taste and dietary restrictions, [ADR-0017](adr/0017-soft-distance.md) soft distance, [ADR-0018](adr/0018-pause-and-resume.md) pausing and resuming, [ADR-0019](adr/0019-private-feedback.md) private feedback, [ADR-0020](adr/0020-mutual-chat.md) mutual chat, [ADR-0021](adr/0021-one-card-a-day.md) one card a day, [ADR-0022](adr/0022-reports-and-bans.md) reports and bans, [ADR-0023](adr/0023-us-market-serendip.md) Serendip in the US, [ADR-0024](adr/0024-tiered-age-and-identity-checks.md) tiered age and identity checks, [ADR-0025](adr/0025-starting-checks-and-vendor-deletion.md) starting checks and vendor deletion, [ADR-0026](adr/0026-sign-in-with-apple-and-google.md) Sign in with Apple and Google, [ADR-0027](adr/0027-planning-the-date.md) planning where and when a pair meets, [ADR-0028](adr/0028-checking-in.md) checking in at the venue, [ADR-0029](adr/0029-date-reminders.md) date reminders and the calendar file, [ADR-0030](adr/0030-push-notifications.md) push notifications).
- [`state-machines.md`](state-machines.md) — every status that changes, its allowed moves and what enforces them (partly generated: `npm run docs:state-machines`).
- `runbooks/` — incident runbooks from PLAN-001 §12.2 (`ser-p05-05`).
- `compliance/` — engineering notes for the privacy data ledger (`ser-p00-07`).
