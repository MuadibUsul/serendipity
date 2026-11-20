// Product copy (US English, ADR-0023). Kept in one place so wording and
// accessibility labels are reviewed together.
import { BRAND } from "@serendipity/market";

import type { HomeState, SignInProblem, VerificationStatus } from "./api/types";
import type { Tab } from "./shell/state";
import type { NotificationStatus } from "./platform/notifications";

export const APP_NAME = BRAND;

export const TAB_LABELS: Readonly<Record<Tab, string>> = {
  ai: "AI",
  dates: "Dates",
  relationships: "Connections",
  me: "Me",
};

export const SIGN_IN = {
  title: "Leave the first meeting a little unknown.",
  intro: "Your AI finds the person and plans the date. You just show up.",
  /** PRD-001 §1: the three promises, floating on the sign-in page. */
  promises: ["No photos", "No chatting first", "Meet, then see"] as const,
  phoneLabel: "Phone number",
  phoneHint: "Only to sign in. Never shown to anyone.",
  codeLabel: "Code",
  sendCode: "Text me a code",
  codeSent: "Code sent",
  codeTitle: "Enter the code",
  sentTo: (masked: string) => `Sent to ${masked}`,
  resendIn: (seconds: number) => `Resend in ${String(seconds)}s`,
  resend: "Resend",
  changePhone: "Change",
  changePhoneSpoken: "Change phone number",
  autoVerify: "We'll check it as soon as you enter 6 digits",
  verifying: "Checking…",
  phonePrefix: "+1",
  submit: "Sign in",
  mockNote: (code: string) => `Demo: the code is ${code}.`,
  adultsOnly: "For adults 18 and over. We verify everyone before their first date.",
  problems: {
    invalid_phone: "Enter a 10-digit US number.",
    invalid_code: "That code isn't right. Try again.",
    rate_limited: "Too many tries. Please wait a moment.",
    unavailable: "We can't sign you in right now. Please try again soon.",
  } satisfies Record<SignInProblem, string>,
};

export const PRIMER = {
  title: "We'll only nudge you when it matters",
  body: "A date invitation, a reminder the day before and on the day, and anything about your safety. That's it.",
  privacy:
    "Lock-screen notifications never show who it is, your preferences or your relationship status.",
  allow: "Turn on notifications",
  later: "Not now",
  laterNote: "You can turn them on any time in Me.",
};

export const AI_HEADLINES: Readonly<Record<HomeState, string>> = {
  new: "Let's get to know you",
  matching: "Your AI is looking for the right time",
  booked: "Your next date",
  in_relationship: "Matching paused, memories kept",
};

export const AI_PAGE = {
  intro: {
    new: "Interrupt, skip, or type instead, any time.",
    matching:
      "Matching happens quietly in the background. We'll let you know when there's a date. You'll never see anyone's photos or profile.",
    booked: "The time and place are in Dates.",
    in_relationship: "Matching is paused. You can resume in Me whenever you like.",
  } satisfies Record<HomeState, string>,
  duration: "About 10 min",
  startVoice: "Start talking",
  useText: "Type instead",
  voiceSoon: "Voice is coming soon",
  firstLabel: "Your AI will start with",
  firstQuestion: "What does a typical weekend look like for you?",
  searching: "Your AI is keeping an eye out for the right time and person",
  seeDate: "The time and place are in Dates.",
};

export const DATES_PAGE = {
  empty: "Good things are worth a little wait.",
  emptyHint: "When there's a good match, you'll get an invitation first. Say yes, or no thanks.",
  yourDate: "Your next date",
  cardLabel: "INVITATION",
  countdown: (days: number) =>
    days > 1 ? `In ${String(days)} days` : days === 1 ? "Tomorrow" : days === 0 ? "Today" : "Past",
  when: "When",
  where: "Where",
  pkg: "Plan",
  yourShare: "You pay",
  cancelRule: "Cancelling",
  hidden: "Neither of you sees the other's photos or profile before you meet.",
  help: "Get help",
};

export const RELATIONSHIPS_PAGE = {
  empty: "The story starts after you meet.",
  emptyHint: "If you both want to keep going after a date, they'll show up here.",
  metOn: (date: string) => `Met ${date}`,
  chat: "Chat",
  block: "Block or report",
};

export const ME_PAGE = {
  account: "Account",
  matching: "Matching",
  verification: "Age & identity check",
  verificationStatus: {
    not_started: "Not started",
    pending: "In review",
    verified: "Verified",
  } satisfies Record<VerificationStatus, string>,
  notifications: "Notifications",
  notificationStatus: {
    undetermined: "Off",
    granted: "On",
    denied: "Off. Turn on in Settings",
    unavailable: "Not available on this device",
  } satisfies Record<NotificationStatus, string>,
  enableNotifications: "Turn on notifications",
  openSettings: "Open Settings",
  pauseMatching: "Pause matching",
  pauseHint: "You won't get new invitations. Your account and profile stay as they are.",
  privacy: "Privacy & permissions",
  privacySoon: "Coming soon",
  signOut: "Sign out",
};

export const COMMON = {
  loading: "Loading…",
  loadFailed: "Couldn't load.",
  retry: "Try again",
};
