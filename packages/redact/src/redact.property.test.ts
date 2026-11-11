// Properties over generated data: personal data never survives redaction,
// wherever it sits, and ordinary text passes through unchanged.
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { REDACTED, redact, redactText } from "./redact.js";

const digits = (length: number) =>
  fc
    .array(fc.integer({ min: 0, max: 9 }), { minLength: length, maxLength: length })
    .map((ds) => ds.join(""));

const personal = fc.oneof(
  fc.emailAddress(),
  // Chinese mobile numbers, plain or with separators and country code.
  fc
    .tuple(fc.integer({ min: 3, max: 9 }), digits(9))
    .map(([second, rest]) => `1${String(second)}${rest}`),
  fc
    .tuple(fc.integer({ min: 3, max: 9 }), digits(4), digits(4))
    .map(([second, a, b]) => `+86 13${String(second)}-${a}-${b}`),
  // Resident ID numbers and card numbers.
  fc.tuple(digits(17), fc.constantFrom("0", "5", "X", "x")).map(([body, check]) => body + check),
  fc.tuple(digits(4), digits(4), digits(4), digits(4)).map((groups) => groups.join(" ")),
  fc.ipV4(),
  fc.stringMatching(/^[A-Za-z0-9_-]{8,40}$/).map((token) => `Bearer ${token}`),
);

const word = fc.oneof(
  fc.stringMatching(/^[a-z]{1,12}$/),
  fc.constantFrom("/v1/dates/:id", "GET", "ms", "ok", "2026-11-11T10:00:00Z"),
);

/**
 * What ordinary log text is made of: words, and short numbers each followed
 * by a word. Several numbers in a row are left out on purpose: three short
 * groups of digits read as a phone number and are redacted.
 */
const ordinaryText = fc
  .array(
    fc.oneof(
      word,
      fc
        .tuple(fc.integer({ min: 0, max: 99_999 }), word)
        .map(([number, after]) => `${String(number)} ${after}`),
    ),
    { maxLength: 12 },
  )
  .map((words) => words.join(" "));

/** A safe key that is not personal by itself. */
const safeKey = fc.constantFrom("route", "status", "detail", "context", "items", "meta", "kind");

/** `secret` placed somewhere inside a JSON-like value: alone, inside text, in an array or object. */
const embedded = (secret: string) =>
  fc.letrec<{ value: unknown }>((tie) => ({
    value: fc.oneof(
      { depthSize: "small" },
      fc.constant(secret),
      ordinaryText.map((text) => `${text} ${secret} ${text}`),
      fc
        .tuple(fc.array(ordinaryText, { maxLength: 3 }), tie("value"))
        .map(([rest, inner]) => [...rest, inner]),
      fc
        .tuple(safeKey, tie("value"), fc.dictionary(safeKey, ordinaryText, { maxKeys: 3 }))
        .map(([key, inner, others]) => ({ ...others, [key]: inner })),
    ),
  })).value;

describe("redaction properties", () => {
  it("never lets personal data through, wherever it sits", () => {
    fc.assert(
      fc.property(
        personal.chain((secret) => fc.tuple(fc.constant(secret), embedded(secret))),
        ([secret, value]) => {
          expect(JSON.stringify(redact(value))).not.toContain(secret);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("replaces whatever sits under a personal key", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("email", "phone", "password", "accessToken", "homeAddress", "transcript"),
        fc.jsonValue(),
        (key, value) => {
          expect(redact({ [key]: value })).toEqual({ [key]: REDACTED });
        },
      ),
    );
  });

  it("leaves ordinary text alone", () => {
    fc.assert(
      fc.property(ordinaryText, (text) => {
        expect(redactText(text)).toBe(text);
      }),
    );
  });

  it("keeps UUIDs, this codebase's own ids, intact", () => {
    fc.assert(
      fc.property(fc.uuid(), ordinaryText, (id, text) => {
        expect(redactText(`${text} ${id} ${text}`)).toBe(`${text} ${id} ${text}`);
      }),
      { numRuns: 500 },
    );
  });

  it("is idempotent", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const once = redact(value);
        expect(redact(once)).toEqual(once);
      }),
    );
  });
});
