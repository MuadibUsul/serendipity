// Formatting for display. Amounts are integers in minor units (CONTRIBUTING.md).

const SYMBOLS: Readonly<Record<string, string>> = { USD: "$" };

export function formatMoney(amountMinor: number, currency: string): string {
  const major = (amountMinor / 100).toFixed(2);
  const symbol = SYMBOLS[currency];
  return symbol === undefined ? `${major} ${currency}` : `${symbol}${major}`;
}

/** A UTC instant shown as local date and time in `timeZone`, in US English. */
export function formatDateTime(isoUtc: string, timeZone: string): string {
  const { day, time } = dateParts(isoUtc, timeZone);
  return `${day} ${time}`;
}

/** The local day ("Sat, Nov 21") and time ("3:00 PM") of a UTC instant in `timeZone`. */
export function dateParts(isoUtc: string, timeZone: string): { day: string; time: string } {
  const at = new Date(isoUtc);
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(at);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(at);
  return { day, time };
}

/** The local calendar date (YYYY-MM-DD) of an instant in `timeZone`. */
function localDate(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** Whole calendar days from `now` to the instant, both in `timeZone`; negative once past. */
export function daysUntil(isoUtc: string, timeZone: string, now: Date): number {
  const DAY = 24 * 60 * 60 * 1000;
  const from = Date.parse(`${localDate(now, timeZone)}T00:00:00Z`);
  const to = Date.parse(`${localDate(new Date(isoUtc), timeZone)}T00:00:00Z`);
  return Math.round((to - from) / DAY);
}

/** A calendar date ("2026-11-08") in US English, without the year: "Nov 8". */
export function formatDay(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (match === null) return isoDate;
  const at = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(at);
}
