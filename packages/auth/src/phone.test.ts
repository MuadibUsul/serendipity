import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { normalizePhone } from "./phone.js";

describe("normalizePhone", () => {
  it("accepts US numbers in the usual spellings", () => {
    for (const raw of [
      "4155550123",
      "+14155550123",
      "14155550123",
      " 415 555 0123 ",
      "415-555-0123",
      "(415) 555-0123",
      "415.555.0123",
      "+1 (415) 555-0123",
    ]) {
      expect(normalizePhone(raw)).toBe("+14155550123");
    }
  });

  it("refuses anything else", () => {
    for (const raw of [
      "",
      "415555012",
      "41555501234",
      "0155550123",
      "1155550123",
      "4151550123",
      "+8613800000000",
      "+44 20 7946 0958",
      "abc",
    ]) {
      expect(normalizePhone(raw)).toBeNull();
    }
  });

  it("is idempotent", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^[2-9]\d{2}[2-9]\d{6}$/), (national) => {
        const once = normalizePhone(national);
        expect(once).not.toBeNull();
        expect(normalizePhone(once ?? "")).toBe(once);
      }),
    );
  });
});
