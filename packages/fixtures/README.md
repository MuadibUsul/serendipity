# @serendipity/fixtures

Deterministic, fully fictional test data for tests and local development. Never import it from
production code, and never copy real user data into it (CONTRIBUTING, "Never").

```ts
import { buildDataset } from "@serendipity/fixtures";

const data = buildDataset(42); // the same seed always gives the same rows
data.scenarios; // one per G3 scenario, each with its date and its two people
data.replays; // deliveries the database must refuse (a replayed provider callback)
```

Load it into a migrated, empty database with `seedDataset` from `@serendipity/db`, or from the
command line:

```bash
DATABASE_URL=postgresql://…/serendipity_dev npm run db:migrate
DATABASE_URL=postgresql://…/serendipity_dev npm run db:seed -- --seed 7 --users 50
```

The seeder refuses a database that already holds users, so fixture rows never mix with other data.

## What makes it fictional

- **Reproducible:** a seeded generator (`createRng`, mulberry32) drives every value. The fixtures
  never use `Math.random`, the clock or the network.
- **No personal data:** the schema has no names or contact details for people, and the fixtures
  add none.
- **Marked as fixtures:** venues are called `Fixture Venue N`, in region `FIXTURE_REGION`, at
  addresses ending `Fixture Lane, Testville (fictional)`. Their locations sit within 0.05° of
  0°, 0° (open sea).
- **Marked payments:** the payment provider is `fixture-pay`. Orders, callbacks, idempotency keys
  and booking references carry `fx_ord_`, `fx_evt_`, `fx-` and `FX-`.
- **A test enforces all of it:** every string in a dataset must be an id, a time, a known enum
  value, or contain one of these markers.

## Scenarios

Each date is driven through the `@serendipity/domain` state machine, so its state and per-person
facts are always reachable ones. The payment orders, callbacks, refunds, invitations and check-ins
are derived from those facts.

| Scenario                             | Ends in                    | What it holds                                                |
| ------------------------------------ | -------------------------- | ------------------------------------------------------------ |
| `happy_path`                         | `CLOSED`                   | both paid, checked in, met; feedback closed                  |
| `only_one_paid`                      | `CANCELLED_REFUND_PENDING` | A paid and is refunded; B's order expired                    |
| `duplicate_webhook`                  | `BOTH_PAID`                | A's callback delivered twice: once stored, once in `replays` |
| `both_paid_venue_failed`             | `VENUE_UNAVAILABLE`        | both paid; the venue could not hold the slot                 |
| `venue_cancelled_after_confirmation` | `CANCELLED_REFUND_PENDING` | confirmed, then cancelled by the venue; both refunded        |
| `user_paused`                        | `CANCELLED_BEFORE_PAYMENT` | B's account paused while invited; no payment taken           |
| `one_late`                           | `NO_SHOW_UNDER_REVIEW`     | A checked in, B never came                                   |
| `gateway_timeout_but_charged`        | `CANCELLED_REFUND_PENDING` | the window expired, then A's charge arrived; refunded        |

`extraUsers` (default 20) adds people without a date in a spread of statuses; `venues` (default 3)
sets the number of venues.
