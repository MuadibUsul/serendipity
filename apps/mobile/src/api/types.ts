/**
 * What the app reads from the backend. Shapes only; `createMockApi` answers
 * them on the device until `services/api` serves them (ARCH-001 §11.1).
 *
 * Before two people meet, nothing about the other person reaches the app
 * (PRD-001 §5.3, ADR-006): `UpcomingDate` has no field that could hold a
 * name, photo, job or profile, so no screen can show one by mistake.
 */
import type { Session } from "../shell/state";

/** The four starting points of the AI page (PRD-001 §3.1). */
export const HOME_STATES = ["new", "matching", "booked", "in_relationship"] as const;
export type HomeState = (typeof HOME_STATES)[number];

export interface UpcomingDate {
  readonly id: string;
  /** UTC; shown in the venue's time zone. */
  readonly startsAt: string;
  readonly timeZone: string;
  readonly venueName: string;
  readonly venueAddress: string;
  readonly packageName: string;
  /** What this person pays, in minor units. Never the other person's share. */
  readonly amountMinor: number;
  readonly currency: string;
  readonly cancelRule: string;
}

export interface Relationship {
  readonly id: string;
  /** The name the other person chose to share after both opted in. */
  readonly sharedName: string;
  /** UTC date of the first meeting. */
  readonly metOn: string;
  readonly chatOpen: boolean;
}

export type VerificationStatus = "not_started" | "pending" | "verified";

export interface Me {
  readonly verification: VerificationStatus;
  readonly matchingPaused: boolean;
}

export interface Home {
  readonly state: HomeState;
  readonly upcoming: UpcomingDate | null;
  readonly relationships: readonly Relationship[];
  readonly me: Me;
}

export type SignInProblem = "invalid_phone" | "invalid_code" | "unavailable";

export type CodeResult =
  { readonly ok: true } | { readonly ok: false; readonly problem: SignInProblem };

export type SignInResult =
  | { readonly ok: true; readonly session: Session }
  | { readonly ok: false; readonly problem: SignInProblem };

export interface Api {
  requestCode(phone: string): Promise<CodeResult>;
  signIn(phone: string, code: string): Promise<SignInResult>;
  home(session: Session): Promise<Home>;
  setMatchingPaused(session: Session, paused: boolean): Promise<Me>;
}
