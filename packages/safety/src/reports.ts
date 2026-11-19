/**
 * Reports, holds, decisions and appeals (PRD-001 §8.1; PLAN-001 P05-05:
 * "High-risk events taken over by a person, audited and appealable").
 *
 * - Anyone can report someone they had a date with. A report always blocks
 *   the two from being matched again.
 * - A high-risk report holds the other person at once: no new matches, and
 *   chat between the two closes. Holding is not a verdict; a person decides.
 * - Staff decide: suspend, warn, or dismiss. A suspension can be appealed,
 *   and a person decides the appeal: upheld (stays suspended) or overturned.
 * - The reported person never learns who reported them or what was said.
 *   The reporter learns that the report was received, then that it was
 *   handled, never the outcome for the other person.
 */
import { defineLifecycle } from "@serendipity/domain";

export const HIGH_RISK = [
  "threat_or_violence",
  "sexual_misconduct",
  "stalking",
  "minor_suspected",
] as const;

export const STANDARD = [
  "harassment",
  "fake_identity",
  "scam",
  "no_show",
  "inappropriate_content",
  "felt_unsafe",
  "other",
] as const;

export type Category = (typeof HIGH_RISK)[number] | (typeof STANDARD)[number];
export type Risk = "high" | "standard";

const CATEGORIES: readonly string[] = [...HIGH_RISK, ...STANDARD];
export const isCategory = (value: unknown): value is Category =>
  typeof value === "string" && CATEGORIES.includes(value);

export const riskOf = (category: Category): Risk =>
  (HIGH_RISK as readonly string[]).includes(category) ? "high" : "standard";

/** Free text a reporter may add, for staff only. */
export const MAX_DETAILS_LENGTH = 1000;

export type ParsedReport =
  | { readonly ok: true; readonly category: Category; readonly details: string | null }
  | { readonly ok: false; readonly problem: string };

export function parseReport(category: unknown, details: unknown): ParsedReport {
  if (!isCategory(category)) return { ok: false, problem: "unknown category" };
  if (details === undefined || details === null) return { ok: true, category, details: null };
  if (typeof details !== "string") return { ok: false, problem: "details must be text" };
  const text = details.trim();
  if (text.length > MAX_DETAILS_LENGTH) return { ok: false, problem: "details are too long" };
  return { ok: true, category, details: text.length === 0 ? null : text };
}

export const REPORT_STATES = ["open", "actioned", "dismissed", "overturned"] as const;
export type ReportState = (typeof REPORT_STATES)[number];

/**
 * `app.safety_reports.status`: open until staff decide; a suspension
 * (`actioned`) can be overturned on appeal; a dismissal is final.
 */
export const REPORT_LIFECYCLE = defineLifecycle({
  name: "app.safety_reports.status",
  states: REPORT_STATES,
  initial: "open",
  transitions: {
    open: ["actioned", "dismissed"],
    actioned: ["overturned"],
    dismissed: [],
    overturned: [],
  },
});

export type Decision = "suspend" | "warn" | "dismiss";

/** What a decision does: the report's next state, and whether the account is suspended or released. */
export function effectOf(decision: Decision): {
  readonly report: ReportState;
  readonly suspend: boolean;
  readonly releaseHold: boolean;
} {
  switch (decision) {
    case "suspend":
      return { report: "actioned", suspend: true, releaseHold: false };
    case "warn":
      return { report: "actioned", suspend: false, releaseHold: true };
    case "dismiss":
      return { report: "dismissed", suspend: false, releaseHold: true };
  }
}

/** What the reporter sees of their report. */
export const reporterView = (state: ReportState): "received" | "handled" =>
  state === "open" ? "received" : "handled";
