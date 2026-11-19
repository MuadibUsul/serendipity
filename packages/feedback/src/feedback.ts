/**
 * Private feedback after a date (PRD-001 §7; PLAN-001 P05-01).
 *
 * - Each person answers alone, once: did they feel safe, how comfortable
 *   was it (1–5), and would they like to get to know the other better.
 * - The choices are independent. Nobody sees the other's answer, and an
 *   answer cannot be changed once given, so nobody can wait to see and then
 *   decide.
 * - Only a mutual yes is ever revealed (and it is revealed at once). A "no"
 *   looks exactly like no answer: until the window closes, someone who said
 *   yes sees "thanks"; afterwards they see "closed". Nobody learns which.
 * - Nothing about the answers reaches the other person: no reason, no
 *   rating, no safety flag. A safety concern goes to the safety team.
 */

/** How long after the date's end each person may answer. */
export const FEEDBACK_WINDOW_HOURS = 72;

export interface FeedbackAnswer {
  readonly feltSafe: boolean;
  /** 1 (not at all) to 5 (very). */
  readonly comfort: 1 | 2 | 3 | 4 | 5;
  readonly wantsToContinue: boolean;
}

export type ParsedFeedback =
  | { readonly ok: true; readonly answer: FeedbackAnswer }
  | { readonly ok: false; readonly problem: string };

const KEYS = ["felt_safe", "comfort", "wants_to_continue"];

/** An answer from unknown JSON; no free text is accepted. */
export function parseFeedback(raw: unknown): ParsedFeedback {
  const refuse = (problem: string): ParsedFeedback => ({ ok: false, problem });
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return refuse("not an object");
  const body = raw as Record<string, unknown>;
  const extra = Object.keys(body).filter((key) => !KEYS.includes(key));
  if (extra.length > 0) return refuse(`unknown fields: ${extra.sort().join(", ")}`);
  const { felt_safe: feltSafe, comfort, wants_to_continue: wantsToContinue } = body;
  if (typeof feltSafe !== "boolean") return refuse("felt_safe must be true or false");
  if (comfort !== 1 && comfort !== 2 && comfort !== 3 && comfort !== 4 && comfort !== 5) {
    return refuse("comfort must be 1 to 5");
  }
  if (typeof wantsToContinue !== "boolean")
    return refuse("wants_to_continue must be true or false");
  return { ok: true, answer: { feltSafe, comfort, wantsToContinue } };
}

/** What one person's feedback looks like to them. */
export type FeedbackView =
  | { readonly status: "not_open" }
  | { readonly status: "awaiting_you"; readonly answer_by: string }
  | { readonly status: "thanks" }
  | { readonly status: "mutual" }
  | { readonly status: "closed" };

export interface FeedbackState {
  /** The date machine's state: feedback is open in `POST_DATE_FEEDBACK` only. */
  readonly dateStatus: string;
  readonly dateEndedAt: Date | null;
  readonly mine: FeedbackAnswer | null;
  readonly theirs: FeedbackAnswer | null;
}

export function deadlineOf(dateEndedAt: Date): Date {
  return new Date(dateEndedAt.getTime() + FEEDBACK_WINDOW_HOURS * 60 * 60 * 1000);
}

export const isMutual = (a: FeedbackAnswer | null, b: FeedbackAnswer | null): boolean =>
  a?.wantsToContinue === true && b?.wantsToContinue === true;

const open = (state: FeedbackState, now: Date): state is FeedbackState & { dateEndedAt: Date } =>
  state.dateStatus === "POST_DATE_FEEDBACK" &&
  state.dateEndedAt !== null &&
  now.getTime() < deadlineOf(state.dateEndedAt).getTime();

const started = (status: string) => status === "POST_DATE_FEEDBACK" || status === "CLOSED";

/**
 * The person's view. It depends on the other's answer only through
 * `isMutual`: whether they said no or said nothing reads the same.
 */
export function feedbackView(state: FeedbackState, now: Date): FeedbackView {
  if (!started(state.dateStatus)) return { status: "not_open" };
  if (isMutual(state.mine, state.theirs)) return { status: "mutual" };
  if (!open(state, now)) return { status: "closed" };
  if (state.mine === null) {
    return { status: "awaiting_you", answer_by: deadlineOf(state.dateEndedAt).toISOString() };
  }
  return state.mine.wantsToContinue ? { status: "thanks" } : { status: "closed" };
}

export type SubmitRefusal = "not_open" | "closed" | "already_answered";

/** Whether this person may answer now. */
export function submitRefusal(state: FeedbackState, now: Date): SubmitRefusal | null {
  if (!started(state.dateStatus)) return "not_open";
  if (state.mine !== null) return "already_answered";
  if (!open(state, now)) return "closed";
  return null;
}
