# @serendipity/identity

Identity and age verification without a chosen vendor (PRD-001 §8.1, ARCH-001 §4 Identity,
[ADR-0008](../../docs/adr/0008-identity-and-age-verification.md)). The vendor is picked in
`ser-p00-04`; its adapter implements `IdentityProvider`, and nothing else changes.

```ts
import { createIdentityService } from "@serendipity/identity";
import { pgAttestationStore } from "@serendipity/db/identity";

const identity = createIdentityService({ provider, store: pgAttestationStore(pool) });

await identity.assertEligible(userId); // throws NotEligible before any invitation or payment
await identity.eligible(userId); // { eligible: true, until } | { eligible: false, reason }
await identity.handleCallback(headers, rawBody); // verifies the signature, records the verdict
```

## Eligible means

A current attestation from the configured provider proving **both** adult age and a real person.
Anything else is a refusal with a reason:

| Reason                     | When                                                                  |
| -------------------------- | --------------------------------------------------------------------- |
| `not_verified`             | No attestation from the configured provider (a fake one never counts) |
| `age_not_verified`         | The latest current check did not establish adult age (a revocation)   |
| `real_person_not_verified` | Adult, but no real-person check                                       |
| `expired`                  | Every attestation has expired, or is dated in the future              |
| `unavailable`              | The store failed or took longer than 2 s: **fail closed**             |

`eligible()` never throws. `assertEligible()` throws `NotEligible`, so a caller cannot carry on by
mistake.

## What is kept

Only the verdict:

- provider and provider reference;
- `age_verified` and `real_person_verified`;
- checked-at and expiry times.

Never names, birthdates, document numbers or images. `readResult` drops every other field a vendor
sends.

Callbacks:

- must be signed (`x-signature: t=…,v1=HMAC-SHA256("<t>.<body>")` for the fake provider) and fresh
  (±5 minutes);
- are idempotent on (provider, provider reference);
- a later verdict replaces an earlier one, while an older or repeated one changes nothing;
- each is audited, replays included.

## The fake provider

`createFakeIdentityProvider({ env, secret })` is for dev and test. It throws in staging and prod.
Its `complete(ref, at, outcome)` returns the signed callback a vendor would send.
