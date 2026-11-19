/**
 * The decision verifier (ARCH-001 §7.3 step 5, PLAN-001 P03-07): an agent's
 * PASS is only a proposal. Before anyone is invited, the PASS is checked
 * again, deterministically, against the world as it is now:
 *
 * - the negotiation really ended in PASS, under a protocol we support;
 * - it is about these two people, and the candidate pair has not expired;
 * - both people still hold matching consent, under the policy version the
 *   pair was recalled with (a withdrawn or re-versioned consent overturns it);
 * - every gate and hard rule still holds both ways (`decidePair`, fresh).
 *
 * Every outcome, confirmed or overturned, comes with the audit event to
 * write. The reasons are internal, like `decidePair`'s: never shown to
 * either person or to an agent.
 */
import { decidePair } from "./pair.js";
import type { Candidate, PairContext, Refusal } from "./pair.js";

/** What was proposed: the stored candidate pair and how its negotiation ended. */
export interface ProposedPass {
  readonly pairId: string;
  readonly userA: string;
  readonly userB: string;
  /** `candidate_pairs.expires_at`. */
  readonly expiresAt: Date;
  /** `candidate_pairs.policy_version_a` / `_b`: the consent policy each was recalled under. */
  readonly policyVersionA: number;
  readonly policyVersionB: number;
  /** `negotiations.status` and `.protocol_version`. */
  readonly verdict: string;
  readonly protocolVersion: string;
}

/** The world now, read fresh by the caller from the owning modules. */
export interface Now {
  readonly at: Date;
  readonly a: Candidate;
  readonly b: Candidate;
  readonly context: PairContext;
  /**
   * The policy version of each person's live matching consent now, or `null`
   * when they hold none (never granted, or withdrawn).
   */
  readonly consentVersionA: number | null;
  readonly consentVersionB: number | null;
  readonly supportedProtocols: readonly string[];
}

export type VerifyCode =
  | "not_a_pass"
  | "unsupported_protocol"
  | "wrong_people"
  | "expired"
  | "consent_missing"
  | "consent_changed"
  | "hard_rule";

export type VerifyReason =
  | { readonly code: Exclude<VerifyCode, "consent_missing" | "consent_changed" | "hard_rule"> }
  | { readonly code: "consent_missing" | "consent_changed"; readonly side: "a" | "b" }
  | { readonly code: "hard_rule"; readonly refusal: Refusal };

/** Shaped for `writeAudit` in `@serendipity/db`; the matching service is the actor. */
export interface VerifyAudit {
  readonly actorType: "system";
  readonly actorId: null;
  readonly action: "match.pass.confirmed" | "match.pass.overturned";
  readonly objectType: "candidate_pair";
  readonly objectId: string;
  readonly metadata: {
    readonly verdict: string;
    readonly protocol_version: string;
    /** Reason codes only; refusal sides and keys, never values. */
    readonly reasons: readonly string[];
  };
}

export type Verification =
  | { readonly confirmed: true; readonly audit: VerifyAudit }
  | {
      readonly confirmed: false;
      readonly reasons: readonly VerifyReason[];
      readonly audit: VerifyAudit;
    };

function consentReasons(
  recalledUnder: number,
  liveVersion: number | null,
  side: "a" | "b",
): VerifyReason[] {
  if (liveVersion === null) return [{ code: "consent_missing", side }];
  if (liveVersion !== recalledUnder) return [{ code: "consent_changed", side }];
  return [];
}

function codeOf(reason: VerifyReason): string {
  if ("side" in reason) return `${reason.code}:${reason.side}`;
  if ("refusal" in reason) return `hard_rule:${reason.refusal.side}:${reason.refusal.code}`;
  return reason.code;
}

/**
 * Confirms or overturns one PASS. Every reason that can be established is
 * returned, not only the first; the hard rules are always re-run, so the
 * audit shows everything that changed.
 */
export function verifyPass(proposed: ProposedPass, now: Now): Verification {
  const reasons: VerifyReason[] = [];
  if (proposed.verdict !== "PASS") reasons.push({ code: "not_a_pass" });
  if (!now.supportedProtocols.includes(proposed.protocolVersion)) {
    reasons.push({ code: "unsupported_protocol" });
  }
  if (now.a.id !== proposed.userA || now.b.id !== proposed.userB) {
    reasons.push({ code: "wrong_people" });
  }
  if (!(now.at.getTime() < proposed.expiresAt.getTime())) reasons.push({ code: "expired" });
  reasons.push(
    ...consentReasons(proposed.policyVersionA, now.consentVersionA, "a"),
    ...consentReasons(proposed.policyVersionB, now.consentVersionB, "b"),
  );
  const decision = decidePair(now.a, now.b, now.context);
  if (!decision.pass) {
    reasons.push(...decision.refusals.map((refusal) => ({ code: "hard_rule" as const, refusal })));
  }

  const confirmed = reasons.length === 0;
  const audit: VerifyAudit = {
    actorType: "system",
    actorId: null,
    action: confirmed ? "match.pass.confirmed" : "match.pass.overturned",
    objectType: "candidate_pair",
    objectId: proposed.pairId,
    metadata: {
      verdict: proposed.verdict,
      protocol_version: proposed.protocolVersion,
      reasons: reasons.map(codeOf),
    },
  };
  return confirmed ? { confirmed, audit } : { confirmed, reasons, audit };
}
