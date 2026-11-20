import { describe, expect, it } from "vitest";

import { BAY_AREA, BRAND, startOfLocalDay } from "./market.js";

describe("the Bay Area market", () => {
  it("is Serendip, in the US, in dollars and Pacific time", () => {
    expect(BRAND).toBe("Serendip");
    expect(BAY_AREA).toMatchObject({
      country: "US",
      currency: "USD",
      timeZone: "America/Los_Angeles",
    });
  });

  it("names areas with codes the profile catalog accepts", () => {
    for (const code of [BAY_AREA.region, ...Object.keys(BAY_AREA.homeAreas)]) {
      expect(code).toMatch(/^[A-Z]{2,4}_[A-Z0-9_]{2,24}$/);
    }
  });
});

describe("startOfLocalDay", () => {
  it("is local midnight in Pacific time, standard and daylight", () => {
    // 2026-11-20 10:00 PST (UTC-8) → midnight PST is 08:00Z.
    expect(startOfLocalDay(new Date("2026-11-20T18:00:00Z")).toISOString()).toBe(
      "2026-11-20T08:00:00.000Z",
    );
    // 2026-07-01 at 06:00Z is still 2026-06-30 23:00 PDT (UTC-7).
    expect(startOfLocalDay(new Date("2026-07-01T06:00:00Z")).toISOString()).toBe(
      "2026-06-30T07:00:00.000Z",
    );
  });

  it("handles the days the clocks change", () => {
    // 2026-03-08: clocks go forward at 02:00 PST; the day began at 08:00Z.
    expect(startOfLocalDay(new Date("2026-03-08T20:00:00Z")).toISOString()).toBe(
      "2026-03-08T08:00:00.000Z",
    );
    // 2026-11-01: clocks go back at 02:00 PDT; the day began at 07:00Z.
    expect(startOfLocalDay(new Date("2026-11-01T20:00:00Z")).toISOString()).toBe(
      "2026-11-01T07:00:00.000Z",
    );
  });

  it("settles on the right offset when a far-east clock change falls between the guesses", () => {
    // Auckland leaves daylight time on 2026-04-05 at 03:00 NZDT (14:00Z the day before);
    // that day began at 00:00 NZDT, 11:00Z on the 4th.
    expect(
      startOfLocalDay(new Date("2026-04-05T06:00:00Z"), "Pacific/Auckland").toISOString(),
    ).toBe("2026-04-04T11:00:00.000Z");
  });

  it("works for any zone", () => {
    expect(startOfLocalDay(new Date("2026-11-19T15:59:00Z"), "Asia/Shanghai").toISOString()).toBe(
      "2026-11-18T16:00:00.000Z",
    );
  });
});
