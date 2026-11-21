import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { WeeklyWindow } from "@serendipity/matching";

import { planDate } from "./plan.js";
import type { PlanInput, PlanPerson, SlotOffer, VenueListing } from "./plan.js";

// Friday 20 November 2026, 10:00 in San Francisco (PST, UTC-8).
const NOW = new Date("2026-11-20T18:00:00Z");
/** A UTC instant for a San Francisco wall time in late November (UTC-8). */
const sf = (date: string, time: string) => new Date(`${date}T${time}:00-08:00`);

const EVENINGS: WeeklyWindow[] = (["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const).map(
  (day) => ({ day, from: 18 * 60, to: 23 * 60 }),
);

const person = (extra: Partial<PlanPerson> = {}): PlanPerson => ({
  traveller: { area: "SFB_SF_MISSION", maxCommuteMinutes: 40 },
  windows: EVENINGS,
  budgetMinor: 6_000,
  dietary: [],
  ...extra,
});

const venue = (id: string, extra: Partial<VenueListing> = {}): VenueListing => ({
  id,
  pricePerPersonMinor: 4_000,
  accommodates: [],
  ...extra,
});

let slotCount = 0;
const slot = (venueId: string, date: string, time: string, extra: Partial<SlotOffer> = {}) => {
  slotCount += 1;
  const startsAt = sf(date, time);
  return {
    id: `slot-${String(slotCount).padStart(3, "0")}`,
    venueId,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 2 * 60 * 60 * 1000),
    free: true,
    ...extra,
  };
};

/** Minutes from either area: v-near is close, v-far is further, v-out unreachable. */
const MINUTES: Record<string, number | null> = {
  "v-near": 15,
  "v-mid": 25,
  "v-far": 35,
  "v-out": null,
};
const estimate = (_area: string, venueId: string) => MINUTES[venueId] ?? null;

const input = (extra: Partial<PlanInput>): PlanInput => ({
  a: person(),
  b: person({ traveller: { area: "SFB_OAKLAND", maxCommuteMinutes: 40 } }),
  fit: 0.5,
  venues: [venue("v-near"), venue("v-mid"), venue("v-far")],
  slots: [],
  estimate,
  now: NOW,
  ...extra,
});

describe("planDate", () => {
  it("picks the soonest day, then the fairest venue on it, then the earliest start", () => {
    const slots = [
      slot("v-far", "2026-11-22", "19:00"),
      slot("v-near", "2026-11-23", "18:30"),
      slot("v-mid", "2026-11-22", "20:00"),
      slot("v-mid", "2026-11-22", "19:30"),
    ];
    expect(planDate(input({ slots }))).toEqual({
      ok: true,
      venueId: "v-mid",
      slotId: slots[3]?.id,
    });
  });

  it("never plans within a day, nor beyond two weeks", () => {
    const tomorrowMorning = slot("v-near", "2026-11-21", "09:00");
    const tooSoon = slot("v-near", "2026-11-20", "19:00");
    const tooLate = slot("v-near", "2026-12-07", "19:00");
    expect(planDate(input({ slots: [tooSoon, tooLate, tomorrowMorning] }))).toEqual({
      ok: false,
      reason: "no_common_time",
    });
  });

  it("only uses a slot inside both people's windows, in San Francisco time", () => {
    const lunch = slot("v-near", "2026-11-22", "12:00");
    const lateNight = slot("v-near", "2026-11-22", "22:00"); // ends at midnight
    const evening = slot("v-near", "2026-11-22", "19:00");
    const onlyLunch = person({ windows: [{ day: "sun", from: 11 * 60, to: 15 * 60 }] });
    expect(planDate(input({ slots: [lunch, lateNight, evening] }))).toMatchObject({
      slotId: evening.id,
    });
    expect(planDate(input({ a: onlyLunch, slots: [lateNight, evening] }))).toEqual({
      ok: false,
      reason: "no_common_time",
    });
    // Lunch suits one of them only: refused until it suits both.
    expect(planDate(input({ a: onlyLunch, slots: [lunch] }))).toEqual({
      ok: false,
      reason: "no_common_time",
    });
    expect(planDate(input({ a: onlyLunch, b: onlyLunch, slots: [lunch] }))).toMatchObject({
      slotId: lunch.id,
    });
  });

  it("skips a full or closed slot", () => {
    const full = slot("v-near", "2026-11-22", "19:00", { free: false });
    expect(planDate(input({ slots: [full] }))).toEqual({ ok: false, reason: "no_common_time" });
  });

  it("keeps to both budgets, as a hard rule", () => {
    const slots = [slot("v-near", "2026-11-22", "19:00"), slot("v-far", "2026-11-22", "19:00")];
    const venues = [venue("v-near", { pricePerPersonMinor: 9_000 }), venue("v-far")];
    expect(planDate(input({ slots, venues }))).toMatchObject({ venueId: "v-far" });
    expect(planDate(input({ slots, venues, b: person({ budgetMinor: 3_000 }) }))).toEqual({
      ok: false,
      reason: "no_venue",
    });
  });

  it("serves both people's dietary needs, and does not say whose ruled a venue out", () => {
    const slots = [slot("v-near", "2026-11-22", "19:00"), slot("v-mid", "2026-11-22", "19:00")];
    const venues = [venue("v-near"), venue("v-mid", { accommodates: ["vegan"] })];
    const result = planDate(input({ slots, venues, b: person({ dietary: ["vegetarian"] }) }));
    expect(result).toMatchObject({ venueId: "v-mid" });
    expect(JSON.stringify(result)).not.toMatch(/veg|budget|area|SFB/);
  });

  it("leaves out a venue either person cannot reach", () => {
    const slots = [slot("v-out", "2026-11-22", "19:00")];
    expect(planDate(input({ slots, venues: [venue("v-out")] }))).toEqual({
      ok: false,
      reason: "no_venue",
    });
  });

  it("only ever returns a slot that meets every hard condition", () => {
    const venues = [
      venue("v-near", { pricePerPersonMinor: 3_000 }),
      venue("v-mid", { pricePerPersonMinor: 5_000, accommodates: ["halal"] }),
      venue("v-far", { pricePerPersonMinor: 7_000 }),
    ];
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            venue: fc.constantFrom("v-near", "v-mid", "v-far"),
            dayOffset: fc.integer({ min: -1, max: 16 }),
            hour: fc.integer({ min: 8, max: 22 }),
            free: fc.boolean(),
          }),
          { maxLength: 12 },
        ),
        fc.integer({ min: 2_000, max: 8_000 }),
        fc.boolean(),
        (raw, budget, halal) => {
          const slots = raw.map((item, index) => {
            const startsAt = new Date(NOW.getTime() + item.dayOffset * 86_400_000);
            startsAt.setUTCHours(item.hour + 8, 0, 0, 0);
            return {
              id: `s${String(index)}`,
              venueId: item.venue,
              startsAt,
              endsAt: new Date(startsAt.getTime() + 7_200_000),
              free: item.free,
            };
          });
          const b = person({ budgetMinor: budget, dietary: halal ? ["halal"] : [] });
          const plan = planDate(input({ slots, venues, b }));
          if (!plan.ok) return;
          const chosen = slots.find((candidate) => candidate.id === plan.slotId);
          const listing = venues.find((candidate) => candidate.id === plan.venueId);
          expect(chosen?.venueId).toBe(plan.venueId);
          expect(chosen?.free).toBe(true);
          expect(chosen && chosen.startsAt.getTime() - NOW.getTime()).toBeGreaterThanOrEqual(
            86_400_000,
          );
          expect(listing?.pricePerPersonMinor).toBeLessThanOrEqual(budget);
          if (halal) expect(listing?.accommodates).toContain("halal");
        },
      ),
    );
  });
});
