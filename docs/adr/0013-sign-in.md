# ADR-0013: Sign-in by phone and one-time code

- Status: accepted
- Date: 2026-11-19
- Task: `ser-p01-10` (CHG-001 D9)
- Inputs: ARCH-001 §3, §10.2, §11.1; PRD-001 §8.1;
  [ADR-0006](0006-audit-tracing-redaction-and-alerts.md); docs/state-machines.md

## Context

Until now nobody could sign in. The API trusted an `x-dev-user-id` header in dev and test and
refused every caller in staging and prod; the app signed in against a mock. CHG-001 D9 chose a
mainland mobile number and an SMS code, with a fake SMS provider until a vendor is picked.

## Decision

1. **Phone and code.** `POST /v1/auth/code` sends a six-digit code; `POST /v1/auth/session` signs
   in with it. The first sign-in creates the account (`users.status` `pending`; identity and
   profile come later). Only mainland mobile numbers for now (`normalizePhone`).
2. **Nothing in the clear.** Phone numbers, network addresses, codes and tokens are stored only as
   HMAC-SHA256 under `AUTH_SECRET` (at least 32 bytes; staging and prod must set their own). A
   copy of the tables can be neither read back nor replayed. There is no phone column at all; an
   account is found by the hash of its number.
3. **Limits.**
   - A code works for 5 minutes and 5 tries, after which it is locked.
   - A new code for a number replaces the old one, at most once a minute and 5 times an hour.
   - One network address may request 20 codes an hour.
   - Limits are counted in PostgreSQL under advisory locks, so simultaneous requests cannot
     slip past them.
4. **No hints.** Every wrong, expired, spent or locked code, and a suspended account, answer the
   same `400 invalid_code`; nothing says whether a number has an account.
5. **Sessions.**
   - An opaque access token lasts an hour; an opaque refresh token lasts thirty days, once.
   - A refresh rotates both tokens into a new session of the same family.
   - A refresh token used twice means someone kept a copy, so the whole family is revoked.
   - Logout revokes the session.
   - Codes and sessions are lifecycles guarded in the database (migration 0010).
6. **Callers.** `sessionCallers` names the caller from `Authorization: Bearer`. A request with a
   token is decided by the token alone. Without one, dev and test may still use the dev header;
   staging and prod never do.
7. **SMS.** `SmsProvider` is the seam for a vendor. Dev and test use the fake, whose code is
   always `000000` so a person can sign in by hand. Staging and prod have no provider yet, so
   sign-in answers `503` there rather than ever using the fake.
8. **The app** signs in against the API when `EXPO_PUBLIC_API_URL` is set; everything after
   sign-in is still the mock until those endpoints exist. Tokens are kept in memory only.

## Not decided here

- **The SMS vendor:** with real-name verification (`ser-p00-04`).
- **Keeping the session across launches:** this needs secure storage (Keychain / Keystore) and
  refreshing in the app.
- **Retention:** how long spent codes and ended sessions are kept before a clean-up job
  removes them.
- **Account deletion** (`ser-p05-06`) must also remove the phone mapping and revoke sessions.
