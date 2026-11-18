# @serendipity/invitations

Anonymous date invitations: what each person may see before the reveal, and the rules for
accepting, declining and expiring (PRD-001 §5.3, §6.1, §7; ARCH-001 §8.1, ADR-006;
[ADR-0011](../../docs/adr/0011-anonymous-invitations.md)). Pure: every change goes through the
`@serendipity/domain` date machine. Stored by `pgInvitationRepository` in `@serendipity/db`, served
by `services/api`.

```ts
import { decideAnswer, invitationView } from "@serendipity/invitations";

invitationView(record, now); // { date_id, status, answer_by, starts_at, ends_at, venue }
decideAnswer(record, "accept", now); // { ok: true, date, inviteStatus, … } | { ok: false, refusal }
```

## What a person sees

`InvitationView` is built field by field from an allowlist (`VIEW_KEYS`, `VENUE_KEYS`):

- the date's id;
- its status;
- until when an answer is taken;
- the time;
- the venue's name and address.

It never includes the other person's id, profile, photos or contact, and the record it is built
from never holds them.

| `status`       | Means                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| `awaiting_you` | Waiting for this person's answer                                                                       |
| `accepted`     | This person accepted; not confirmed yet                                                                |
| `confirmed`    | Both accepted; the date moves on to payment                                                            |
| `declined`     | This person declined                                                                                   |
| `closed`       | Not happening, with no reason shown. A decline by the other person and an expiry look exactly the same |

Whether the other person has accepted is never shown before both have.

## Rules

| Answer                 | When                                                | Result                                                                         |
| ---------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------ |
| Accept                 | Invited, before the deadline                        | `PARTY_ACCEPTED`; both accepted → `BOTH_ACCEPTED`                              |
| Decline                | Invited, before the deadline, even after accepting  | `CANCEL` → `CANCELLED_BEFORE_PAYMENT`; a pending other invitation is withdrawn |
| The same answer again  | Any time                                            | Nothing changes; not an error                                                  |
| Accept after declining | Any time                                            | Refused: `already_declined`                                                    |
| Anything               | At or after the deadline (even before the job runs) | Refused: `expired`                                                             |
| Anything               | The date is closed or past the invitation           | Refused: `closed` (cancelling a confirmed date is `ser-p04-07`)                |

The expiry job sends `EXPIRE` once the deadline has passed and the two have not both accepted.
