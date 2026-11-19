import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { PROPOSALS, PROTOCOL_VERSION, REASONS, TOPICS, parseMessage } from "./messages.js";
import type { Topic } from "./messages.js";

const PAIR = "0b8f3c7e-1d2a-4e5f-8a9b-0c1d2e3f4a5b";
const envelope = { protocol_version: PROTOCOL_VERSION, pair_id: PAIR, side: "A" };
const TOPIC_NAMES = Object.keys(TOPICS) as Topic[];

/** Every string anywhere in a value, keys included. */
function stringsIn(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringsIn);
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([key, inner]) => [key, ...stringsIn(inner)]);
  }
  return [];
}

const VOCABULARY = new Set<string>([
  PROTOCOL_VERSION,
  "A",
  "B",
  "ask",
  "answer",
  "propose",
  "protocol_version",
  "pair_id",
  "side",
  "kind",
  "topic",
  "level",
  "proposal",
  "reasons",
  "clarify",
  ...TOPIC_NAMES,
  ...Object.values(TOPICS).flat(),
  ...REASONS,
  ...PROPOSALS,
]);

describe("parseMessage", () => {
  it("accepts each kind of message", () => {
    expect(parseMessage({ ...envelope, kind: "ask", topic: "goal_pace" })).toMatchObject({
      ok: true,
    });
    expect(
      parseMessage({ ...envelope, kind: "answer", topic: "goal_pace", level: "steady" }),
    ).toMatchObject({ ok: true });
    expect(
      parseMessage({
        ...envelope,
        kind: "propose",
        proposal: "PASS",
        reasons: ["signals_aligned"],
      }),
    ).toMatchObject({ ok: true });
    expect(
      parseMessage({
        ...envelope,
        kind: "propose",
        proposal: "NEEDS_USER_CLARIFICATION",
        reasons: ["needs_person"],
        clarify: "date_style",
      }),
    ).toMatchObject({ ok: true, message: { clarify: "date_style" } });
  });

  it.each([
    [
      "a field the protocol does not name",
      { ...envelope, kind: "ask", topic: "goal_pace", note: "hi" },
    ],
    ["free text where a topic goes", { ...envelope, kind: "ask", topic: "what's your number?" }],
    [
      "an answer from another topic's scale",
      { ...envelope, kind: "answer", topic: "goal_pace", level: "quiet" },
    ],
    ["a user id as the pair", { ...envelope, pair_id: "user-42", kind: "ask", topic: "goal_pace" }],
    [
      "another protocol version",
      { ...envelope, protocol_version: "a2a-match/9", kind: "ask", topic: "goal_pace" },
    ],
    ["an unknown side", { ...envelope, side: "C", kind: "ask", topic: "goal_pace" }],
    ["an unknown kind", { ...envelope, kind: "chat", topic: "goal_pace" }],
    ["an inherited topic name", { ...envelope, kind: "ask", topic: "toString" }],
    [
      "an unknown reason",
      { ...envelope, kind: "propose", proposal: "PASS", reasons: ["she seems nice"] },
    ],
    [
      "a repeated reason",
      {
        ...envelope,
        kind: "propose",
        proposal: "PASS",
        reasons: ["signals_aligned", "signals_aligned"],
      },
    ],
    [
      "reasons that are not a list",
      { ...envelope, kind: "propose", proposal: "PASS", reasons: "signals_aligned" },
    ],
    ["an unknown proposal", { ...envelope, kind: "propose", proposal: "MAYBE", reasons: [] }],
    [
      "a clarification without a topic",
      { ...envelope, kind: "propose", proposal: "NEEDS_USER_CLARIFICATION", reasons: [] },
    ],
    [
      "a topic on a non-clarification",
      { ...envelope, kind: "propose", proposal: "PASS", reasons: [], clarify: "goal_pace" },
    ],
    ["an array", [envelope]],
    ["null", null],
  ])("refuses %s", (_name, raw) => {
    expect(parseMessage(raw)).toMatchObject({ ok: false });
  });

  it("never lets a string outside the protocol's vocabulary through", () => {
    fc.assert(
      fc.property(
        fc.record(
          {
            protocol_version: fc.constantFrom(PROTOCOL_VERSION, "x"),
            pair_id: fc.constantFrom(PAIR, "Alice", "13800138000"),
            side: fc.constantFrom("A", "B", "Z"),
            kind: fc.constantFrom("ask", "answer", "propose", "say"),
            topic: fc.oneof(fc.constantFrom(...TOPIC_NAMES), fc.string()),
            level: fc.oneof(fc.constantFrom(...Object.values(TOPICS).flat()), fc.string()),
            proposal: fc.oneof(fc.constantFrom(...PROPOSALS), fc.string()),
            reasons: fc.array(fc.oneof(fc.constantFrom(...REASONS), fc.string()), { maxLength: 4 }),
            clarify: fc.oneof(fc.constantFrom(...TOPIC_NAMES), fc.string()),
            extra: fc.string(),
          },
          { requiredKeys: [] },
        ),
        (raw) => {
          const result = parseMessage(raw);
          if (!result.ok) return;
          for (const text of stringsIn(result.message)) {
            if (text !== PAIR) expect(VOCABULARY).toContain(text);
          }
        },
      ),
    );
  });
});
