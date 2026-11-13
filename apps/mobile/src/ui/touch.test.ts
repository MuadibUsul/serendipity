import { describe, expect, it } from "vitest";

import { touchTarget } from "./touch";

describe("touchTarget", () => {
  it.each([
    ["ios", 44],
    ["android", 48],
    ["web", 44],
    ["windows", 44],
  ])("is at least %s's minimum", (os, size) => {
    expect(touchTarget(os)).toEqual({ minHeight: size, minWidth: size });
  });
});
