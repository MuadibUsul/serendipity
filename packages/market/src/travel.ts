/**
 * Rough public-transport minutes between the pilot's home areas, for the
 * venue planner (ADR-0017, P03-10). Planning figures only: typical
 * weekday-evening BART, Muni, Caltrain or bus door to door, rounded to 5
 * minutes, symmetric. To be replaced by a routing service before launch;
 * until then a venue is placed in one of these areas and journeys are read
 * from here.
 */
import { BAY_AREA } from "./market.js";

const AREAS = [
  "SFB_SF_DOWNTOWN",
  "SFB_SF_MISSION",
  "SFB_SF_MARINA",
  "SFB_SF_SUNSET",
  "SFB_OAKLAND",
  "SFB_BERKELEY",
  "SFB_EASTBAY_OTHER",
  "SFB_PENINSULA_NORTH",
  "SFB_PENINSULA_SOUTH",
  "SFB_SOUTHBAY",
  "SFB_MARIN",
] as const;

/** Upper triangle, row by row in the order of AREAS; the diagonal is 15 (across the area). */
const UPPER: readonly (readonly number[])[] = [
  [20, 25, 35, 25, 35, 50, 35, 55, 80, 50],
  [30, 35, 30, 40, 55, 30, 55, 80, 60],
  [35, 45, 55, 70, 50, 70, 95, 35],
  [50, 60, 75, 35, 60, 90, 60],
  [20, 30, 50, 70, 75, 60],
  [35, 60, 80, 85, 55],
  [70, 75, 60, 75],
  [30, 60, 70],
  [35, 90],
  [115],
];

/** Minutes within one area. */
export const WITHIN_AREA_MINUTES = 15;

const TABLE = new Map<string, number>();
AREAS.forEach((from, i) => {
  TABLE.set(`${from}|${from}`, WITHIN_AREA_MINUTES);
  UPPER[i]?.forEach((minutes, offset) => {
    const to = AREAS[i + 1 + offset];
    if (to === undefined) return;
    TABLE.set(`${from}|${to}`, minutes);
    TABLE.set(`${to}|${from}`, minutes);
  });
});

/** Typical minutes from one home area to another, or `null` for an area outside the market. */
export function travelMinutes(from: string, to: string): number | null {
  return TABLE.get(`${from}|${to}`) ?? null;
}

/** Every area the table covers; the same as the market's home areas (a test pins it). */
export const TRAVEL_AREAS: readonly string[] = AREAS;
export const MARKET_AREAS: readonly string[] = Object.keys(BAY_AREA.homeAreas);
