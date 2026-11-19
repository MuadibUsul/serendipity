import { describe, expect, it } from "vitest";

import {
  HIGH_RISK,
  MAX_DETAILS_LENGTH,
  REPORT_LIFECYCLE,
  STANDARD,
  effectOf,
  parseReport,
  reporterView,
  riskOf,
} from "./reports.js";

describe("reports", () => {
  it("holds at once only for the high-risk categories", () => {
    for (const category of HIGH_RISK) expect(riskOf(category)).toBe("high");
    for (const category of STANDARD) expect(riskOf(category)).toBe("standard");
  });

  it("accepts a known category with optional, trimmed details for staff", () => {
    expect(parseReport("stalking", "  followed me home  ")).toEqual({
      ok: true,
      category: "stalking",
      details: "followed me home",
    });
    expect(parseReport("scam", "   ")).toEqual({ ok: true, category: "scam", details: null });
    expect(parseReport("scam", undefined)).toEqual({ ok: true, category: "scam", details: null });
    expect(parseReport("rude", null)).toMatchObject({ ok: false });
    expect(parseReport("scam", 7)).toMatchObject({ ok: false });
    expect(parseReport("scam", "x".repeat(MAX_DETAILS_LENGTH + 1))).toMatchObject({ ok: false });
  });

  it("decides: suspend keeps the hold, warn and dismiss release it", () => {
    expect(effectOf("suspend")).toEqual({ report: "actioned", suspend: true, releaseHold: false });
    expect(effectOf("warn")).toEqual({ report: "actioned", suspend: false, releaseHold: true });
    expect(effectOf("dismiss")).toEqual({ report: "dismissed", suspend: false, releaseHold: true });
  });

  it("lets a suspension be overturned on appeal, and nothing else move back", () => {
    expect(REPORT_LIFECYCLE.can("actioned", "overturned")).toBe(true);
    expect(REPORT_LIFECYCLE.can("dismissed", "open")).toBe(false);
    expect(REPORT_LIFECYCLE.can("overturned", "actioned")).toBe(false);
  });

  it("tells the reporter only that the report was received, then handled", () => {
    expect(reporterView("open")).toBe("received");
    expect(reporterView("actioned")).toBe("handled");
    expect(reporterView("dismissed")).toBe("handled");
    expect(reporterView("overturned")).toBe("handled");
  });
});
