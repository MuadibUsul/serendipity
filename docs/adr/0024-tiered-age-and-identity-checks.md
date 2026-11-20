# ADR-0024: Tiered age and real-person checks

- Status: accepted (the rules); the vendor is chosen later
- Date: 2026-11-20
- Decision by: the owner, 2026-11-20
- Inputs: ADR-0008 (identity verification), ADR-0022 (appeals), ADR-0023 (US market)

## Decision

We use a tiered approach, close to what large dating apps do. We do not claim to copy any app's
internal process, and we never build face recognition ourselves.

1. **Date of birth at sign-up** (`POST /v1/me/birth-date`).
   - Only people 18 and over are accepted. Under 18 is refused and nothing is stored.
   - The date can be set once; a correction goes through support.
   - It is never shown to anyone and never audited. It is used only for the 18+ rule and to
     compare with an age estimate.
2. **Selfie liveness check before matching.** A vendor checks that the person is real, that the
   selfie matches their profile photos, and estimates their age.
   - Passing liveness shows a real person. It never proves adulthood by itself: the parser and a
     database constraint both refuse a liveness verdict that claims to verify age.
3. **An ID plus selfie check only when needed** (`requiredLevel`). An ID check is asked for when
   any of these hold:
   - an open or upheld report says the person is impersonating someone, or may be a minor;
   - the region requires it (`documentRegions`, empty for the Bay Area);
   - the liveness check failed;
   - the face does not match;
   - the age is unknown;
   - the estimate is under 25;
   - the estimate is more than 8 years from the declared age.

   Until the ID check passes, the person cannot be matched or message anyone. A passed ID check
   settles the question; a failed one blocks.

4. **The decision.**
   - `eligibility` takes the person's declared age, region and safety flags (`identityFacts`)
     and the vendor's verdicts.
   - Recall and the identity service both use it.
   - Callers that pass no facts keep the old strict reading, in which only an ID check counts.
   - Every refusal carries a reason, for the audit and for an appeal through the safety flow
     (ADR-0022).
5. **Data we keep.**
   - We keep the vendor's verdict, the level, the age estimate, whether the face matched, and
     the vendor's reference.
   - We never keep a selfie, an ID image, a document number or a name: the parser drops anything
     else a vendor sends.
6. **No paid vendor and no real ID** until the owner signs off. The flow runs on the fake vendor.

## Not yet

- **Consent.** A separate biometric-verification consent (purpose, retention, deletion), asked
  before the first selfie. It comes with the endpoints that start a check and receive the
  vendor's result.
- **Deletion.** When an account is deleted, a request to the vendor to delete their copy.
- **Vendor.** The vendor's adapter (Persona or Stripe Identity), the regional rules, and legal
  review (CPRA, state biometric laws such as BIPA, app-store age assurance).
