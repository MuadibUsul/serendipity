# ADR-0016: Food taste is soft; dietary restrictions filter venues, never people

- Status: accepted
- Date: 2026-11-19
- Task: `ser-p02-09`
- Inputs: CHG-001 D4 (owner decision); PRD-001 §1.8, §4.2, §8.2; ARCH-001 §7.3, §10

## Context

Choosing a place to eat is part of every date, and taste is a pleasant thing to share. But "halal",
"kosher" or "nut allergy" can reveal religion or health, which PRD-001 treats as sensitive personal
information. The owner decided that food taste helps matching and venue choice, while dietary
restrictions only rule out venues, behind a consent of their own.

## Decision

1. **Five new profile keys.**
   - Four are soft: `date.cuisines` (weighted tags), `date.tastes`, `date.atmosphere` and
     `date.price_band`. They are never hard rules. The budget ceiling stays the only hard rule
     about money.
   - `date.dietary_restrictions` is its own key. It takes values from a closed list, is private
     only and is never a hard rule.
2. **Its own consent.** A new scope, `dietary_restrictions` (consent policy version 2), allows
   exactly two flows: to the venue filter, and to the person's own agent, for venue selection.
   No flow reaches matching, the other person or their agent.
   - The extractor cannot record the fact without the consent.
   - The person cannot confirm it without the consent.
   - The store (`saveDraft`) refuses it without a live grant.
   - A new draft does not carry it forward once the consent is revoked.
   - `dietaryNeedsOf` reads nothing without the consent, so revoking takes effect on the next call.
3. **Never guessed.** Only what the person said (`explicit`) or confirmed is kept. An extractor's
   `inferred` restriction is refused, because guessing someone's religion or health is exactly
   what PRD-001 §1.8 forbids.
4. **Venues, not people.** The only reader is `@serendipity/venues`.
   - `suitableVenues` uses everyone's needs together, so the venues left never tell one person
     anything about the other's restrictions.
   - The matching snapshot cannot contain these facts. A property test shows the snapshot is
     identical with or without them. A database test shows recall returns the same people after
     everyone gains dietary and taste facts.

## Consequences

- The person must be asked for the dietary consent separately, in the app, before the interview
  can record restrictions. The interview must not probe for them.
- When the consent is revoked, the stored facts stay in the old approved version until the next
  draft. They are never read in the meantime. When the consent-revocation endpoint is built, it
  should also delete them straight away.
- Venues need an `accommodates` list in their listing. Merchant self-onboarding (`ser-p04-03a`)
  collects it.
