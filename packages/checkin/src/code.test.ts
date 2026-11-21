import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { CODE_STEP_S, DEVICE_KEY, checkinOpen, codeFor, newDeviceKey, readCode } from "./code.js";

const SECRET = "c".repeat(32);
const DATE = "11111111-2222-4333-8444-555555555555";
const AT = new Date("2026-11-22T03:00:20Z");
const later = (seconds: number) => new Date(AT.getTime() + seconds * 1000);

describe("codeFor and readCode", () => {
  it("names the date and the side, and nothing about the person", () => {
    const { code, refreshInS } = codeFor(SECRET, DATE, "A", AT);
    expect(readCode(SECRET, code, AT)).toEqual({ ok: true, dateId: DATE, party: "A" });
    expect(refreshInS).toBe(40);
    expect(code.split(".")).toHaveLength(5);
  });

  it("works this minute and the next, then stops", () => {
    const { code } = codeFor(SECRET, DATE, "B", AT);
    expect(readCode(SECRET, code, later(39))).toMatchObject({ ok: true });
    expect(readCode(SECRET, code, later(40 + CODE_STEP_S - 1))).toMatchObject({ ok: true });
    expect(readCode(SECRET, code, later(40 + CODE_STEP_S))).toEqual({
      ok: false,
      refusal: "stale",
    });
    // A code from the future (a phone clock set ahead) is not taken either.
    expect(readCode(SECRET, codeFor(SECRET, DATE, "B", later(120)).code, AT)).toEqual({
      ok: false,
      refusal: "stale",
    });
  });

  it("refuses a code for the other side, another date or another key", () => {
    const { code } = codeFor(SECRET, DATE, "A", AT);
    const asB = code.replace(".A.", ".B.");
    expect(readCode(SECRET, asB, AT)).toEqual({ ok: false, refusal: "bad_mac" });
    const otherDate = code.replace(DATE, "11111111-2222-4333-8444-666666666666");
    expect(readCode(SECRET, otherDate, AT)).toEqual({ ok: false, refusal: "bad_mac" });
    expect(readCode("d".repeat(32), code, AT)).toEqual({ ok: false, refusal: "bad_mac" });
  });

  it("refuses anything that is not a code", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 120 }), (raw) => {
        expect(readCode(SECRET, raw, AT).ok).toBe(false);
      }),
    );
  });
});

describe("checkinOpen", () => {
  const start = new Date("2026-11-22T03:00:00Z");
  const end = new Date("2026-11-22T05:00:00Z");
  it("opens 30 minutes before the start and closes at the end", () => {
    expect(checkinOpen(start, end, new Date("2026-11-22T02:29:59Z"))).toBe(false);
    expect(checkinOpen(start, end, new Date("2026-11-22T02:30:00Z"))).toBe(true);
    expect(checkinOpen(start, end, new Date("2026-11-22T04:59:59Z"))).toBe(true);
    expect(checkinOpen(start, end, end)).toBe(false);
  });
});

describe("newDeviceKey", () => {
  it("is unguessable and recognisable", () => {
    const key = newDeviceKey();
    expect(key).toMatch(DEVICE_KEY);
    expect(newDeviceKey()).not.toBe(key);
  });
});
