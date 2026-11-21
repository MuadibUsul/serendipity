/** How sign-in behaves. One place, so the API, the app and the tests agree. */
export const AUTH_POLICY = {
  /** A code works for five minutes. */
  codeTtlS: 5 * 60,
  /** A new code for the same number no sooner than this (the app's countdown). */
  resendAfterS: 60,
  /** Wrong tries on one code before it is locked and a new one is needed. */
  maxAttempts: 5,
  /** Codes a number may receive per rolling hour. */
  codesPerPhonePerHour: 5,
  /** Codes one network address may request per rolling hour. */
  codesPerIpPerHour: 20,
  /** An access token works for an hour; the app refreshes it. */
  accessTtlS: 60 * 60,
  /** A refresh token works for thirty days, and only once. */
  refreshTtlS: 30 * 24 * 60 * 60,
  /** Digits in a code. */
  codeLength: 6,
  /** A sign-in nonce (Apple, Google) works for ten minutes, once. */
  nonceTtlS: 10 * 60,
  /** Nonces one network address may request per rolling hour. */
  noncesPerIpPerHour: 30,
} as const;
