import { readFileSync } from "node:fs";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { PROTOCOL_VERSION, TOPICS } from "./messages.js";
import type { Message, Proposal, Side, Topic } from "./messages.js";
import { DEFAULT_LIMITS, NEGOTIATION_LIFECYCLE, startNegotiation, step } from "./negotiation.js";
import type { Negotiation, NegotiationEvent } from "./negotiation.js";

const PAIR = "0b8f3c7e-1d2a-4e5f-8a9b-0c1d2e3f4a5b";
const T0 = 1_000_000;
const TOPIC_NAMES = Object.keys(TOPICS) as Topic[];

const ask = (side: Side, topic: Topic = "goal_pace"): Message => ({
  protocol_version: PROTOCOL_VERSION,
  pair_id: PAIR,
  side,
  kind: "ask",
  topic,
});
const answer = (side: Side, topic: Topic = "goal_pace"): Message => ({
  protocol_version: PROTOCOL_VERSION,
  pair_id: PAIR,
  side,
  kind: "answer",
  topic,
  level: TOPICS[topic][0],
});
const propose = (side: Side, proposal: Proposal, clarify?: Topic): Message => ({
  protocol_version: PROTOCOL_VERSION,
  pair_id: PAIR,
  side,
  kind: "propose",
  proposal,
  reasons: [],
  ...(clarify === undefined ? {} : { clarify }),
});
const say = (message: Message, at = T0 + 1): NegotiationEvent => ({ type: "message", message, at });

/** Applies the events in order, requiring each to be accepted. */
function run(...events: NegotiationEvent[]): Negotiation {
  let negotiation = startNegotiation(PAIR, T0);
  for (const event of events) {
    const next = step(negotiation, event);
    if (!next.ok) throw new Error(`refused: ${next.refusal}`);
    negotiation = next.negotiation;
  }
  return negotiation;
}

describe("negotiation verdicts", () => {
  it.each([
    ["PASS", "PASS", "PASS"],
    ["PASS", "REJECT", "REJECT"],
    ["NEEDS_USER_CLARIFICATION", "REJECT", "REJECT"],
    ["PASS", "NEEDS_USER_CLARIFICATION", "NEEDS_USER_CLARIFICATION"],
    ["NEEDS_USER_CLARIFICATION", "PASS", "NEEDS_USER_CLARIFICATION"],
  ] as const)("%s + %s is %s", (a, b, verdict) => {
    const clarifyA = a === "NEEDS_USER_CLARIFICATION" ? "date_style" : undefined;
    const clarifyB = b === "NEEDS_USER_CLARIFICATION" ? "date_style" : undefined;
    const done = run(say(propose("A", a, clarifyA)), say(propose("B", b, clarifyB)));
    expect(done.status).toBe(verdict);
    expect(done.endedBy).toBe("proposals");
  });

  it("names the topic to ask the person about", () => {
    const done = run(
      say(propose("A", "NEEDS_USER_CLARIFICATION", "conversation")),
      say(propose("B", "PASS")),
    );
    expect(done.clarify).toBe("conversation");
  });

  it("keeps running while only one side has proposed", () => {
    expect(run(say(propose("A", "PASS"))).status).toBe("RUNNING");
  });
});

describe("negotiation turns", () => {
  it("allows a full exchange of three questions each", () => {
    const events: NegotiationEvent[] = [];
    for (const topic of ["goal_pace", "date_style", "conversation"] as const) {
      events.push(
        say(ask("A", topic)),
        say(answer("B", topic)),
        say(ask("B", topic)),
        say(answer("A", topic)),
      );
    }
    events.push(say(propose("A", "PASS")), say(propose("B", "PASS")));
    expect(run(...events).status).toBe("PASS");
  });

  it.each([
    [
      "a fourth question",
      [ask("A"), answer("B"), ask("A"), answer("B"), ask("A"), answer("B")],
      ask("A"),
      "too_many_asks",
    ],
    ["a question before the last is answered", [ask("A")], ask("A", "date_style"), "still_waiting"],
    ["an answer nobody asked for", [], answer("B"), "nothing_to_answer"],
    ["answering one's own question", [ask("A")], answer("A"), "nothing_to_answer"],
    ["an answer to another topic", [ask("A")], answer("B", "date_style"), "wrong_answer_topic"],
    ["a second proposal", [propose("A", "PASS")], propose("A", "REJECT"), "already_proposed"],
    ["a question after proposing", [propose("A", "PASS")], ask("A"), "already_proposed"],
    [
      "a message for another pair",
      [],
      { ...ask("A"), pair_id: "1b8f3c7e-1d2a-4e5f-8a9b-0c1d2e3f4a5b" },
      "wrong_pair",
    ],
  ] as const)("refuses %s", (_name, before, message, refusal) => {
    const negotiation = run(...before.map((m) => say(m)));
    const next = step(negotiation, say(message));
    expect(next).toMatchObject({ ok: false, refusal });
    expect(next.negotiation).toBe(negotiation);
  });

  it("still lets a side answer after it proposed", () => {
    const done = run(say(ask("B")), say(propose("A", "PASS")), say(answer("A")));
    expect(done.sides.B.waitingOn).toBeNull();
  });
});

describe("negotiation budgets", () => {
  it("ends without a decision when time runs out", () => {
    const late = step(run(), { type: "tick", at: T0 + DEFAULT_LIMITS.timeBudgetMs });
    expect(late.negotiation).toMatchObject({ status: "NO_DECISION", endedBy: "time" });
  });

  it("refuses a proposal that arrives after the deadline", () => {
    const next = step(run(), say(propose("A", "PASS"), T0 + DEFAULT_LIMITS.timeBudgetMs));
    expect(next).toMatchObject({
      ok: false,
      refusal: "finished",
      negotiation: { status: "NO_DECISION" },
    });
  });

  it("ends without a decision past the model-call budget", () => {
    const calls = Array.from({ length: DEFAULT_LIMITS.maxModelCalls }, () => ({
      type: "model_call" as const,
      at: T0 + 1,
    }));
    expect(run(...calls).status).toBe("RUNNING");
    const over = step(run(...calls), { type: "model_call", at: T0 + 1 });
    expect(over.negotiation).toMatchObject({ status: "NO_DECISION", endedBy: "model_calls" });
  });

  it("refuses everything once finished", () => {
    const done = run(say(propose("A", "REJECT")), say(propose("B", "PASS")));
    expect(step(done, say(ask("A")))).toMatchObject({ ok: false, refusal: "finished" });
    expect(step(done, { type: "tick", at: T0 + 10 ** 9 }).negotiation.status).toBe("REJECT");
  });
});

describe("negotiation properties", () => {
  const side = fc.constantFrom<Side>("A", "B");
  const topic = fc.constantFrom(...TOPIC_NAMES);
  const message = fc.oneof(
    fc.tuple(side, topic).map(([s, t]) => ask(s, t)),
    fc.tuple(side, topic).map(([s, t]) => answer(s, t)),
    fc.tuple(side, fc.constantFrom<Proposal>("PASS", "REJECT")).map(([s, p]) => propose(s, p)),
    fc.tuple(side, topic).map(([s, t]) => propose(s, "NEEDS_USER_CLARIFICATION", t)),
  );
  const event: fc.Arbitrary<{ kind: "m"; message: Message } | { kind: "call" } | { kind: "tick" }> =
    fc.oneof(
      { weight: 6, arbitrary: message.map((m) => ({ kind: "m" as const, message: m })) },
      { weight: 2, arbitrary: fc.constant({ kind: "call" as const }) },
      { weight: 1, arbitrary: fc.constant({ kind: "tick" as const }) },
    );

  it("always ends in at most one verdict, along the lifecycle, within its bounds", () => {
    fc.assert(
      fc.property(fc.array(fc.tuple(event, fc.nat(5_000)), { maxLength: 60 }), (script) => {
        let negotiation = startNegotiation(PAIR, T0);
        let at = T0;
        for (const [e, gap] of script) {
          at += gap;
          const ev: NegotiationEvent =
            e.kind === "m"
              ? { type: "message", message: e.message, at }
              : { type: e.kind === "call" ? "model_call" : "tick", at };
          const before = negotiation;
          const next = step(before, ev);
          negotiation = next.negotiation;
          if (before.status !== negotiation.status) {
            expect(NEGOTIATION_LIFECYCLE.can(before.status, negotiation.status)).toBe(true);
          }
          if (before.status !== "RUNNING") expect(negotiation).toBe(before);
          for (const s of ["A", "B"] as const) {
            expect(negotiation.sides[s].asks).toBeLessThanOrEqual(DEFAULT_LIMITS.maxAsks);
          }
          if (negotiation.status === "NEEDS_USER_CLARIFICATION")
            expect(negotiation.clarify).not.toBeNull();
          if (negotiation.status === "PASS") {
            expect([negotiation.sides.A.proposal, negotiation.sides.B.proposal]).toEqual([
              "PASS",
              "PASS",
            ]);
          }
        }
        // A tick past the deadline always ends a run that is still going.
        const final = step(negotiation, {
          type: "tick",
          at: T0 + DEFAULT_LIMITS.timeBudgetMs + at,
        });
        expect(final.negotiation.status).not.toBe("RUNNING");
      }),
    );
  });
});

describe("NEGOTIATION_LIFECYCLE", () => {
  it("names exactly the states the schema allows", () => {
    const sql = readFileSync(
      new URL("../../../infra/migrations/0003_matching.sql", import.meta.url),
      "utf8",
    );
    const check =
      /negotiations_status_check\s+CHECK \(status IN \(([^)]*)\)\)/.exec(sql)?.[1] ?? "";
    const allowed = [...check.matchAll(/'([A-Z_]+)'/g)].map((match) => match[1]);
    expect([...NEGOTIATION_LIFECYCLE.states].sort()).toEqual(allowed.sort());
  });
});
