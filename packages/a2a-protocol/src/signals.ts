/**
 * Compatibility signals: what one agent may learn about the other person
 * (consent scope `counterpart_disclosure`, resource `compatibility_signals`).
 *
 * A signal is a coarse level of fit between what the viewer hopes for and
 * the other person's facts — never the facts themselves. Only facts the
 * other person marked `signal` count (profile visibility, PRD-001 §8.2);
 * without their consent nothing is disclosed at all. The server computes
 * the signals; no agent ever sees the inputs.
 */

export const LEVELS = ["none", "some", "strong"] as const;
export type Level = (typeof LEVELS)[number];

export const SIGNAL_KINDS = ["interests", "communication", "lifestyle"] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];

/** One of the other person's facts, as the server holds it. */
export interface DisclosableFact {
  readonly kind: SignalKind;
  readonly tags: readonly string[];
  readonly visibility: "private" | "matching" | "signal";
}

export interface Wishes {
  readonly interests: readonly string[];
  readonly communication: readonly string[];
  readonly lifestyle: readonly string[];
}

/** What the viewer's agent receives: one level per kind, and nothing else. */
export type Signals = Readonly<Record<SignalKind, Level>>;

const NOTHING: Signals = { interests: "none", communication: "none", lifestyle: "none" };

/** `none` below one shared tag, `strong` from half of the viewer's wishes. */
function levelOf(wished: readonly string[], tags: readonly string[]): Level {
  if (wished.length === 0) return "none";
  const have = new Set(tags);
  const shared = wished.filter((tag) => have.has(tag)).length;
  if (shared === 0) return "none";
  return shared * 2 >= wished.length ? "strong" : "some";
}

/**
 * The signals the viewer's agent may see about the other person. Facts not
 * marked `signal` are left out, and without the other person's consent the
 * answer is all `none`.
 */
export function signalsFor(
  viewer: Wishes,
  other: { readonly facts: readonly DisclosableFact[]; readonly consented: boolean },
): Signals {
  if (!other.consented) return NOTHING;
  const disclosable = (kind: SignalKind) =>
    other.facts
      .filter((fact) => fact.kind === kind && fact.visibility === "signal")
      .flatMap((fact) => fact.tags);
  return {
    interests: levelOf(viewer.interests, disclosable("interests")),
    communication: levelOf(viewer.communication, disclosable("communication")),
    lifestyle: levelOf(viewer.lifestyle, disclosable("lifestyle")),
  };
}
