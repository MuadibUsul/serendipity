/**
 * Checking in at the venue (PLAN-001 P04-08a, ADR-0028).
 *
 * The person's phone shows a code. It changes every minute, so a screenshot
 * sent ahead to a friend has stopped working by the time anyone scans it.
 * The venue's registered device scans it, and the server, not the device,
 * decides.
 *
 * A code names the date and the side (A or B) and carries a keyed MAC over
 * both and the minute. It says nothing else: no name, no phone number, no
 * account id. A code from this minute or the one before is accepted, to
 * allow for a slow scan.
 *
 * Codes work only around the date: from 30 minutes before the start to the
 * end.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type Party = "A" | "B";

/** Seconds a code is shown for before the next one. */
export const CODE_STEP_S = 60;
/** Check-in opens this long before the date starts. */
export const OPENS_BEFORE_MIN = 30;

const PREFIX = "sc1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const stepOf = (at: Date) => Math.floor(at.getTime() / 1000 / CODE_STEP_S);

function mac(secret: string, dateId: string, party: Party, step: number): string {
  return createHmac("sha256", secret)
    .update(`checkin:${dateId}:${party}:${String(step)}`)
    .digest("base64url")
    .slice(0, 22);
}

/** The code to show now, and how many seconds until it changes. */
export function codeFor(
  secret: string,
  dateId: string,
  party: Party,
  at: Date,
): { readonly code: string; readonly refreshInS: number } {
  const step = stepOf(at);
  const elapsed = Math.floor(at.getTime() / 1000) % CODE_STEP_S;
  return {
    code: `${PREFIX}.${dateId}.${party}.${String(step)}.${mac(secret, dateId, party, step)}`,
    refreshInS: CODE_STEP_S - elapsed,
  };
}

export type CodeRefusal = "malformed" | "bad_mac" | "stale";

export type CodeCheck =
  | { readonly ok: true; readonly dateId: string; readonly party: Party }
  | { readonly ok: false; readonly refusal: CodeRefusal };

/** Reads a scanned code: authentic and from this minute or the one before. */
export function readCode(secret: string, scanned: string, now: Date): CodeCheck {
  const parts = scanned.trim().split(".");
  const [prefix, dateId = "", party, stepText = "", given = ""] = parts;
  if (
    parts.length !== 5 ||
    prefix !== PREFIX ||
    !UUID.test(dateId) ||
    (party !== "A" && party !== "B") ||
    !/^\d{1,12}$/.test(stepText)
  ) {
    return { ok: false, refusal: "malformed" };
  }
  const step = Number(stepText);
  const expected = Buffer.from(mac(secret, dateId, party, step));
  const actual = Buffer.from(given);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { ok: false, refusal: "bad_mac" };
  }
  const current = stepOf(now);
  if (step !== current && step !== current - 1) return { ok: false, refusal: "stale" };
  return { ok: true, dateId, party };
}

/** Whether check-in is open for a date starting and ending at these times. */
export function checkinOpen(startAt: Date, endAt: Date, now: Date): boolean {
  return (
    now.getTime() >= startAt.getTime() - OPENS_BEFORE_MIN * 60_000 &&
    now.getTime() < endAt.getTime()
  );
}

/** A new device key for a venue: shown once to whoever registers the device, stored only as a hash. */
export function newDeviceKey(): string {
  return `vd_${randomBytes(32).toString("base64url")}`;
}

export const DEVICE_KEY = /^vd_[A-Za-z0-9_-]{43}$/;

/** How a device key is stored: a keyed hash, so a copy of the table cannot be used to scan. */
export function deviceKeyHash(secret: string, key: string): string {
  return createHmac("sha256", secret).update(`device:${key}`).digest("base64url");
}
