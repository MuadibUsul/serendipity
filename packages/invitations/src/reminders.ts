/**
 * Reminders before a confirmed date (PLAN-001 P04-09, ADR-0029).
 *
 * Three moments, each sent at most once to each person:
 * - `day_before`, 24 hours ahead: the date is tomorrow;
 * - `leave_soon`, 2 hours ahead: time to plan the journey;
 * - `checkin_open`, 30 minutes ahead: check-in has opened.
 *
 * When a reminder is late (the worker was down, or the date was confirmed
 * at short notice), only the latest moment that has come is sent. Nobody
 * gets "tomorrow" two hours before. Nothing is sent once the date has
 * started.
 *
 * The text names the time and the venue, never the other person.
 */
export const REMINDERS = [
  { kind: "day_before", beforeMin: 24 * 60 },
  { kind: "leave_soon", beforeMin: 2 * 60 },
  { kind: "checkin_open", beforeMin: 30 },
] as const;
export type ReminderKind = (typeof REMINDERS)[number]["kind"];

export const REMINDER_KINDS: readonly ReminderKind[] = REMINDERS.map((reminder) => reminder.kind);

/**
 * The reminder to send now, or `null`: the latest moment that has come,
 * if it has not been sent and no later one has.
 */
export function dueReminder(
  startAt: Date,
  now: Date,
  sent: readonly ReminderKind[],
): ReminderKind | null {
  if (now.getTime() >= startAt.getTime()) return null;
  const index = REMINDERS.findLastIndex(
    (reminder) => now.getTime() >= startAt.getTime() - reminder.beforeMin * 60_000,
  );
  if (index === -1) return null;
  // A later moment already sent covers the earlier ones.
  if (REMINDERS.slice(index).some((reminder) => sent.includes(reminder.kind))) return null;
  return REMINDERS[index]?.kind ?? null;
}

export interface ReminderText {
  readonly title: string;
  readonly body: string;
}

/** The words of a reminder, in the market's language and time zone. */
export function reminderText(
  kind: ReminderKind,
  startAt: Date,
  venueName: string,
  timeZone: string,
  locale = "en-US",
): ReminderText {
  const time = new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(startAt);
  switch (kind) {
    case "day_before":
      return { title: "Your date is tomorrow", body: `${time} at ${venueName}. See you there.` };
    case "leave_soon":
      return {
        title: "Your date is in 2 hours",
        body: `${time} at ${venueName}. Give yourself time to get there.`,
      };
    case "checkin_open":
      return {
        title: "Check-in is open",
        body: `Show your code at ${venueName} when you arrive.`,
      };
  }
}
