# ADR-0023: Serendip launches in the US, Bay Area first

- Status: accepted
- Date: 2026-11-20
- Decision by: the owner (CHG-002, which replaces CHG-001 D13 "China version first")
- Inputs: owner answers of 2026-11-20

## Decision

1. **Market.** The US, first in the San Francisco Bay Area, on the App Store and Google Play.
   The China version is dropped. Its paperwork (an onshore operating company, ICP filing, and
   real-name verification) is too heavy for the pilot.
2. **Name.** **Serendip.** It is defined once, as `BRAND` in `@serendipity/market`, so the store
   name and the app read the same.
3. **One place for what differs by market** (`@serendipity/market`):
   - the country, locale and time zone (`America/Los_Angeles`, used for the daily card and
     reminders, with daylight saving handled);
   - the currency (USD) and the phone format (+1);
   - one matching region for the pilot, `SFB_BAYAREA`. The pilot uses a single region so that
     commute decides who meets, not lines on a map (ADR-0017);
   - the list of home areas people pick from, for example `SFB_SF_MISSION` or `SFB_OAKLAND`.

   A later market is a new value of this shape, not edits across the code.

4. **Sign-in.** Sign in with Apple, Google, and phone with an SMS code. Phone numbers are US
   only for now. Apple and Google sign-in come in a later change.
5. **Age and real-person checks.** A tiered approach, decided by the owner:
   - Date of birth at sign-up, 18 and over only.
   - Before matching: a selfie liveness check matched against the profile photos, with an age
     estimate. Passing liveness does not prove someone is an adult.
   - An ID plus selfie check is triggered only when needed: the age is uncertain, details
     don't match, impersonation is suspected, or a local law requires it. Until it passes, the
     person cannot match or message.
   - Appeals and human review use the safety flow (ADR-0022).
   - A third-party vendor does the checks; we never build face recognition. The vendor keeps
     the ID and biometric data, and we keep only the result, the level and the vendor's
     reference. Explicit consent comes before any capture.
   - No paid service is connected and no real ID is collected until the owner signs off. The
     flow is built against a fake vendor first.
6. **Logs.** Redaction now also removes US phone numbers written with brackets or dots, and
   Social Security numbers.

## Consequences

- The mobile app moves to English, US phone input and dollars in a separate change. It stays
  within the "stay small, go deep" layout (ADR-0010).
- Matching, venues and money now speak USD and Bay Area codes. Test data uses fictional US
  numbers (`415-555-01xx`).
- Legal review before launch:
  - California CPRA (biometrics are sensitive information);
  - Illinois BIPA and other state biometric laws, for users outside California;
  - state laws on app-store age assurance;
  - dating-safety disclosure laws;
  - App Store and Google Play dating-app rules;
  - the privacy policy, the terms and the vendor's data processing agreement (DPA).
- Superseded:
  - CHG-001 D9's fake SMS remains, now for +1 numbers.
  - D10 (age from a Chinese real-name vendor) and D13 (China first) are replaced by this ADR.
