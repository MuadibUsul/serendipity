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

## Recall (`recall.ts`)

Recall narrows a city to the people who could pass `decidePair` with someone, in PostgreSQL
(`@serendipity/db` `pgRecallRepository`, [ADR-0012](../../docs/adr/0012-candidate-recall.md)). This
package holds its rules in TypeScript: `recallEntryOf` builds a person's indexable entry from the same
facts `decidePair` takes, and `mayRecall` is the prefilter the SQL runs. It is a **superset** of
`decidePair`: it may keep a pair `decidePair` refuses, never the other way round. Property tests check
that, and a database test checks that the SQL agrees with `mayRecall` on a synthetic city.

Availability is kept as one bit per whole free quarter hour of the week. A shared stretch of _L_
minutes always holds ⌈(_L_ − 28) / 15⌉ consecutive whole quarter hours, so asking for that many
consecutive bits in both masks never loses a pair. Dates shorter than 30 minutes are refused.

## Verifying an agent's PASS

`verifyPass(proposed, now)` is the decision verifier (`ser-p03-07`). An agent's `PASS` is only a
proposal. Before anyone is invited, it is checked again against the world as it is now.

- The negotiation ended in `PASS`, under a supported protocol.
- It is about these two people, and the candidate pair has not expired.
- Both people still hold matching consent, under the policy version the pair was recalled with.
  Consent that was withdrawn, or re-granted under a new policy, overturns it.
- `decidePair` still passes, run fresh. A pause, a block or another date since then overturns it.

Every outcome returns the audit event to write (`match.pass.confirmed` or `match.pass.overturned`).
The event carries reason codes only, never ids or rule values. A property test checks that the
verifier never confirms a pair `decidePair` now refuses.
