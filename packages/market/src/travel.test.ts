import { describe, expect, it } from "vitest";

import { MARKET_AREAS, TRAVEL_AREAS, WITHIN_AREA_MINUTES, travelMinutes } from "./travel.js";

describe("travelMinutes", () => {
  it("covers exactly the market's home areas", () => {
    expect([...TRAVEL_AREAS].sort()).toEqual([...MARKET_AREAS].sort());
  });

  it("knows every pair, both ways alike, with a short trip inside an area", () => {
    for (const from of TRAVEL_AREAS) {
      expect(travelMinutes(from, from)).toBe(WITHIN_AREA_MINUTES);
      for (const to of TRAVEL_AREAS) {
        const minutes = travelMinutes(from, to);
        expect(minutes, `${from} → ${to}`).not.toBeNull();
        expect(travelMinutes(to, from)).toBe(minutes);
        if (from !== to) expect(minutes).toBeGreaterThan(WITHIN_AREA_MINUTES);
      }
    }
  });

  it("is plausible where it is easy to check", () => {
    expect(travelMinutes("SFB_SF_DOWNTOWN", "SFB_OAKLAND")).toBeLessThan(
      travelMinutes("SFB_SF_DOWNTOWN", "SFB_SOUTHBAY") ?? 0,
    );
    expect(travelMinutes("SFB_OAKLAND", "SFB_BERKELEY")).toBe(20);
  });

  it("does not know an area outside the market", () => {
    expect(travelMinutes("SFB_SF_DOWNTOWN", "GZ_TIANHE")).toBeNull();
  });
});
