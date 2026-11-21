# ADR-0028: Checking in at the venue

- Status: accepted
- Date: 2026-11-21
- Inputs: PLAN-001 P04-08a, the date machine (`PARTY_CHECKED_IN` and `REVEAL` come only from the
  venue side), ARCH-001 §10.2 (no personal data where it is not needed)

## Decision

1. **The person shows a code** (`GET /v1/dates/:id/checkin-code`).
   - It works only for their own date, only while the date is on, and only from 30 minutes
     before the start to the end.
   - It changes every minute, so a screenshot sent ahead stops working. A code from this minute
     or the one before is accepted.
   - It names the date and the side (A or B), with a keyed MAC over both and the minute. It
     carries no name, number or account id.
   - Once the person is checked in, the endpoint says so instead of giving a code.
2. **The venue scans it** with a registered device (`POST /v1/venue/checkins`). The server, not
   the device, decides.
   - A device sends its key as a bearer token, and acts only on dates at its own venue. It
     stops working when it is revoked or its venue is no longer active.
   - Check-in goes through the date machine as the merchant (`PARTY_CHECKED_IN`). A date that is
     not on (for example, on a safety hold) is refused.
   - Each person is recorded once in `app.checkins`, by `qr`, with `venue_attested` set.
3. **The reveal.** Once both people are checked in, the venue reveals the date
   (`POST /v1/venue/dates/:id/reveal`, `REVEAL`). Revealing twice is not an error.
4. **Devices** (`app.venue_devices`, migration 0024). Ops registers a device with
   `npm run venue:device -- <venue-id> "<label>"`. The key is shown once and stored only as a
   keyed hash.
5. **Audit.** Every scan, refused ones included, is audited as the venue. No person is named in
   the metadata.

## Not yet

- The venue's scanning screen, and the person's code screen in the app.
- Fallbacks when a phone is dead (`staff_manual`, `sms_fallback`) and no-show handling.
- Merchant accounts in place of ops-registered devices (P04-03a).
