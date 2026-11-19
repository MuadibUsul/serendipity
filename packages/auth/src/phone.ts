/**
 * Phone numbers, China mainland only for now (CHG-001 D13: the China
 * version first). Anything else is refused rather than guessed at.
 */

/** A mainland mobile number: 11 digits starting 13–19. */
const CN_MOBILE = /^1[3-9]\d{9}$/;

/**
 * The number in E.164 (`+8613800000000`), or `null` when it is not a mainland
 * mobile number. Spaces, dashes and a leading +86 / 86 / 0086 are accepted.
 */
export function normalizePhone(raw: string): string | null {
  const digits = raw.trim().replace(/[\s-]/g, "");
  const national = digits.replace(/^(\+86|0086|86)(?=1\d{10}$)/, "");
  return CN_MOBILE.test(national) ? `+86${national}` : null;
}
