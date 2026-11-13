import { describe, expect, it } from "vitest";

import { dateParts, daysUntil, formatDateTime, formatDay, formatMoney } from "./format";

describe("formatMoney", () => {
  it.each([
    [8_800, "CNY", "¥88.00"],
    [0, "CNY", "¥0.00"],
    [5, "CNY", "¥0.05"],
    [12_345, "USD", "123.45 USD"],
  ])("%i %s → %s", (minor, currency, expected) => {
    expect(formatMoney(minor, currency)).toBe(expected);
  });
});

describe("formatDateTime", () => {
  it("shows the venue's local time, not UTC", () => {
    // 07:00 UTC is 15:00 in Shanghai.
    const text = formatDateTime("2026-11-21T07:00:00Z", "Asia/Shanghai");
    expect(text).toContain("11月21日");
    expect(text).toContain("15:00");
  });

  it("crosses midnight correctly", () => {
    expect(formatDateTime("2026-11-21T17:30:00Z", "Asia/Shanghai")).toContain("11月22日");
  });
});

describe("dateParts", () => {
  it("splits the local day from the time", () => {
    expect(dateParts("2026-11-21T07:00:00Z", "Asia/Shanghai")).toEqual({
      day: "11月21日 周六",
      time: "15:00",
    });
  });
});

describe("daysUntil", () => {
  const AT = "2026-11-21T07:00:00Z"; // 15:00 on 21 November in Shanghai

  it.each([
    ["2026-11-12T04:00:00Z", 9],
    ["2026-11-20T15:59:00Z", 1], // 23:59 on the 20th in Shanghai
    ["2026-11-20T16:00:00Z", 0], // 00:00 on the 21st in Shanghai
    ["2026-11-21T10:00:00Z", 0],
    ["2026-11-22T10:00:00Z", -1],
  ])("from %s is %i", (now, days) => {
    expect(daysUntil(AT, "Asia/Shanghai", new Date(now))).toBe(days);
  });
});

describe("formatDay", () => {
  it.each([
    ["2026-11-08", "11月8日"],
    ["2026-01-31", "1月31日"],
    ["not a date", "not a date"],
  ])("%s → %s", (date, text) => {
    expect(formatDay(date)).toBe(text);
  });
});
