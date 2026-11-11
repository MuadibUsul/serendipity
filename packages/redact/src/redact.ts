/**
 * Defence in depth for everything a process writes down: log lines and audit
 * metadata (ARCH-001 §10.2, PLAN-001 P01-07). Code must not log personal data
 * in the first place; this removes what slips through anyway.
 *
 * Two rules, applied to any JSON-like value:
 * - the value under a personal-data key (`email`, `phone`, `token`, …) is
 *   replaced whole, whatever its type;
 * - inside every other string, anything that looks like an e-mail address, a
 *   phone, ID or card number, an IP address, a credential or a secret is
 *   replaced, and the rest of the string is kept.
 */
export const REDACTED = "[redacted]";
export const TRUNCATED = "[truncated]";

export const MAX_DEPTH = 8;
export const MAX_ITEMS = 50;
export const MAX_STRING = 1000;

/** Normalised keys (lower case, letters and digits only) that are personal data whatever they hold. */
const PERSONAL_KEYS = new Set([
  "name",
  "dob",
  "tel",
  "ip",
  "lat",
  "lng",
  "lon",
  "geo",
  "location",
  "body",
  "content",
  "note",
  "notes",
  "photo",
  "photos",
  "image",
  "audio",
  "voice",
  "session",
  "sessionid",
  "cookie",
  "cookies",
]);

/** Endings of normalised keys that are personal data or secrets: `userEmail`, `x-api-key`, `homeAddress`, … */
const PERSONAL_KEY_ENDINGS = [
  "email",
  "phone",
  "mobile",
  "password",
  "passwd",
  "secret",
  "token",
  "apikey",
  "authorization",
  "cookie",
  "passport",
  "idnumber",
  "idcard",
  "nationalid",
  "address",
  "forwardedfor",
  "useragent",
  "transcript",
  "latitude",
  "longitude",
  "birthday",
  "birthdate",
  "dateofbirth",
  "realname",
  "fullname",
  "firstname",
  "lastname",
  "surname",
  "nickname",
  "wechat",
  "wechatid",
];

/**
 * Keys whose values this codebase generates, validates or reads from its own
 * configuration (trace, span and request ids, the address it listens on):
 * exempt from pattern matching, which would otherwise mangle a hex id that
 * happens to hold nine digits in a row, or take a bind address for a
 * client's.
 */
const OWN_KEYS = new Set(["traceid", "spanid", "reqid", "requestid", "host"]);

const normalise = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Whether the value under `key` is personal data or a secret, whatever it holds. */
export function isPersonalKey(key: string): boolean {
  const normalised = normalise(key);
  return (
    PERSONAL_KEYS.has(normalised) ||
    PERSONAL_KEY_ENDINGS.some((ending) => normalised.endsWith(ending))
  );
}

const HEX = /^[0-9a-f]+$/i;

/** Long tokens: secrets if hex of 40+ characters, or 32+ characters mixing upper, lower and digits. */
function looksLikeSecret(token: string): boolean {
  if (HEX.test(token)) return token.length >= 40;
  if (token.length < 32) return false;
  return /[a-z]/.test(token) && /[A-Z]/.test(token) && /\d/.test(token);
}

const PATTERNS: readonly (readonly [RegExp, (match: string) => string])[] = [
  // Credentials in an Authorization-style value.
  [/\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]+/gi, () => REDACTED],
  // JSON Web Tokens.
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, () => REDACTED],
  // Anything shaped like an address with an @ in it: e-mail and IM handles.
  // The local part may hold any RFC 5322 atom character (o'brien@…).
  [/[^\s@()<>[\]",;:]+@[^\s@()<>[\]{},;:"'`]+/g, () => REDACTED],
  // IPv4, and IPv6 written with at least four groups.
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, () => REDACTED],
  [/\b(?:[0-9A-Fa-f]{1,4}:){3,7}[0-9A-Fa-f]{1,4}\b/g, () => REDACTED],
  // Resident ID numbers ending in a check letter.
  [/\d{17}[\dXx]/g, () => REDACTED],
  // Nine or more digits in a row: phone, ID and card numbers.
  [/\d{9,}/g, () => REDACTED],
  // The same written in groups of 2-4 digits (+86 138-0013-8000,
  // 4111 1111 1111 1111) once the groups add up to nine digits or more.
  // Three short numbers in a row are treated the same way: they cannot be told
  // apart from a phone number.
  [
    /(?<![\d+])(?:\+\d{1,3}[\s-]?)?\d{2,4}(?:[\s-]\d{2,4}){2,}(?!\d)/g,
    (match) => (match.replace(/\D/g, "").length >= 9 ? REDACTED : match),
  ],
  // Long secrets: API keys, signing keys, base64 blobs.
  [/[A-Za-z0-9+/_-]{32,}={0,2}/g, (token) => (looksLikeSecret(token) ? REDACTED : token)],
];

/**
 * Set aside before the digit rules run: calendar dates (and the date in a
 * timestamp) and UUIDs, this codebase's own pseudonymous ids. Neither is a
 * phone number, though a UUID can end in twelve digits.
 */
const KEPT =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|\b\d{4}-\d{2}-\d{2}(?![\d-])/gi;

/** A stand-in with no digits in it, so the digit rules cannot touch it. */
const placeholder = (index: number) =>
  `\u0000${String(index).replace(/\d/g, (digit) => String.fromCharCode(97 + Number(digit)))}\u0000`;

/** `text` with every pattern above replaced. */
export function redactText(text: string): string {
  // Set dates and UUIDs aside so the digit rules can neither take one for a
  // number nor run a number into one, then put them back.
  const kept: string[] = [];
  let result = text.replace(KEPT, (match) => placeholder(kept.push(match) - 1));
  for (const [pattern, replace] of PATTERNS) result = result.replace(pattern, replace);
  return kept.reduce(
    (restored, match, index) => restored.replace(placeholder(index), match),
    result,
  );
}

function truncateText(text: string): string {
  return text.length > MAX_STRING ? `${text.slice(0, MAX_STRING)}…${TRUNCATED}` : text;
}

/** Eleven or more digits is a phone or ID number whatever the key; smaller numbers are kept. */
const LONG_NUMBER = 1e10;

function redactValue(value: unknown, depth: number, ancestors: object[], ownId: boolean): unknown {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return truncateText(ownId ? value : redactText(value));
  if (typeof value === "number") {
    return Number.isInteger(value) && Math.abs(value) >= LONG_NUMBER ? REDACTED : value;
  }
  if (typeof value === "bigint") return redactValue(value.toString(), depth, ancestors, ownId);
  if (typeof value !== "object") return undefined; // functions, symbols, undefined
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (value instanceof Error) return { type: /^\w{1,64}$/.test(value.name) ? value.name : "Error" };
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return "[binary]";
  if (value instanceof Map || value instanceof Set) return "[unsupported]";
  if (ancestors.includes(value)) return "[circular]";
  if (depth >= MAX_DEPTH) return TRUNCATED;

  const inner = [...ancestors, value];
  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ITEMS)
      .map((item: unknown) => redactValue(item, depth + 1, inner, false));
    return value.length > MAX_ITEMS ? [...items, TRUNCATED] : items;
  }

  const result: Record<string, unknown> = {};
  let renamed = 0;
  for (const [key, item] of Object.entries(value)) {
    // A key can be personal data itself (a map keyed by e-mail address).
    let safeKey = redactText(key);
    if (safeKey !== key) {
      renamed += 1;
      safeKey = `${REDACTED}${String(renamed)}`;
    }
    if (isPersonalKey(key)) {
      result[safeKey] = REDACTED;
      continue;
    }
    const redacted = redactValue(item, depth + 1, inner, OWN_KEYS.has(normalise(key)));
    if (redacted !== undefined) result[safeKey] = redacted;
  }
  return result;
}

/** A redacted copy of `value`; the input is never changed. */
export function redact(value: unknown): unknown {
  return redactValue(value, 0, [], false);
}

/** `redact` for an object of fields, such as a log line or audit metadata. */
export function redactFields(fields: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return redactValue(fields, 0, [], false) as Record<string, unknown>;
}
