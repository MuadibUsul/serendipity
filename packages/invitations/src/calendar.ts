/**
 * A confirmed date as a calendar entry (RFC 5545), for "Add to calendar"
 * (ADR-0029). It carries the time, the venue and how to check in. It never
 * names the other person, so a calendar shared with family or a work
 * account shows nothing they should not see.
 */
import { BRAND } from "@serendipity/market";

import type { InvitationView } from "./view.js";

/** Escapes text for an iCalendar property value. */
function text(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

/** 20261122T030000Z */
const stamp = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Octets a code point takes in UTF-8. */
const octets = (char: string) => {
  const code = char.codePointAt(0) ?? 0;
  return code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
};

/** Folds a content line at 75 octets, never inside a character, as RFC 5545 asks. */
function fold(line: string): string {
  const out: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const length = octets(char);
    if (size + length > 75) {
      out.push(current);
      current = " ";
      size = 1;
    }
    current += char;
    size += length;
  }
  out.push(current);
  return out.join("\r\n");
}

/** The calendar file for a confirmed date with a time and a venue, or `null`. */
export function calendarFile(view: InvitationView, now: Date): string | null {
  if (
    view.status !== "confirmed" ||
    view.starts_at === null ||
    view.ends_at === null ||
    view.venue === null
  ) {
    return null;
  }
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//${BRAND}//Date//EN`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${view.date_id}@serendip.date`,
    `DTSTAMP:${stamp(now.toISOString())}`,
    `DTSTART:${stamp(view.starts_at)}`,
    `DTEND:${stamp(view.ends_at)}`,
    `SUMMARY:${text(`${BRAND} date`)}`,
    `LOCATION:${text(`${view.venue.name}, ${view.venue.address}`)}`,
    `DESCRIPTION:${text(`Check in with the code in ${BRAND} when you arrive.`)}`,
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "TRIGGER:-PT2H",
    `DESCRIPTION:${text(`${BRAND} date in 2 hours`)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
}
