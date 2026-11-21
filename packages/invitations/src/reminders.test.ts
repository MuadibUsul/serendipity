import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { REMINDER_KINDS, dueReminder, reminderText } from "./reminders.js";
import type { ReminderKind } from "./reminders.js";

const START = new Date("2026-11-22T03:00:00Z"); // 7:00 PM on the 21st in San Francisco
const before = (minutes: number) => new Date(START.getTime() - minutes * 60_000);

describe("dueReminder", () => {
  it.each([
    [25 * 60, [], null],
    [24 * 60, [], "day_before"],
    [3 * 60, ["day_before"], null],
    [2 * 60, ["day_before"], "leave_soon"],
    [30, ["day_before", "leave_soon"], "checkin_open"],
    [10, ["day_before", "leave_soon", "checkin_open"], null],
    [0, [], null],
  ] as const)("%i minutes before, having sent %j: %s", (minutes, sent, expected) => {
    expect(dueReminder(START, before(minutes), sent)).toBe(expected);
  });

  it("sends only the latest moment when late, never 'tomorrow' on the day", () => {
    expect(dueReminder(START, before(90), [])).toBe("leave_soon");
    expect(dueReminder(START, before(20), [])).toBe("checkin_open");
  });

  it("never sends one twice, nor an earlier one after a later one", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -60, max: 30 * 60 }),
        fc.subarray([...REMINDER_KINDS]),
        (minutes, sent) => {
          const due = dueReminder(START, before(minutes), sent);
          if (due === null) return;
          expect(sent).not.toContain(due);
          const order = REMINDER_KINDS.indexOf(due);
          for (const kind of sent) expect(REMINDER_KINDS.indexOf(kind)).toBeLessThan(order);
          expect(minutes).toBeGreaterThan(0);
        },
      ),
    );
  });

  it("sends each moment at most once over the whole run up to the date", () => {
    const sent: ReminderKind[] = [];
    for (let minutes = 26 * 60; minutes >= -30; minutes -= 5) {
      const due = dueReminder(START, before(minutes), sent);
      if (due !== null) sent.push(due);
    }
    expect(sent).toEqual(["day_before", "leave_soon", "checkin_open"]);
  });
});

describe("reminderText", () => {
  it("names the time in San Francisco and the venue, and no one", () => {
    const text = reminderText("day_before", START, "Foreign Cinema", "America/Los_Angeles");
    expect(text).toEqual({
      title: "Your date is tomorrow",
      body: "7:00 PM at Foreign Cinema. See you there.",
    });
    for (const kind of REMINDER_KINDS) {
      const { title, body } = reminderText(kind, START, "Foreign Cinema", "America/Los_Angeles");
      expect(`${title} ${body}`).not.toMatch(/\bthey\b|\bhe\b|\bshe\b|name|match/i);
    }
  });
});
