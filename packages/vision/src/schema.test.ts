import { describe, expect, it } from "vitest";

import { parseVisionFeatures } from "./schema.js";

export const VALID = {
  hair_length: { value: "short", confidence: 0.8 },
  clothing_style: { value: "casual", confidence: 0.6 },
  photo_style: { value: "outdoor", confidence: 0.7 },
} as const;

describe("allow-listed visual output", () => {
  it("accepts only coarse observable values with uncertainty", () => {
    expect(parseVisionFeatures(VALID)).toEqual(VALID);
  });

  it.each([
    { ...VALID, identity: "someone" },
    { ...VALID, personality: "loyal" },
    { ...VALID, ethnicity: "unknown" },
    { ...VALID, age: 24 },
    { ...VALID, hair_length: { value: "short", confidence: 0.8, attractiveness: 10 } },
    { ...VALID, clothing_style: { value: "wealthy", confidence: 0.7 } },
    { ...VALID, photo_style: { value: "outdoor", confidence: 2 } },
  ])("rejects sensitive, free-text or malformed inference: %#", (raw) => {
    expect(() => parseVisionFeatures(raw)).toThrow("invalid_output");
  });
});
