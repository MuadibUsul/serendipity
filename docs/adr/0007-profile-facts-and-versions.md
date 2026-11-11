# ADR-0007: Profile facts, provenance and versions

- **Status:** accepted
- **Date:** 2026-11-11
- **Task:** `ser-p02-04a` (the part of PLAN-001 P02-04 that needs no voice pipeline or model)

## Context

The person's AI interviews them and an extractor turns what it heard into structured facts.
Models misread and assume. PRD-001 §4.1 and ARCH-001 §6.1 require four things:

- what the model assumes is marked `inferred`;
- only what the person confirms becomes a firm preference;
- "about me" and "looking for" stay apart;
- profiles are versioned and user-approved (ADR-009 in ARCH-001).

Matching (`ser-p03-01`) needs hard rules it can trust. Review (`ser-p02-05`) needs to show where
each fact came from.

## Decision

1. **A closed, versioned catalog** (`packages/profile/src/catalog.ts`, schema version 1). It has
   15 facts under `self.*`, `seeking.*` and `date.*`. Each declares:
   - its value schema;
   - whether it is required before the person can be matched;
   - whether it may become a hard rule;
   - which visibilities it allows.

   Keys outside the catalog are refused. Sensitive categories are left out by design.

2. **Provenance** is `explicit`, `confirmed`, `inferred` or `outdated` (PRD-001 §4.2). An
   extractor can only propose `explicit` or `inferred`.
3. **Strength order** `confirmed > explicit > inferred > outdated` decides what a proposal may
   replace:
   - a confirmed fact is never replaced;
   - a guess never replaces a statement;
   - a statement may replace an earlier statement;
   - a disagreement that may not replace is returned as a conflict for the person.
4. **Only the person confirms** (`confirmFact`), as shown or corrected. Only confirmed facts of
   hard-capable keys become hard rules. Facts untouched for 180 days become `outdated` and stop
   being hard rules until confirmed again.
5. **Versions** are drafts until approved:
   - Approval requires every required fact confirmed. It supersedes the previous approved version
     in the same transaction (one approved version per person, by the existing partial unique
     index).
   - It stores `{schema_version, hard_rules}` in `profile_versions.structured_json` for matching,
     and is audited (`profile.version.approved`, with the trace id; ADR-0006).
   - Approved versions are never edited: a change opens a new draft from them.
   - Withdrawal is audited too.
6. **No migration.** The vocabularies are enforced by `@serendipity/profile` and the repository.
   A database-level CHECK and an approved-facts immutability trigger follow in a migration once
   the open migrations (0008, 0009) have landed.

## Consequences

- The extractor (`ser-p02-04`, after `ser-p02-03`) only has to produce proposals. Nothing it
  outputs can reach matching without the person.
- Review (`ser-p02-05`) gets conflicts to ask about, provenance to show, and the edits it needs
  (confirm, correct, remove, visibility).
- **Open, for the owner and legal:** the catalog has no gender or seeking-gender facts. Matching
  needs them, but PRD-001 §8.2 treats sexual orientation as sensitive (strict necessity, separate
  consent). Adding them is a catalog change waiting on that decision. Diet and accessibility needs
  are left out for the same reason (they can reveal religion or health).
