import { describe, expect, it } from "vitest";

import { formatDateTime, formatMoney } from "./format";

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
