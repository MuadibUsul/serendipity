# ADR-0008: Identity and age verification before a vendor is chosen

- **Status:** accepted
- **Date:** 2026-11-11
- **Task:** `ser-p01-04a` (the part of PLAN-001 P01-04 that does not depend on `ser-p00-04`)

## Context

Gate G1 needs minors refused: no unverified person may be invited to a date or pay for one
(PRD-001 §8.1). Verification is bought from a licensed vendor, chosen with the pilot region
(`ser-p00-04`). ARCH-001 §4 gives Identity one public question, `eligible(user_id)`, and
§10.2 says the backend holds only proof references and results, never raw ID documents.

## Decision

1. **A provider interface** (`IdentityProvider`): start a verification, read a result, and parse
   a signed callback. Results carry only booleans, the provider's reference, the subject (our
   pseudonymous user id) and two times. `readResult` drops every other field.
2. **Deny by default.** A person is eligible only with a current attestation from the configured
   provider that proves both adult age and a real person:
   - The latest current attestation decides, so a failed re-check revokes.
   - Attestations from other providers, the fake one included, never count.
   - The real-person requirement can be relaxed only by an explicit policy option.
3. **Fail closed.** `eligible()` answers `unavailable` when the store errors or takes over 2 s,
   and never throws. `assertEligible()` throws `NotEligible`. Invitation (`ser-p04-02`) and
   payment (`ser-p04-04`) must call it.
4. **Callbacks** need a valid HMAC signature over the timestamp and body, within ±5 minutes, so a
   captured callback cannot be replayed later. The store is idempotent on
   (provider, provider_ref):
   - a later verdict for the same check replaces an earlier one;
   - an older or repeated verdict changes nothing;
   - a check never moves to another person.

   Every attempt is audited (`identity.attestation.recorded|updated|unchanged`, ADR-0006).

5. **A fake provider** for dev and test produces signed callbacks. It refuses to run in staging
   or prod.

## Consequences

- The vendor adapter (after `ser-p00-04`) implements `IdentityProvider`, including the vendor's
  own signature scheme. Eligibility, storage and audit stay as they are.
- The HTTP endpoints (`POST /v1/auth/verify-age`, the vendor callback route) come with
  authentication. They call `startVerification` and `handleCallback`.
- **Open for the owner:** the vendor and whether the real-person check is required at launch
  (on by default here, per PRD-001 §8.1); whether attestations should expire (the vendor
  decides `expires_at` today); and what minors who reach the check are told.
