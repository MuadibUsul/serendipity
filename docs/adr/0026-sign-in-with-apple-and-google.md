# ADR-0026: Sign in with Apple and Google

- Status: accepted; the client IDs are still to come from the owner
- Date: 2026-11-21
- Inputs: ADR-0013 (sign-in by phone), ADR-0023 (US market: Apple, Google and phone), App Store
  Review Guideline 4.8 (an app that offers Google sign-in must also offer Sign in with Apple)

## Decision

1. **The flow.**
   1. The app asks for a one-time nonce (`POST /v1/auth/nonce`). The response also lists the
      providers this server offers.
   2. It hands the nonce to the platform's own sign-in sheet. Apple is given the nonce's SHA-256
      hex; Google is given the nonce as it is.
   3. It sends back the ID token with the nonce (`POST /v1/auth/apple` or `/v1/auth/google`) and
      gets the same session as a phone sign-in.
2. **What a token must be.**
   - An RS256 JWT, signed by a key the provider publishes. `none` and HMAC are refused.
   - From the provider's issuer, for one of our client IDs.
   - Current, with 60 seconds of clock skew allowed.
   - Carrying this server's nonce, raw or hashed.

   The nonce works once, for ten minutes. One network address may ask for at most 30 nonces an
   hour. Published keys are cached for an hour; an unknown key ID fetches them again, but at
   most once a minute.

3. **What we keep.**
   - Only a keyed hash of the provider name and its subject id. Apple's and Google's ids never
     meet, even when they are equal.
   - The email, name and anything else in the token are ignored. An email is never used to join
     accounts: that is how accounts get taken over.
4. **Answers.**
   - Every token, nonce or closed account that will not do gets the same 401, so a response
     never says whether an Apple or Google account has an account here.
   - A provider without client IDs answers 503. Any other provider name answers 404.
5. **Bans carry over** as they do for phone numbers (ADR-0022, migration 0014). When a suspended
   person deletes their account, their Apple or Google subject goes on `auth_banned_social`, so
   they cannot start over with it. Anyone else who deletes their account can.
6. **Configuration.**
   - `APPLE_CLIENT_IDS` holds the bundle ID, plus the services ID for the web.
   - `GOOGLE_CLIENT_IDS` holds the iOS, Android and web OAuth clients.
   - Both are comma separated. A provider with no client IDs is not offered.
   - Sign-in as a whole is still served only in dev and test until the SMS vendor is chosen
     (ADR-0013).

## Not yet

- **Revoking Apple tokens on account deletion.** App Store Guideline 5.1.1(v) asks for it. It
  needs Apple's authorization-code exchange and a signing key from the owner's Apple developer
  account.
- **More than one sign-in method on one account.** A person who signed up by phone and later taps
  Apple gets a second account. Linking needs a signed-in "add a sign-in method" flow.
- **The mobile screens:** the Apple button first, then Google, then phone.
