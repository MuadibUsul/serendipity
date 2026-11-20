import { describe, expect, it } from "vitest";

import { dateParts, daysUntil, formatDateTime, formatDay, formatMoney } from "./format";

const LA = "America/Los_Angeles";

describe("formatMoney", () => {
  it.each([
    [1_500, "USD", "$15.00"],
    [0, "USD", "$0.00"],
    [5, "USD", "$0.05"],
    [12_345, "EUR", "123.45 EUR"],
  ])("%i %s → %s", (minor, currency, expected) => {
    expect(formatMoney(minor, currency)).toBe(expected);
  });
});

describe("formatDateTime", () => {
  it("shows the venue's local time, not UTC", () => {
    // 23:00 UTC is 3:00 PM in San Francisco (PST).
    const text = formatDateTime("2026-11-21T23:00:00Z", LA);
    expect(text).toContain("Nov 21");
    expect(text).toContain("3:00 PM");
  });

  it("crosses midnight correctly", () => {
    expect(formatDateTime("2026-11-22T07:30:00Z", LA)).toContain("Nov 21");
    expect(formatDateTime("2026-11-22T08:30:00Z", LA)).toContain("Nov 22");
  });
});

describe("dateParts", () => {
  it("splits the local day from the time", () => {
    expect(dateParts("2026-11-21T23:00:00Z", LA)).toEqual({ day: "Sat, Nov 21", time: "3:00 PM" });
  });
});

describe("daysUntil", () => {
  const AT = "2026-11-21T23:00:00Z"; // 3:00 PM on 21 November in San Francisco

  it.each([
    ["2026-11-12T20:00:00Z", 9],
    ["2026-11-21T07:59:00Z", 1], // 11:59 PM on the 20th in San Francisco
    ["2026-11-21T08:00:00Z", 0], // midnight on the 21st
    ["2026-11-21T20:00:00Z", 0],
    ["2026-11-22T20:00:00Z", -1],
  ])("from %s is %i", (now, days) => {
    expect(daysUntil(AT, LA, new Date(now))).toBe(days);
  });
});

describe("formatDay", () => {
  it.each([
    ["2026-11-08", "Nov 8"],
    ["2026-01-31", "Jan 31"],
    ["not a date", "not a date"],
  ])("%s → %s", (date, text) => {
    expect(formatDay(date)).toBe(text);
  });
});
