/**
 * a2a-match/0.1: what one person's agent may say to the other's (ARCH-001
 * §7.3, §7.4; PLAN-001 P03-04).
 *
 * Every field is drawn from a fixed menu: there is no free text anywhere, so
 * no message can carry a name, a number, a place, a photo link, a quote from
 * a conversation, or an instruction to the other model. A message is parsed
 * from unknown JSON and refused on the first field that is not on the menu,
 * including any field the menu does not name.
 */

export const PROTOCOL_VERSION = "a2a-match/0.1";

export const SIDES = ["A", "B"] as const;
export type Side = (typeof SIDES)[number];

/** What an agent may ask about. Each answer comes from that topic's own scale. */
export const TOPICS = {
  /** How the person thinks about the relationship they want. */
  goal_pace: ["slow", "steady", "ready"],
  /** What kind of first date suits them. */
  date_style: ["quiet", "lively", "either"],
  /** How they like to talk. */
  conversation: ["listener", "talker", "balanced"],
  /** Whether a soft preference of the asker is a deal-breaker for them after all. */
  flexibility: ["firm", "open", "unsure"],
} as const;
export type Topic = keyof typeof TOPICS;
export type AnswerLevel<T extends Topic> = (typeof TOPICS)[T][number];

/** Why an agent proposes what it does; internal, for audit and tuning. */
export const REASONS = [
  "signals_aligned",
  "goal_mismatch",
  "pace_mismatch",
  "style_mismatch",
  "too_little_known",
  "needs_person",
] as const;
export type Reason = (typeof REASONS)[number];

export const PROPOSALS = ["PASS", "REJECT", "NEEDS_USER_CLARIFICATION"] as const;
export type Proposal = (typeof PROPOSALS)[number];

interface Envelope {
  readonly protocol_version: typeof PROTOCOL_VERSION;
  /** Opaque per pair; never a user id. */
  readonly pair_id: string;
  readonly side: Side;
}

export type Message =
  | (Envelope & { readonly kind: "ask"; readonly topic: Topic })
  | (Envelope & {
      readonly kind: "answer";
      readonly topic: Topic;
      readonly level: AnswerLevel<Topic>;
    })
  | (Envelope & {
      readonly kind: "propose";
      readonly proposal: Proposal;
      readonly reasons: readonly Reason[];
      /** What to ask the person, when the proposal is NEEDS_USER_CLARIFICATION. */
      readonly clarify?: Topic;
    });

export type ParseResult =
  | { readonly ok: true; readonly message: Message }
  | { readonly ok: false; readonly problem: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const oneOf = <T extends string>(options: readonly T[], value: unknown): value is T =>
  typeof value === "string" && (options as readonly string[]).includes(value);

const isTopic = (value: unknown): value is Topic =>
  typeof value === "string" && Object.hasOwn(TOPICS, value);

const ALLOWED: Record<Message["kind"], readonly string[]> = {
  ask: ["protocol_version", "pair_id", "side", "kind", "topic"],
  answer: ["protocol_version", "pair_id", "side", "kind", "topic", "level"],
  propose: ["protocol_version", "pair_id", "side", "kind", "proposal", "reasons", "clarify"],
};

/** A message from unknown JSON, or why it is refused. */
export function parseMessage(raw: unknown): ParseResult {
  const refuse = (problem: string): ParseResult => ({ ok: false, problem });
  if (!isRecord(raw)) return refuse("not an object");
  const kind = raw["kind"];
  if (kind !== "ask" && kind !== "answer" && kind !== "propose") return refuse("unknown kind");
  const extra = Object.keys(raw).filter((key) => !ALLOWED[kind].includes(key));
  if (extra.length > 0) return refuse(`fields not in the protocol: ${extra.sort().join(", ")}`);
  if (raw["protocol_version"] !== PROTOCOL_VERSION) return refuse("unknown protocol version");
  const pairId = raw["pair_id"];
  if (typeof pairId !== "string" || !UUID.test(pairId)) return refuse("pair_id is not opaque");
  const side = raw["side"];
  if (!oneOf(SIDES, side)) return refuse("unknown side");
  const envelope = { protocol_version: PROTOCOL_VERSION, pair_id: pairId, side } as const;

  switch (kind) {
    case "ask": {
      const topic = raw["topic"];
      if (!isTopic(topic)) return refuse("unknown topic");
      return { ok: true, message: { ...envelope, kind, topic } };
    }
    case "answer": {
      const topic = raw["topic"];
      if (!isTopic(topic)) return refuse("unknown topic");
      const level = raw["level"];
      if (!oneOf<string>(TOPICS[topic], level)) return refuse("answer not on the topic's scale");
      return {
        ok: true,
        message: { ...envelope, kind, topic, level: level as AnswerLevel<Topic> },
      };
    }
    case "propose": {
      const proposal = raw["proposal"];
      if (!oneOf(PROPOSALS, proposal)) return refuse("unknown proposal");
      const reasons = raw["reasons"];
      if (
        !Array.isArray(reasons) ||
        reasons.length > REASONS.length ||
        !reasons.every((reason) => oneOf(REASONS, reason)) ||
        new Set(reasons).size !== reasons.length
      ) {
        return refuse("reasons must be distinct codes from the protocol");
      }
      const clarify = raw["clarify"];
      if (clarify !== undefined && !isTopic(clarify)) return refuse("unknown clarification topic");
      if ((proposal === "NEEDS_USER_CLARIFICATION") !== (clarify !== undefined)) {
        return refuse("a clarification names its topic, and only a clarification does");
      }
      return {
        ok: true,
        message: {
          ...envelope,
          kind,
          proposal,
          reasons,
          ...(clarify === undefined ? {} : { clarify }),
        },
      };
    }
  }
}
