/**
 * Swapping contact details (PRD-001 §7; PLAN-001 P05-03: "Not forced to
 * stay in the app; phone/WeChat never exposed automatically").
 *
 * - Either person may offer a contact card (WeChat, phone or other) while
 *   their chat is open. Nothing is ever filled in for them: the number they
 *   signed in with is never used.
 * - A card is shown only once both have offered one, so nobody gives theirs
 *   and is left waiting. Until then, an offer can be withdrawn.
 * - Leaving or blocking hides both cards.
 */

export const CONTACT_KINDS = ["wechat", "phone", "other"] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];
export const MAX_CONTACT_LENGTH = 64;

export interface ContactCard {
  readonly kind: ContactKind;
  readonly value: string;
}

export type ParsedContact =
  | { readonly ok: true; readonly card: ContactCard }
  | { readonly ok: false; readonly problem: string };

export function parseContact(kind: unknown, value: unknown): ParsedContact {
  if (typeof kind !== "string" || !(CONTACT_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, problem: "kind must be wechat, phone or other" };
  }
  if (typeof value !== "string") return { ok: false, problem: "value must be text" };
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_CONTACT_LENGTH || /[\r\n]/.test(trimmed)) {
    return {
      ok: false,
      problem: `value must be one line of 1 to ${String(MAX_CONTACT_LENGTH)} characters`,
    };
  }
  return { ok: true, card: { kind: kind as ContactKind, value: trimmed } };
}

export type ContactView =
  | { readonly status: "closed" }
  | { readonly status: "none" }
  /** The viewer offered theirs and waits; nothing of the other's is shown. */
  | { readonly status: "waiting"; readonly mine: ContactCard }
  /** The other offered theirs; the viewer has not. Their card stays hidden. */
  | { readonly status: "invited" }
  | { readonly status: "swapped"; readonly mine: ContactCard; readonly theirs: ContactCard };

export function contactView(
  open: boolean,
  mine: ContactCard | null,
  theirs: ContactCard | null,
): ContactView {
  if (!open) return { status: "closed" };
  if (mine !== null && theirs !== null) return { status: "swapped", mine, theirs };
  if (mine !== null) return { status: "waiting", mine };
  if (theirs !== null) return { status: "invited" };
  return { status: "none" };
}

/** An offer may be withdrawn only before the swap. */
export const mayWithdraw = (mine: ContactCard | null, theirs: ContactCard | null): boolean =>
  mine !== null && theirs === null;
