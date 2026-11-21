import { describe, expect, it } from "vitest";

import { calendarFile } from "./calendar.js";
import type { InvitationView } from "./view.js";

/** UTF-8 octets, counted independently of the code under test. */
const utf8Length = (line: string) => encodeURIComponent(line).replace(/%[0-9A-F]{2}/g, "x").length;

const NOW = new Date("2026-11-20T18:00:00Z");
const VIEW: InvitationView = {
  date_id: "11111111-1111-4111-8111-111111111111",
  status: "confirmed",
  answer_by: null,
  starts_at: "2026-11-22T03:00:00.000Z",
  ends_at: "2026-11-22T05:00:00.000Z",
  venue: { name: "Foreign Cinema", address: "2534 Mission St, San Francisco, CA" },
  checkin_opens_at: "2026-11-22T02:30:00.000Z",
};

describe("calendarFile", () => {
  it("is a valid event with the time, the venue and how to check in", () => {
    const file = calendarFile(VIEW, NOW) ?? "";
    expect(file.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(file.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(file).toContain("DTSTART:20261122T030000Z");
    expect(file).toContain("DTEND:20261122T050000Z");
    expect(file).toContain("UID:11111111-1111-4111-8111-111111111111@serendip.date");
    expect(file).toContain("LOCATION:Foreign Cinema\\, 2534 Mission St\\, San Francisco\\, CA");
    expect(file).toContain("TRIGGER:-PT2H");
  });

  it("folds long lines at 75 octets", () => {
    const long = calendarFile(
      { ...VIEW, venue: { name: "A".repeat(60), address: "B".repeat(60) } },
      NOW,
    );
    const lines = (long ?? "").split("\r\n");
    for (const line of lines) expect(utf8Length(line)).toBeLessThanOrEqual(75);
    // Unfolded, the long location reads back whole.
    expect((long ?? "").replace(/\r\n /g, "")).toContain(`${"A".repeat(60)}\\, ${"B".repeat(60)}`);
  });

  it("escapes what iCalendar treats as structure", () => {
    const file = calendarFile(
      { ...VIEW, venue: { name: "Bar; Grill", address: "1 A St\\nB" } },
      NOW,
    );
    expect(file).toContain("LOCATION:Bar\\; Grill\\, 1 A St\\\\nB");
  });

  it("never splits a character when folding", () => {
    const file = calendarFile({ ...VIEW, venue: { name: "Café ".repeat(30), address: "x" } }, NOW);
    expect((file ?? "").replace(/\r\n /g, "")).toContain("Café Café");
  });

  it("is only made for a confirmed date with a time and a venue", () => {
    expect(calendarFile({ ...VIEW, status: "awaiting_you" }, NOW)).toBeNull();
    expect(calendarFile({ ...VIEW, venue: null }, NOW)).toBeNull();
    expect(calendarFile({ ...VIEW, starts_at: null }, NOW)).toBeNull();
  });
});
