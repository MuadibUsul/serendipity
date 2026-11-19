import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { normalizePhone } from "./phone.js";

describe("normalizePhone", () => {
  it("accepts mainland mobile numbers in the usual spellings", () => {
    for (const raw of [
      "13800000000",
      "+8613800000000",
      "8613800000000",
      "008613800000000",
      " 138 0000 0000 ",
      "138-0000-0000",
    ]) {
      expect(normalizePhone(raw)).toBe("+8613800000000");
    }
  });

  it("refuses anything else", () => {
    for (const raw of [
      "",
      "1380000000",
      "138000000000",
      "12800000000",
      "+1 312 555 0100",
      "abc",
      "+86 23800000000",
      "0013800000000",
    ]) {
      expect(normalizePhone(raw)).toBeNull();
    }
  });

  it("is idempotent", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^1[3-9]\d{9}$/), (national) => {
        const once = normalizePhone(national);
        expect(once).not.toBeNull();
        expect(normalizePhone(once ?? "")).toBe(once);
      }),
    );
  });
});
