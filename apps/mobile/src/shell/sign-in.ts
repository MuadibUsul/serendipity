/**
 * Sign-in as a pure reducer: the phone step, then the code step, then signed
 * in. The screen only sends events and draws the state; every rule of the
 * flow lives here, where it can be tested without rendering.
 *
 * Every request carries the number of the attempt that started it. A result
 * for any other attempt (the person changed the number, or a newer request
 * replaced it) changes nothing, so a late answer can never pull the person
 * back to a step they have left.
 */
import type { SignInProblem } from "../api/types";

import type { Session } from "./state";

/** Seconds before another code may be requested. */
export const RESEND_AFTER_S = 60;

/** What is in flight, if anything. */
export type Pending = "sending" | "verifying" | null;

export type SignInState =
  | {
      readonly step: "phone";
      readonly phone: string;
      readonly pending: Pending;
      readonly problem: SignInProblem | null;
      readonly attempt: number;
    }
  | {
      readonly step: "code";
      readonly phone: string;
      readonly code: string;
      /** Seconds until a new code may be requested. */
      readonly wait: number;
      readonly pending: Pending;
      readonly problem: SignInProblem | null;
      /** Bumped on each wrong code, to shake the cells once. */
      readonly shakes: number;
      readonly attempt: number;
    }
  | { readonly step: "signed_in"; readonly session: Session; readonly attempt: number };

export type SignInEvent =
  | { readonly type: "phone_edited"; readonly phone: string }
  /** "获取验证码", or "重新发送" on the code step. */
  | { readonly type: "send_requested" }
  | { readonly type: "code_sent"; readonly attempt: number }
  | { readonly type: "code_edited"; readonly code: string }
  /** The sixth digit: verify. */
  | { readonly type: "verify_requested" }
  | { readonly type: "signed_in"; readonly attempt: number; readonly session: Session }
  | { readonly type: "refused"; readonly attempt: number; readonly problem: SignInProblem }
  /** The request threw: no network, no server. */
  | { readonly type: "failed"; readonly attempt: number }
  /** "修改": back to the number, abandoning anything in flight. */
  | { readonly type: "change_phone" }
  /** One second of the resend countdown. */
  | { readonly type: "tick" };

export const INITIAL_SIGN_IN: SignInState = {
  step: "phone",
  phone: "",
  pending: null,
  problem: null,
  attempt: 0,
};

/** Whether a request may start now: nothing in flight and, on the code step, no wait left. */
export function canSend(state: SignInState): boolean {
  if (state.step === "phone") return state.pending === null;
  return state.step === "code" && state.pending === null && state.wait <= 0;
}

/** The next state; an event that does not fit the current state changes nothing. */
export function reduceSignIn(state: SignInState, event: SignInEvent): SignInState {
  if (state.step === "signed_in") return state;
  const current = "attempt" in event && event.attempt === state.attempt;
  switch (event.type) {
    case "phone_edited":
      return state.step === "phone" ? { ...state, phone: event.phone } : state;
    case "send_requested":
      return canSend(state)
        ? { ...state, pending: "sending", problem: null, attempt: state.attempt + 1 }
        : state;
    case "code_sent":
      if (!current || state.pending !== "sending") return state;
      return {
        step: "code",
        phone: state.phone,
        code: "",
        wait: RESEND_AFTER_S,
        pending: null,
        problem: null,
        shakes: state.step === "code" ? state.shakes : 0,
        attempt: state.attempt,
      };
    case "code_edited":
      return state.step === "code" ? { ...state, code: event.code, problem: null } : state;
    case "verify_requested":
      return state.step === "code" && state.pending === null
        ? { ...state, pending: "verifying", problem: null, attempt: state.attempt + 1 }
        : state;
    case "signed_in":
      return current && state.pending === "verifying"
        ? { step: "signed_in", session: event.session, attempt: state.attempt }
        : state;
    case "refused": {
      if (!current || state.pending === null) return state;
      const settled = { ...state, pending: null, problem: event.problem };
      // A wrong code: shake, clear, and start again from the first cell.
      return settled.step === "code" && event.problem === "invalid_code"
        ? { ...settled, code: "", shakes: settled.shakes + 1 }
        : settled;
    }
    case "failed":
      return current && state.pending !== null
        ? { ...state, pending: null, problem: "unavailable" }
        : state;
    case "change_phone":
      return state.step === "code"
        ? {
            step: "phone",
            phone: state.phone,
            pending: null,
            problem: null,
            attempt: state.attempt + 1,
          }
        : state;
    case "tick":
      return state.step === "code" && state.wait > 0 ? { ...state, wait: state.wait - 1 } : state;
    default:
      return assertNever(event);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected sign-in event: ${JSON.stringify(value)}`);
}
