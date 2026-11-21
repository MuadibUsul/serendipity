# ADR-0030: Push notifications

- Status: accepted; the provider is switched on per environment
- Date: 2026-11-21
- Inputs: ADR-0029 (reminders in the outbox), ADR-0010 (the Expo app), ADR-006 (nothing about the
  other person)

## Decision

1. **Devices.**
   - After the person allows notifications, the app sends its Expo push token
     (`PUT /v1/me/push-device`), and removes it when they sign out on that phone
     (`DELETE /v1/me/push-device`). Only Expo tokens on iOS or Android are taken.
   - A token belongs to one person at a time: signing in on a phone someone else used moves it.
   - The token is never written to the audit, because it is enough to message the person.
   - Tokens are deleted with the account.
2. **Delivery.** `npm run notifications:send` runs every minute.
   - It sends each pending notification in `app.notification_outbox` to every device of its
     recipient, in one call to the sender.
   - A notification counts as sent once any device got it, or when there is no device to reach,
     so it is not retried until it is stale.
   - A device the push service no longer knows (`DeviceNotRegistered`) is forgotten.
   - A failure is retried on the next run, up to 5 tries, and then given up on rather than sent
     late.
3. **Provider.** `PUSH_PROVIDER` picks the sender:
   - `expo` uses the Expo push service, with `EXPO_ACCESS_TOKEN` if enhanced push security is on.
     Expo delivers through APNs and FCM, so the server holds no Apple or Google push keys.
   - `fake`, the default in dev and test, sends nothing off the machine.
   - When nothing is set in a deployed environment, nothing is sent and the outbox waits.
4. **Content.** A message carries a title, a body and the date id to open, never anything about
   the other person.

## Not yet

- The app side: asking for the token after permission, sending it here, removing it on sign-out,
  and opening the date when a notification is tapped.
- Expo's receipts (a second check minutes later), and alerts on repeated failures.
- Quiet hours: reminders follow the date's own times, so none are sent at night unless the date
  is then.
