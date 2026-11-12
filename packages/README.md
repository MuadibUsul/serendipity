# packages/

Shared libraries, consumed as TypeScript source by the apps and services.

| Directory       | What                                                                                            | Created by                                |
| --------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `domain/`       | Date state machine and invariants; no I/O                                                       | seeded by `ser-p01-01`; `ser-p04-01`      |
| `consent/`      | Consent engine: `authorize()` denies by default, audits every decision                          | `ser-p01-05`                              |
| `db/`           | Runs `infra/migrations`; grant source and audit writers; seeds fixtures; db suites              | `ser-p01-03`, `ser-p01-08`, `ser-p01-07a` |
| `config/`       | Runtime configuration; refuses cross-environment mistakes                                       | `ser-p01-02a`                             |
| `redact/`       | Removes personal data and secrets from log lines and audit metadata                             | `ser-p01-07a`                             |
| `identity/`     | Age and real-person verification: provider interface, fail-closed eligibility, signed callbacks | `ser-p01-04a`                             |
| `fixtures/`     | Deterministic, fictional test data and the G3 scenarios                                         | `ser-p01-08`                              |
| `schemas/`      | Zod / JSON schemas and API types                                                                | first task that needs them                |
| `ai-adapters/`  | Voice, vision and LLM provider adapters                                                         | `ser-p02-01`, `ser-p02-07`                |
| `a2a-protocol/` | `a2a-match/0.1` messages and the deterministic verifier                                         | `ser-p03-04`, `ser-p03-07`                |
| `ui/`           | Design tokens (colour, type, spacing, touch targets) with WCAG contrast checks                  | `ser-p01-06`                              |

`domain/`, `consent/` and the payment modules need owner review (see `CONTRIBUTING.md`).
