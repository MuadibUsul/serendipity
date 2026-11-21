# ADR-0029: Date reminders and the calendar file

- Status: accepted
- Date: 2026-11-21
- Inputs: PLAN-001 P04-09, ADR-006 (nothing about the other person), ADR-0028 (check-in)

## Decision

1. **Three reminders** before a confirmed date, each sent at most once to each person:
   - 24 hours before: "Your date is tomorrow";
   - 2 hours before: time to plan the journey;
   - 30 minutes before: check-in has opened.
2. **Late reminders.** When reminders run late (the worker was down, or the date was confirmed at
   short notice), only the latest moment that has come is sent. Nobody gets "tomorrow" two hours
   before, and nothing is sent once the date has started.
3. **Delivery.**
   - `npm run dates:remind` queues the reminders that are due into `app.notification_outbox`. It
     runs every few minutes. A push sender delivers what is queued.
   - A unique index (migration 0025) keeps one notification of each kind per thing per person,
     even if two workers run at once.
   - A person whose account is suspended or deleted gets none.
4. **Content.** The text names the time, in Pacific time, and the venue, never the other person.
   The payload holds only the date id and the words.
5. **The date card.**
   - The date view now says when check-in opens (`checkin_opens_at`), once the date is confirmed.
   - `GET /v1/dates/:id/calendar.ics` gives a confirmed date as a calendar entry: the time, the
     venue, how to check in, and an alarm 2 hours before.
   - The calendar entry never names the other person, so a calendar shared with family or work
     shows nothing it should not.

## Not yet

- The push sender: device tokens from the app, and delivery through Expo, APNs and FCM.
- The date card screen in the app.
