/**
 * One negotiation between two agents (ARCH-001 §7.3), as a pure reducer:
 * bounded in questions, model calls and time, ending in exactly one verdict.
 *
 * - Each side may ask at most `maxAsks` questions, one at a time: a question
 *   must be answered before its asker asks again, and only the side asked may
 *   answer it.
 * - A side may propose once; after that it may still answer, but not ask.
 * - Both proposed: any REJECT is REJECT; otherwise any NEEDS_USER_CLARIFICATION
 *   is that; otherwise PASS. A PASS is only a proposal to the business layer,
 *   which re-checks every hard rule (ser-p03-07) before anyone is invited.
 * - Out of model calls or time: NO_DECISION, never a guess.
 */
import { defineLifecycle } from "@serendipity/domain";

import type { Message, Proposal, Side, Topic } from "./messages.js";

export const NEGOTIATION_STATES = [
  "RUNNING",
  "PASS",
  "REJECT",
  "NEEDS_USER_CLARIFICATION",
  "NO_DECISION",
] as const;
export type NegotiationStatus = (typeof NEGOTIATION_STATES)[number];

/**
 * `app.negotiations.status`: a run ends in exactly one verdict. A retry is a
 * new attempt row, never a move back to RUNNING. The database guard is added
 * with the worker that first writes this column (ser-p03-05).
 */
export const NEGOTIATION_LIFECYCLE = defineLifecycle({
  name: "app.negotiations.status",
  states: NEGOTIATION_STATES,
  initial: "RUNNING",
  transitions: {
    RUNNING: ["PASS", "REJECT", "NEEDS_USER_CLARIFICATION", "NO_DECISION"],
    PASS: [],
    REJECT: [],
    NEEDS_USER_CLARIFICATION: [],
    NO_DECISION: [],
  },
});

export interface Limits {
  /** Questions per side (ARCH-001 §7.3: at most three rounds). */
  readonly maxAsks: number;
  /** Model calls across both agents. */
  readonly maxModelCalls: number;
  /** Milliseconds from the start (ARCH-001 §1.2: P95 ≤ 45 s). */
  readonly timeBudgetMs: number;
}

export const DEFAULT_LIMITS: Limits = { maxAsks: 3, maxModelCalls: 12, timeBudgetMs: 45_000 };

interface SideState {
  readonly asks: number;
  /** The question this side asked and still waits on. */
  readonly waitingOn: Topic | null;
  readonly proposal: Proposal | null;
}

export interface Negotiation {
  readonly pairId: string;
  readonly status: NegotiationStatus;
  readonly startedAt: number;
  readonly modelCalls: number;
  readonly sides: Readonly<Record<Side, SideState>>;
  /** Why it ended, when it did not end by both proposing. */
  readonly endedBy: "proposals" | "model_calls" | "time" | null;
  /** The topic to ask the person about, for NEEDS_USER_CLARIFICATION. */
  readonly clarify: Topic | null;
}

export type NegotiationEvent =
  | { readonly type: "message"; readonly message: Message; readonly at: number }
  | { readonly type: "model_call"; readonly at: number }
  | { readonly type: "tick"; readonly at: number };

export type Refusal =
  | "finished"
  | "wrong_pair"
  | "already_proposed"
  | "too_many_asks"
  | "still_waiting"
  | "nothing_to_answer"
  | "wrong_answer_topic";

export type Step =
  | { readonly ok: true; readonly negotiation: Negotiation }
  | { readonly ok: false; readonly refusal: Refusal; readonly negotiation: Negotiation };

const FRESH: SideState = { asks: 0, waitingOn: null, proposal: null };

export function startNegotiation(pairId: string, at: number): Negotiation {
  return {
    pairId,
    status: "RUNNING",
    startedAt: at,
    modelCalls: 0,
    sides: { A: FRESH, B: FRESH },
    endedBy: null,
    clarify: null,
  };
}

const other = (side: Side): Side => (side === "A" ? "B" : "A");

function finish(
  negotiation: Negotiation,
  status: NegotiationStatus,
  endedBy: NonNullable<Negotiation["endedBy"]>,
  clarify: Topic | null = null,
): Negotiation {
  NEGOTIATION_LIFECYCLE.assertCan(negotiation.status, status);
  return { ...negotiation, status, endedBy, clarify };
}

/** Ends the run if a budget is spent; otherwise unchanged. */
function enforceBudgets(negotiation: Negotiation, at: number, limits: Limits): Negotiation {
  if (negotiation.status !== "RUNNING") return negotiation;
  if (at - negotiation.startedAt >= limits.timeBudgetMs) {
    return finish(negotiation, "NO_DECISION", "time");
  }
  if (negotiation.modelCalls > limits.maxModelCalls) {
    return finish(negotiation, "NO_DECISION", "model_calls");
  }
  return negotiation;
}

function verdict(negotiation: Negotiation, clarify: Topic | null): Negotiation {
  const proposals = [negotiation.sides.A.proposal, negotiation.sides.B.proposal];
  if (proposals.includes(null)) return negotiation;
  if (proposals.includes("REJECT")) return finish(negotiation, "REJECT", "proposals");
  if (proposals.includes("NEEDS_USER_CLARIFICATION")) {
    return finish(negotiation, "NEEDS_USER_CLARIFICATION", "proposals", clarify);
  }
  return finish(negotiation, "PASS", "proposals");
}

/** The next state, or why the event is refused (the state is then unchanged). */
export function step(
  negotiation: Negotiation,
  event: NegotiationEvent,
  limits: Limits = DEFAULT_LIMITS,
): Step {
  const refuse = (refusal: Refusal): Step => ({ ok: false, refusal, negotiation });
  if (negotiation.status !== "RUNNING") return refuse("finished");
  if (event.type === "tick")
    return { ok: true, negotiation: enforceBudgets(negotiation, event.at, limits) };
  if (event.type === "model_call") {
    const counted = { ...negotiation, modelCalls: negotiation.modelCalls + 1 };
    return { ok: true, negotiation: enforceBudgets(counted, event.at, limits) };
  }

  const timed = enforceBudgets(negotiation, event.at, limits);
  if (timed.status !== "RUNNING") return { ok: false, refusal: "finished", negotiation: timed };
  const { message } = event;
  if (message.pair_id !== negotiation.pairId) return refuse("wrong_pair");
  const me = negotiation.sides[message.side];
  const them = negotiation.sides[other(message.side)];
  const withSides = (mine: SideState, theirs: SideState): Negotiation => ({
    ...negotiation,
    sides: { [message.side]: mine, [other(message.side)]: theirs } as Record<Side, SideState>,
  });

  switch (message.kind) {
    case "ask":
      if (me.proposal !== null) return refuse("already_proposed");
      if (me.waitingOn !== null) return refuse("still_waiting");
      if (me.asks >= limits.maxAsks) return refuse("too_many_asks");
      return {
        ok: true,
        negotiation: withSides({ ...me, asks: me.asks + 1, waitingOn: message.topic }, them),
      };
    case "answer":
      if (them.waitingOn === null) return refuse("nothing_to_answer");
      if (them.waitingOn !== message.topic) return refuse("wrong_answer_topic");
      return { ok: true, negotiation: withSides(me, { ...them, waitingOn: null }) };
    case "propose": {
      if (me.proposal !== null) return refuse("already_proposed");
      const next = withSides({ ...me, proposal: message.proposal }, them);
      const clarify =
        message.proposal === "NEEDS_USER_CLARIFICATION"
          ? (message.clarify ?? null)
          : negotiation.clarify;
      return { ok: true, negotiation: verdict({ ...next, clarify }, clarify) };
    }
  }
}
