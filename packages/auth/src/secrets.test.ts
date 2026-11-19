import { describe, expect, it } from "vitest";

import { MIN_SECRET_BYTES, createHasher, randomCode, randomToken, sameHash } from "./secrets.js";

const SECRET = "x".repeat(MIN_SECRET_BYTES);

describe("secrets", () => {
  it("refuses a short secret", () => {
    expect(() => createHasher("short")).toThrow(/at least 32 bytes/);
  });

  it("hashes per purpose and per secret, never echoing the value", () => {
    const hasher = createHasher(SECRET);
    const phone = hasher.hash("phone", "+8613800000000");
    expect(phone).not.toContain("13800000000");
    expect(hasher.hash("phone", "+8613800000000")).toBe(phone);
    expect(hasher.hash("ip", "+8613800000000")).not.toBe(phone);
    expect(createHasher("y".repeat(MIN_SECRET_BYTES)).hash("phone", "+8613800000000")).not.toBe(
      phone,
    );
  });

  it("compares hashes in constant time and by value", () => {
    expect(sameHash("abc", "abc")).toBe(true);
    expect(sameHash("abc", "abd")).toBe(false);
    expect(sameHash("abc", "abcd")).toBe(false);
  });

  it("draws six-digit codes and unguessable tokens", () => {
    for (let i = 0; i < 200; i += 1) expect(randomCode(6)).toMatch(/^\d{6}$/);
    expect(randomToken("access")).toMatch(/^sa_[A-Za-z0-9_-]{43}$/);
    expect(randomToken("refresh")).toMatch(/^sr_[A-Za-z0-9_-]{43}$/);
    expect(new Set(Array.from({ length: 100 }, () => randomToken("access"))).size).toBe(100);
  });
});
