/**
 * Where the person is in the app shell, as a pure reducer: signed out, the
 * notification explainer once after signing in, then the four pages
 * (PRD-001 §3.1). Screens only send events; they never decide the flow.
 */
import type { NotificationStatus } from "../platform/notifications";

export const TABS = ["ai", "dates", "relationships", "me"] as const;
export type Tab = (typeof TABS)[number];

export interface Session {
  /** Opaque user id from the backend. */
  readonly userId: string;
}

export type ShellState =
  | { readonly phase: "signed_out" }
  | { readonly phase: "notification_primer"; readonly session: Session }
  | { readonly phase: "main"; readonly session: Session; readonly tab: Tab };

export type ShellEvent =
  | {
      readonly type: "signed_in";
      readonly session: Session;
      /** The permission as it stands when the person signs in. */
      readonly notifications: NotificationStatus;
    }
  /** The person answered the explainer: allowed, refused or "later". */
  | { readonly type: "notifications_decided" }
  | { readonly type: "tab_selected"; readonly tab: Tab }
  | { readonly type: "signed_out" };

export const INITIAL: ShellState = { phase: "signed_out" };

/** The next state; an event that does not fit the current state changes nothing. */
export function reduce(state: ShellState, event: ShellEvent): ShellState {
  switch (event.type) {
    case "signed_in":
      if (state.phase !== "signed_out") return state;
      // Ask only while the system would still show its prompt.
      return event.notifications === "undetermined"
        ? { phase: "notification_primer", session: event.session }
        : { phase: "main", session: event.session, tab: "ai" };
    case "notifications_decided":
      return state.phase === "notification_primer"
        ? { phase: "main", session: state.session, tab: "ai" }
        : state;
    case "tab_selected":
      return state.phase === "main" && state.tab !== event.tab
        ? { ...state, tab: event.tab }
        : state;
    case "signed_out":
      return state.phase === "signed_out" ? state : INITIAL;
    default:
      return assertNever(event);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected shell event: ${JSON.stringify(value)}`);
}
