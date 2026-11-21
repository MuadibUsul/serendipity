/** When check-in works (ADR-0028). Pure, with no Node APIs, so any package may use it. */

/** Check-in opens this long before the date starts. */
export const OPENS_BEFORE_MIN = 30;

/** Whether check-in is open for a date starting and ending at these times. */
export function checkinOpen(startAt: Date, endAt: Date, now: Date): boolean {
  return (
    now.getTime() >= startAt.getTime() - OPENS_BEFORE_MIN * 60_000 &&
    now.getTime() < endAt.getTime()
  );
}
