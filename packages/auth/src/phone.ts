/**
 * Phone numbers, US only for now (ADR-0023: the US first, Bay Area pilot).
 * Anything else is refused rather than guessed at.
 */

/** A North American number: area code and exchange each start 2–9. */
const US_NUMBER = /^[2-9]\d{2}[2-9]\d{6}$/;

/**
 * The number in E.164 (`+14155550123`), or `null` when it is not a US number.
 * Spaces, dashes, dots, brackets and a leading +1 / 1 are accepted.
 */
export function normalizePhone(raw: string): string | null {
  const digits = raw.trim().replace(/[\s().-]/g, "");
  const national = digits.replace(/^(\+1|1)(?=\d{10}$)/, "");
  return US_NUMBER.test(national) ? `+1${national}` : null;
}
