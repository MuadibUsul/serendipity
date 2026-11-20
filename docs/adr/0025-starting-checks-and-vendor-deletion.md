# ADR-0025: Starting checks, biometric consent and vendor deletion

- Status: accepted; the vendor is still to be chosen
- Date: 2026-11-20
- Inputs: ADR-0024 (tiered checks), ADR-0008 (identity verification), the owner's instructions
  of 2026-11-20 (consent before collection; the vendor keeps the evidence; no paid vendor and no
  real ID yet)

## Decision

1. **A separate biometric consent, asked for before the first selfie.**
   - Consent policy version 4 adds one flow: `verification_media` for `identity_verification`,
     sent to the `identity_provider`, under the scope `biometric_verification`. No other flow
     sends that data, and the scope covers nothing else (a test pins both).
   - The text says what is collected (a selfie video, and an ID only when needed), who holds it
     (the vendor, not Serendip), what we keep (the result and the vendor's reference), and how
     deletion works. `GET /v1/me/verification` returns it in full with its version.
   - The person agrees with `PUT /v1/me/verification/consent`, sending
     `{"agreed": true, "version": n}`. A request with a version other than the one shown is
     refused, so nobody agrees to text they did not see. The agreement is audited.
   - Retention periods at the vendor, and wording for BIPA, CPRA and other state laws, are for
     legal review. The text is a draft until then.
2. **Starting a check** (`POST /v1/me/verification`). It starts only when all of these hold:
   - the account is open;
   - a date of birth was given, so a declared minor never reaches a vendor;
   - the biometric consent is held;
   - the person is not verified already, since each check costs money;
   - fewer than 3 checks were started today, in Pacific time.

   The check is a selfie liveness check, or an ID check when tiering asks for one. The response
   says which, but never why: a report is not revealed to the person it is about. The answer is
   the vendor's URL. We record the vendor, its reference and the level, never the media.

3. **The vendor's callback** (`POST /v1/identity/callback`).
   - It is authenticated by an HMAC over the exact raw bytes of the body, with a 5-minute window.
     A re-serialised body does not pass (a test pins this).
   - It answers 204 for a verdict that was recorded, repeated or is still pending, and 401 for
     anything unsigned or tampered with.
   - A verdict for an account that has since been deleted is not stored. Its reference is queued
     for deletion instead.
4. **Asking the vendor to forget.**
   - Every reference a person has with a vendor goes on `app.vendor_deletion_requests` when they
     withdraw the consent (`DELETE /v1/me/verification/consent`) or their account is deleted.
     That covers each check started and each verdict received.
   - The queue holds no user id, so a request outlives the account.
   - `drainVendorDeletions` asks each vendor in turn. It closes a request only once the vendor
     accepts it, and counts the failed attempts. A reference for a vendor that is not
     configured stays queued.
   - Withdrawing the consent keeps the verdict, which is still needed for eligibility. Account
     deletion removes the verdicts, the checks and the date of birth.
5. **Environments.** Dev and test use the fake vendor. Staging and prod do not serve these
   endpoints until a vendor is chosen, rather than ever running the fake.

## Not yet

- The vendor adapter, its `deleteData` call and the scheduled worker that drains the queue in
  deployed environments.
- Alerting when a deletion request stays open too long.
- The mobile screens: consent, then the vendor's page, then the result.
