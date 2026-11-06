# @serendipity/consent

The consent and permission engine: whether a person's data may go to a given recipient for a given
purpose (ARCH-001 §4: every sensitive call goes through `authorize(subject, purpose, recipient)`
first). It **denies by default**, and only the data subject's own grants count. Changes need owner
review (`.github/CODEOWNERS`).

```ts
import { createAuthorizer } from "@serendipity/consent";
import { pgAuditSink, pgGrantSource } from "@serendipity/db";

const consent = createAuthorizer({ grants: pgGrantSource(pool), audit: pgAuditSink(pool) });

const decision = await consent.authorize({
  subject: aliceId, // whose data
  resource: "compatibility_signals",
  purpose: "negotiation",
  recipient: { kind: "counterpart_agent", actingFor: bobId },
});
if (!decision.allowed) throw new Forbidden(decision.reason);
```

- `decide(request, grants)` is the pure core; `createAuthorizer` wraps it.
- The authorizer reads the subject's grants on **every** call, so a revocation stops the very next
  call. Never cache grants in front of it.
- Every decision, allowed or denied, is written to the audit log with no data in it.
- It fails closed: if the grants can't be read, or the decision can't be audited, the request is
  denied.

## How a request is decided

1. **Own data.** A person reading their own data is allowed. A person reading anyone else's data
   directly is denied (`cross_user`).
2. **Recipient fits the subject.** A person's own agent must act for that same person, or the
   request is denied (`cross_user`). A counterpart agent or relationship peer must be someone else
   (`invalid_recipient`).
3. **The flow is in the policy.** The combination of resource, purpose and recipient must be listed
   below. Anything else is denied (`no_flow`), whatever has been granted.
4. **A live, current grant.** The subject must hold a grant that matches the flow's scope, purpose
   and recipient exactly, is not revoked (`grant_revoked`), and is at or above the scope's minimum
   version (`grant_outdated`, meaning the person must be asked again). Otherwise the request is
   denied (`no_grant`).

## The policy (version 1)

| Resource                | Purpose                  | Recipient           | Scope                    |
| ----------------------- | ------------------------ | ------------------- | ------------------------ |
| `voice_audio`           | `profile_interview`      | `voice_provider`    | `voice_processing`       |
| `transcript`            | `profile_interview`      | `voice_provider`    | `voice_processing`       |
| `transcript`            | `profile_extraction`     | `profile_extractor` | `voice_processing`       |
| `profile_facts`         | `matching`               | `matching_service`  | `profile_matching`       |
| `profile_facts`         | `negotiation`            | `own_agent`         | `profile_matching`       |
| `match_photos`          | `visual_features`        | `vision_provider`   | `visual_matching`        |
| `visual_features`       | `matching`               | `matching_service`  | `visual_matching`        |
| `compatibility_signals` | `negotiation`            | `counterpart_agent` | `counterpart_disclosure` |
| `chat_messages`         | `relationship_messaging` | `relationship_peer` | `relationship_chat`      |
| `booking_details`       | `date_booking`           | `venue`             | `venue_booking`          |

Only two flows reach **another person**: allow-listed compatibility signals to a candidate's agent,
and chat messages to the other person of an open relationship. Raw voice, transcripts, photos,
visual features and profiles never go to another person or their agent, whatever has been granted
(PLAN-001 §8.1). A test enforces this on the table above.

Scopes are versioned (`SCOPES`). When a scope's meaning changes, raise its `minimumVersion`:
grants below it stop counting, and the person is asked again. Adding or removing a flow bumps
`CONSENT_POLICY_VERSION`, which every audit entry records.

## What it does not decide

- Whether two people are really a candidate pair, or an open relationship: the negotiation worker
  (`ser-p03-05`) and the relationship rules (`ser-p05-02`, enforced in the database by
  `relationships_*_check`) establish that before asking.
- Staff and support access to private data, which needs a role and a recorded reason
  (`ser-p04-10`, `ser-p05-05`, red-teamed by `ser-p05-07`).
- Whether the account itself is active, paused or deleted (`ser-p05-04`, `ser-p05-06`).

## Tests

- `decide.test.ts`: every flow with and without its grant, revoked, outdated, near-miss grants and
  other people's grants; every cross-user case; the audit record.
- `decide.property.test.ts` (fast-check):
  - deny by default;
  - decisions equal a restatement of the policy;
  - revocation stops every later call;
  - no other person's principal reaches raw data, even with every possible grant;
  - other people's grants are ignored;
  - every decision is audited.
- `authorizer.test.ts`: grants are re-read per call, every decision is audited, and the authorizer
  fails closed.
- `packages/db/src/consent.db.test.ts`: the same against PostgreSQL, run as the application role.
