# @serendipity/matching

May two people be put forward to each other at all? The deterministic part of matching: PRD-001
§5.1 layers 1 and 2, ARCH-001 §7.1 steps 0–2,
[ADR-0009](../../docs/adr/0009-bilateral-eligibility-and-hard-filters.md). Pure: no I/O, no model,
no score. Recall and ranking (`ser-p03-02`, `ser-p03-03`) and the agents (`ser-p03-05`) only ever
see pairs that passed here, and the decision verifier (`ser-p03-07`) runs it again.

```ts
import { decidePair } from "@serendipity/matching";

const decision = decidePair(a, b, {
  dateLengthMinutes: 90,
  cheapestPackagePerPerson: { currency: "CNY", minor: 8_800 }, // null: nothing on offer, reject
});
// { pass: true } | { pass: false, refusals: [{ side: "a" | "b" | "pair", code, key? }, …] }
```

A pair passes only when **every** gate holds for both people and **every** hard rule holds in both
directions. Swapping the two people gives the same verdict with the sides swapped. Every refusal
that can be established is returned, not only the first.

## What the caller supplies

Each `Candidate` is assembled by the caller from other modules; this package reads nothing itself.

| Field               | From                                                                          |
| ------------------- | ----------------------------------------------------------------------------- |
| `accountStatus`     | `users.status`                                                                |
| `identityEligible`  | `identity.eligible(user)` (`ser-p01-04a`)                                     |
| `age`               | whole years, or `null`; the source is an open owner decision (ADR-0009)       |
| `profileSnapshot`   | the approved `profile_versions.structured_json` (`ser-p02-04a`), or `null`    |
| `confirmedSelfTags` | confirmed `self.interests`, `self.lifestyle`, `self.communication_style` tags |
| `hasActiveDate`     | a date that holds the person's time                                           |
| `blockedIds`        | people this person has blocked                                                |

## Layer 1: gates, each person

| Refusal                                         | When                                                |
| ----------------------------------------------- | --------------------------------------------------- |
| `account_pending\|paused\|suspended\|deleted`   | the account is not `active`                         |
| `identity_ineligible`                           | not a verified adult and real person, or not known  |
| `active_date`                                   | already in a date                                   |
| `blocked_the_other`                             | this person blocked the other (either way rejects)  |
| `no_approved_profile`                           | no approved profile version                         |
| `profile_unreadable`                            | not a schema 1 snapshot                             |
| `profile_rule_missing` / `profile_rule_invalid` | a required hard rule is absent or malformed (`key`) |
| `profile_rule_unknown`                          | a hard rule this filter cannot enforce              |
| `same_person` (pair)                            | both are the same person                            |

## Layer 2: hard rules, both directions

Only the hard rules in the approved snapshot are used: facts the person confirmed. A guess has no
way in.

| Rule                                                  | Refusal                                             |
| ----------------------------------------------------- | --------------------------------------------------- |
| Same `self.city_region`                               | `region_mismatch` (pair)                            |
| Each age known, and inside the other's range          | `age_unknown`, `age_range_excludes`                 |
| Each goal among the goals the other accepts           | `goal_not_accepted`                                 |
| Weekly windows share one stretch of the date's length | `no_shared_time` (pair)                             |
| Both budgets reach the cheapest package, in its money | `budget_below_package`, `budget_currency_mismatch`, |
|                                                       | `no_package` (pair)                                 |
| No dealbreaker among the other's confirmed self tags  | `dealbreaker`                                       |

`side` names the person whose gate or rule refused. `seeking.max_distance_km` must be present, but
distance is checked against a venue when one is chosen (`ser-p03-02`).

Shared time is counted within one day; a person's touching windows (10:00–11:00, 11:00–12:00) count
as one stretch. Windows are local time in the pair's shared region.

## Refusals are internal

They go to the audit trail and `candidate_pairs`, for tuning and appeals. **Never show one to a
user or pass one to an agent**: `blocked_the_other` or `dealbreaker` would disclose the other
person. A user only ever learns that there is no invitation yet.
