import { describe, expect, it } from "vitest";

import {
  MAX_DEPTH,
  MAX_ITEMS,
  MAX_STRING,
  REDACTED,
  TRUNCATED,
  isPersonalKey,
  redact,
  redactFields,
  redactText,
} from "./redact.js";

describe("redactText", () => {
  it.each([
    [
      "an e-mail address",
      "Key (email)=(alice@example.com) exists",
      "Key (email)=([redacted]) exists",
    ],
    ["a Chinese mobile number", "call 13800138000 now", "call [redacted] now"],
    ["a phone number with separators", "tel +86 138-0013-8000.", "tel [redacted]."],
    ["a resident ID number", "id 11010519491231002X ok", "id [redacted] ok"],
    ["a card number", "card 4111 1111 1111 1111", "card [redacted]"],
    ["an apostrophe in an e-mail address", "o'brien@example.com wrote", "[redacted] wrote"],
    [
      "a phone number written next to a date",
      "138 0013 8000 2026-11-11 10 2026-11-12T10:00:00Z",
      "[redacted] 2026-11-11 10 2026-11-12T10:00:00Z",
    ],
    ["an IPv4 address", "from 203.0.113.9:443", "from [redacted]:443"],
    ["an IPv6 address", "from 2001:db8:0:0:8a2e:370:7334", "from [redacted]"],
    ["a bearer token", "Authorization: Bearer abc.def-123", "Authorization: [redacted]"],
    ["a JSON web token", "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl", "jwt [redacted]"],
    ["a hex secret", `key ${"a1".repeat(20)}`, "key [redacted]"],
    ["a mixed-case secret", "fixtureKEY_Ab3dEf9hIjKlMn0pQrStUvWx12Yz", "[redacted]"],
  ])("removes %s", (_name, text, expected) => {
    expect(redactText(text)).toBe(expected);
  });

  it.each([
    "2026-11-11T10:00:00.000Z",
    "GET /v1/dates/:id/payments/create",
    "duration 1234 ms, 3 retries",
    "status 200 after 10000 ms",
    "1000 10000",
    "grant 123e4567-e89b-12d3-a456-426614174000 revoked",
    "2026-11-11 is the date",
    "version 22.23.4",
    "4bf92f3577b34da6a3ce929d0e0e4736 is short enough",
    "/v1/relationships/messages/a-route-template-that-is-long",
  ])("keeps %j", (text) => {
    expect(redactText(text)).toBe(text);
  });
});

describe("isPersonalKey", () => {
  it.each([
    "email",
    "userEmail",
    "contact_phone",
    "password",
    "x-api-key",
    "accessToken",
    "Authorization",
    "set-cookie",
    "homeAddress",
    "ip",
    "x-forwarded-for",
    "user-agent",
    "name",
    "latitude",
    "transcript",
  ])("treats %j as personal", (key) => {
    expect(isPersonalKey(key)).toBe(true);
  });

  it.each(["route", "status", "max_tokens", "trace_id", "username_length", "count"])(
    "keeps %j",
    (key) => {
      expect(isPersonalKey(key)).toBe(false);
    },
  );
});

describe("redact", () => {
  it("replaces personal keys whole and redacts text elsewhere, without changing the input", () => {
    const input = {
      route: "/v1/profiles/current",
      user: { email: "alice@example.com", phone: 13800138000, tags: ["calm", "alice@example.com"] },
      note: { anything: "at all" },
      err: { type: "Error", message: "duplicate alice@example.com" },
    };
    const snapshot = structuredClone(input);
    expect(redact(input)).toEqual({
      route: "/v1/profiles/current",
      user: { email: REDACTED, phone: REDACTED, tags: ["calm", REDACTED] },
      note: REDACTED,
      err: { type: "Error", message: `duplicate ${REDACTED}` },
    });
    expect(input).toEqual(snapshot);
  });

  it("keeps the ids this codebase generates and the address it listens on", () => {
    const fields = {
      trace_id: "0af7651916cd43dd8448eb211c80319c",
      span_id: "b7ad6b7169203331",
      req_id: "123456789012-req",
      host: "127.0.0.1",
    };
    expect(redactFields(fields)).toEqual(fields);
  });

  it("renames a key that is personal data itself", () => {
    expect(redact({ "alice@example.com": 1, "bob@example.com": 2, ok: 3 })).toEqual({
      [`${REDACTED}1`]: 1,
      [`${REDACTED}2`]: 2,
      ok: 3,
    });
  });

  it("redacts numbers long enough to be phone or ID numbers, and keeps the rest", () => {
    expect(redact({ a: 13800138000, b: 4000, c: 1.5, d: 999_999_999 })).toEqual({
      a: REDACTED,
      b: 4000,
      c: 1.5,
      d: 999_999_999,
    });
  });

  it("describes errors by type only and turns dates into ISO strings", () => {
    class LeakyError extends Error {
      override readonly name = "LeakyError";
    }
    expect(
      redact({ err: new LeakyError("alice@example.com"), at: new Date("2026-11-11T00:00:00Z") }),
    ).toEqual({ err: { type: "LeakyError" }, at: "2026-11-11T00:00:00.000Z" });
  });

  it("drops functions and undefined, and marks binary, maps and cycles", () => {
    const cycle: Record<string, unknown> = { a: 1 };
    cycle["self"] = cycle;
    expect(
      redact({
        fn: () => 1,
        missing: undefined,
        bytes: new Uint8Array([1, 2]),
        map: new Map([["k", "v"]]),
        cycle,
        big: 13800138000n,
      }),
    ).toEqual({
      bytes: "[binary]",
      map: "[unsupported]",
      cycle: { a: 1, self: "[circular]" },
      big: REDACTED,
    });
  });

  it("bounds depth, array length and string length", () => {
    let deep: unknown = "leaf";
    for (let i = 0; i < MAX_DEPTH + 2; i += 1) deep = { next: deep };
    expect(JSON.stringify(redact(deep))).toContain(TRUNCATED);

    const long = redact(Array.from({ length: MAX_ITEMS + 5 }, (_, i) => i)) as unknown[];
    expect(long).toHaveLength(MAX_ITEMS + 1);
    expect(long.at(-1)).toBe(TRUNCATED);

    const text = redact("x".repeat(MAX_STRING + 10)) as string;
    expect(text.endsWith(TRUNCATED)).toBe(true);
    expect(text.length).toBeLessThan(MAX_STRING + 20);
  });

  it("redacts before truncating, so a cut never leaves part of an address behind", () => {
    // The cut at MAX_STRING falls inside the local part, before the @.
    const text = `${"x ".repeat((MAX_STRING - 4) / 2)}alice@example.com`;
    expect(text.slice(0, MAX_STRING).endsWith("alic")).toBe(true);
    expect(redact(text)).not.toContain("alic");
  });
});
