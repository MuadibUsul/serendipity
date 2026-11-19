# @serendipity/auth

Sign-in by phone and one-time code ([ADR-0013](../../docs/adr/0013-sign-in.md)).

- `normalizePhone`: a mainland mobile number in E.164, or `null`.
- `createHasher(secret)`: keyed hashes, so storage never holds a number, address, code or
  token in the clear.
- `createAuthService({ repository, sms, hasher })`:
  - `requestCode` and `signIn`;
  - `refresh`, which rotates the pair and revokes the family on reuse;
  - `logout` and `callerFor`.
- `AUTH_POLICY`: code lifetime, tries, rate limits and token lifetimes, in one place.
- `CHALLENGE_LIFECYCLE`, `SESSION_LIFECYCLE`: guarded in the database by migration 0010.
- `createFakeSms`: dev and test only. The API never uses it in staging or prod.

`@serendipity/db` `pgAuthRepository` implements `AuthRepository`.
