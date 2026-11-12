/**
 * The rules that keep a profile honest (PRD-001 §4.1–4.2, ARCH-001 §6.1).
 *
 * - An extractor only proposes: its facts are `explicit` (the person said it)
 *   or `inferred` (a guess), never `confirmed`.
 * - A proposal never silently replaces something stronger. A confirmed fact
 *   is never replaced, and a guess never replaces what the person said. The
 *   clash is returned so the person can be asked.
 * - Only the person confirms, on the review screen.
 * - Only confirmed facts of hard-capable keys become hard rules.
 * - A version can be approved, and so become matchable, only when every
 *   required fact is confirmed.
 * - Facts not touched for 180 days become `outdated`: no longer hard rules
 *   until the person confirms them again.
 *
 * Every function is pure: it returns a new set of facts and never changes the
 * one it was given.
 */
import { FACT_KEYS, PROFILE_SCHEMA_VERSION, isFactKey, specOf } from "./catalog.js";
import type { Certainty, FactKey, Provenance, Visibility } from "./catalog.js";
import { sameValue, validateValue } from "./values.js";
import type { FactValue } from "./values.js";

export interface Fact {
  readonly key: FactKey;
  readonly value: FactValue;
  readonly provenance: Provenance;
  readonly certainty: Certainty;
  readonly visibility: Visibility;
  readonly updatedAt: Date;
}

export type Facts = ReadonlyMap<FactKey, Fact>;

export const NO_FACTS: Facts = new Map();

/** What an extractor may say about one fact. Untrusted: every field is checked. */
export interface Proposal {
  readonly key: string;
  readonly value: unknown;
  readonly provenance: string;
  readonly certainty: string;
}

export interface Conflict {
  readonly key: FactKey;
  readonly current: Fact;
  readonly proposed: FactValue;
}

export type RefusalReason =
  "unknown_key" | "invalid_value" | "not_a_proposal" | "invalid_certainty" | "duplicate_key";

export interface Refusal {
  readonly key: string;
  readonly reason: RefusalReason;
  readonly detail?: string;
}

export interface ProposalOutcome {
  readonly facts: Facts;
  /** Keys whose fact was added, replaced or strengthened. */
  readonly applied: readonly FactKey[];
  /** Keys whose fact already said the same, as strongly or more. */
  readonly unchanged: readonly FactKey[];
  /** Proposals that disagree with a stronger fact: ask the person. */
  readonly conflicts: readonly Conflict[];
  readonly refused: readonly Refusal[];
}

/** How much a provenance weighs when a proposal meets an existing fact. */
const STRENGTH: Record<Provenance, number> = {
  confirmed: 3,
  explicit: 2,
  inferred: 1,
  outdated: 0,
};

const PROPOSABLE = new Set<string>(["explicit", "inferred"]);
const CERTAINTY_VALUES = new Set<string>(["high", "medium", "low"]);

/** Records an extractor's proposals. Nothing it says can become, or change, a confirmed fact. */
export function applyProposals(
  facts: Facts,
  proposals: readonly Proposal[],
  now: Date,
): ProposalOutcome {
  const next = new Map(facts);
  const applied: FactKey[] = [];
  const unchanged: FactKey[] = [];
  const conflicts: Conflict[] = [];
  const refused: Refusal[] = [];
  const seen = new Set<string>();

  for (const proposal of proposals) {
    const { key } = proposal;
    if (!isFactKey(key)) {
      refused.push({ key, reason: "unknown_key" });
      continue;
    }
    if (seen.has(key)) {
      refused.push({ key, reason: "duplicate_key" });
      continue;
    }
    seen.add(key);
    if (!PROPOSABLE.has(proposal.provenance)) {
      refused.push({
        key,
        reason: "not_a_proposal",
        detail: "only explicit or inferred may be proposed",
      });
      continue;
    }
    if (!CERTAINTY_VALUES.has(proposal.certainty)) {
      refused.push({ key, reason: "invalid_certainty" });
      continue;
    }
    const checked = validateValue(specOf(key), proposal.value);
    if (!checked.ok) {
      refused.push({ key, reason: "invalid_value", detail: checked.problem });
      continue;
    }
    const provenance = proposal.provenance as "explicit" | "inferred";
    const certainty = proposal.certainty as Certainty;
    const current = next.get(key);
    if (current === undefined) {
      next.set(key, {
        key,
        value: checked.value,
        provenance,
        certainty,
        visibility: specOf(key).visibilities[0] ?? "private",
        updatedAt: now,
      });
      applied.push(key);
      continue;
    }
    const stronger = STRENGTH[provenance] > STRENGTH[current.provenance];
    if (sameValue(current.value, checked.value)) {
      // The same thing said again counts only if it is better evidence.
      if (stronger) {
        next.set(key, { ...current, provenance, certainty, updatedAt: now });
        applied.push(key);
      } else {
        unchanged.push(key);
      }
      continue;
    }
    const mayReplace =
      current.provenance !== "confirmed" && STRENGTH[provenance] >= STRENGTH[current.provenance];
    if (mayReplace) {
      // The person's visibility choice survives a new value.
      next.set(key, { ...current, value: checked.value, provenance, certainty, updatedAt: now });
      applied.push(key);
    } else {
      conflicts.push({ key, current, proposed: checked.value });
    }
  }
  return { facts: next, applied, unchanged, conflicts, refused };
}

export type EditResult =
  { readonly ok: true; readonly facts: Facts } | { readonly ok: false; readonly problem: string };

/**
 * The person confirms a fact on the review screen: the value shown, or the
 * value they corrected it to. The only way a fact becomes `confirmed`.
 */
export function confirmFact(
  facts: Facts,
  key: FactKey,
  now: Date,
  corrected?: unknown,
): EditResult {
  const current = facts.get(key);
  let value: FactValue;
  if (corrected === undefined) {
    if (current === undefined) return { ok: false, problem: `${key} has no value to confirm` };
    value = current.value;
  } else {
    const checked = validateValue(specOf(key), corrected);
    if (!checked.ok) return { ok: false, problem: `${key} ${checked.problem}` };
    value = checked.value;
  }
  const next = new Map(facts);
  next.set(key, {
    key,
    value,
    provenance: "confirmed",
    certainty: "high",
    visibility: current?.visibility ?? specOf(key).visibilities[0] ?? "private",
    updatedAt: now,
  });
  return { ok: true, facts: next };
}

/** The person deletes a fact. */
export function removeFact(facts: Facts, key: FactKey): Facts {
  const next = new Map(facts);
  next.delete(key);
  return next;
}

/** The person chooses who may use a fact, within what the catalog allows for it. */
export function setVisibility(facts: Facts, key: FactKey, visibility: Visibility): EditResult {
  const current = facts.get(key);
  if (current === undefined) return { ok: false, problem: `${key} is not in the profile` };
  if (!specOf(key).visibilities.includes(visibility)) {
    return { ok: false, problem: `${key} may not be shared as ${visibility}` };
  }
  const next = new Map(facts);
  next.set(key, { ...current, visibility });
  return { ok: true, facts: next };
}

export const OUTDATED_AFTER_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Facts older than `afterDays` become `outdated`, to be confirmed again (PRD-001 §4.2). */
export function markOutdated(facts: Facts, now: Date, afterDays = OUTDATED_AFTER_DAYS): Facts {
  const cutoff = now.getTime() - afterDays * DAY_MS;
  const next = new Map(facts);
  for (const fact of facts.values()) {
    if (fact.provenance !== "outdated" && fact.updatedAt.getTime() < cutoff) {
      next.set(fact.key, { ...fact, provenance: "outdated" });
    }
  }
  return next;
}

/** Required facts that are missing or not yet confirmed, in catalog order. */
export function missingRequired(facts: Facts): FactKey[] {
  return FACT_KEYS.filter(
    (key) => specOf(key).required && facts.get(key)?.provenance !== "confirmed",
  );
}

export interface HardRule {
  readonly key: FactKey;
  readonly value: FactValue;
}

/** The bilateral filters this profile imposes: confirmed facts of hard-capable keys only. */
export function hardRules(facts: Facts): HardRule[] {
  return FACT_KEYS.flatMap((key) => {
    const fact = facts.get(key);
    return specOf(key).hard && fact?.provenance === "confirmed" ? [{ key, value: fact.value }] : [];
  });
}

/** What an approved version stores for matching (`profile_versions.structured_json`). */
export interface ProfileSnapshot {
  readonly schema_version: number;
  readonly hard_rules: Readonly<Partial<Record<FactKey, FactValue>>>;
}

export function snapshotOf(facts: Facts): ProfileSnapshot {
  return {
    schema_version: PROFILE_SCHEMA_VERSION,
    hard_rules: Object.fromEntries(hardRules(facts).map((rule) => [rule.key, rule.value])),
  };
}
