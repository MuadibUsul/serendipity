/**
 * The market Serendip launches in (CHG-002, 2026-11-20): the US, first in
 * the San Francisco Bay Area, on the App Store and Google Play. Everything
 * that differs by market lives here, so a second market is a new value of
 * this shape rather than edits across the code.
 */

export const BRAND = "Serendip";

export interface Market {
  readonly country: "US";
  readonly locale: string;
  /** The IANA zone a "day" is counted in (one card a day, reminders). */
  readonly timeZone: string;
  readonly currency: string;
  /** The country calling code phone numbers are read in. */
  readonly callingCode: "1";
  /** The pilot's matching region (`self.city_region`): one area, so commute decides, not lines on a map. */
  readonly region: string;
  /** Where people can say they usually spend time (`self.home_area`), by display name. */
  readonly homeAreas: Readonly<Record<string, string>>;
  readonly distanceUnit: "mi";
}

export const BAY_AREA: Market = {
  country: "US",
  locale: "en-US",
  timeZone: "America/Los_Angeles",
  currency: "USD",
  callingCode: "1",
  region: "SFB_BAYAREA",
  homeAreas: {
    SFB_SF_DOWNTOWN: "San Francisco · Downtown / SoMa",
    SFB_SF_MISSION: "San Francisco · Mission / Castro",
    SFB_SF_MARINA: "San Francisco · Marina / Pacific Heights",
    SFB_SF_SUNSET: "San Francisco · Sunset / Richmond",
    SFB_OAKLAND: "Oakland",
    SFB_BERKELEY: "Berkeley",
    SFB_EASTBAY_OTHER: "East Bay · other",
    SFB_PENINSULA_NORTH: "Peninsula · Daly City to San Mateo",
    SFB_PENINSULA_SOUTH: "Peninsula · Redwood City to Palo Alto",
    SFB_SOUTHBAY: "South Bay · Mountain View to San Jose",
    SFB_MARIN: "Marin",
  },
  distanceUnit: "mi",
};

/** The market this build serves. */
export const MARKET: Market = BAY_AREA;

/**
 * The instant local midnight began, in `timeZone`, for the day containing
 * `now`. Correct across daylight-saving changes (a day may be 23 or 25 hours).
 */
export function startOfLocalDay(now: Date, timeZone: string = MARKET.timeZone): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const midnightUtc = Date.UTC(get("year"), get("month") - 1, get("day"));
  // The zone's offset can differ between midnight and now; correct twice to settle on it.
  let guess = midnightUtc - offsetMs(new Date(midnightUtc), timeZone);
  guess = midnightUtc - offsetMs(new Date(guess), timeZone);
  return new Date(guess);
}

/** The zone's offset from UTC at `at`, in milliseconds (negative west of Greenwich). */
function offsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}
