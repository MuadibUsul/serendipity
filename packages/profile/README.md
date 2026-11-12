# @serendipity/profile

Profile facts and the rules that keep model guesses out of hard rules (PRD-001 §4.1–4.2, ARCH-001
§6.1, [ADR-0007](../../docs/adr/0007-profile-facts-and-versions.md)). Pure: no I/O. Versions
are stored by `pgProfileRepository` in `@serendipity/db`.

```ts
import { applyProposals, confirmFact, hardRules, missingRequired } from "@serendipity/profile";

// The extractor proposes; nothing it says is ever `confirmed`.
const { facts, conflicts, refused } = applyProposals(current, extractorOutput, now);
// The person confirms on the review screen, as shown or corrected.
const result = confirmFact(facts, "seeking.max_distance_km", now, 20);
// Matchable only when every required fact is confirmed.
missingRequired(facts); // [] → the version can be approved
hardRules(facts); // confirmed facts of hard-capable keys, nothing else
```

## Provenance

| Provenance  | Means                                         | Can be a hard rule |
| ----------- | --------------------------------------------- | ------------------ |
| `explicit`  | The person said it; the extractor recorded it | no                 |
| `confirmed` | The person confirmed it on the review screen  | yes                |
| `inferred`  | The agent's assumption                        | no                 |
| `outdated`  | Not touched for 180 days; due to be checked   | no                 |

When an extractor proposes a value for a fact that already exists:

- **Fact `confirmed`:** never changed. A different value comes back as a conflict, for the person
  to decide.
- **Fact `explicit`:** a new `explicit` value replaces it (the person changed their mind). An
  `inferred` one comes back as a conflict.
- **Fact `inferred` or `outdated`:** any valid proposal replaces it.
- **Same value as stored:** counts only as stronger evidence (an `inferred` fact becomes
  `explicit`), never as a confirmation.
- **Refused outright:** unknown keys, invalid values, and proposals that claim `confirmed` or
  `outdated`.

## Catalog (schema version 1)

| Key                           | Value                   | Required | Hard | Default visibility |
| ----------------------------- | ----------------------- | -------- | ---- | ------------------ |
| `self.city_region`            | region code (`GZ_CORE`) | yes      | yes  | matching           |
| `self.relationship_goal`      | one goal                | yes      | yes  | matching           |
| `self.availability`           | weekly windows          | yes      | yes  | matching           |
| `self.interests`              | tags                    |          |      | matching           |
| `self.communication_style`    | tags                    |          |      | matching           |
| `self.lifestyle`              | tags                    |          |      | matching           |
| `self.occupation_category`    | broad category          |          |      | private            |
| `seeking.age_range`           | years, 18–99            | yes      | yes  | matching           |
| `seeking.relationship_goals`  | goals accepted          | yes      | yes  | matching           |
| `seeking.max_distance_km`     | 1–100 km                | yes      | yes  | matching           |
| `seeking.dealbreakers`        | tags                    |          | yes  | matching           |
| `seeking.interests`           | weighted tags (1–3)     |          |      | matching           |
| `seeking.communication_style` | weighted tags           |          |      | matching           |
| `seeking.appearance_style`    | weighted tags           |          |      | private            |
| `date.budget_per_person`      | CNY, minor units        | yes      | yes  | matching           |

Visibility:

- `private`: the person and their own agent.
- `matching`: also the matching service.
- `signal`: also a coarse compatibility signal for a candidate's agent.

Each use is still decided by the consent engine.

Tags are lower-case words (`[a-z][a-z0-9_]*`, never five digits in a row, so no phone number fits).

Sensitive categories (ethnicity, religion, health, sexual orientation, …) are not in the catalog.
Adding one is a reviewed catalog change with its own consent, never something an extractor can do.
