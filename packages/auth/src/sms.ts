import type { SmsProvider } from "./service.js";

/** The name the fake goes by; the API refuses to start in staging or prod with it. */
export const FAKE_SMS = "fake-sms";

/** The code dev sign-in always sends, so a person can sign in without a phone. */
export const DEV_CODE = "000000";

export interface FakeSms extends SmsProvider {
  /** Every code "sent", newest last: tests read them instead of a phone. */
  readonly sent: readonly { readonly phone: string; readonly code: string }[];
  /** The latest code sent to `phone`. */
  lastCodeFor(phone: string): string | undefined;
}

/** Sends nothing: keeps the codes in memory. Dev and test only. */
export function createFakeSms(): FakeSms {
  const sent: { phone: string; code: string }[] = [];
  return {
    name: FAKE_SMS,
    sent,
    sendCode(phone, code) {
      sent.push({ phone, code });
      return Promise.resolve();
    },
    lastCodeFor: (phone) => sent.filter((message) => message.phone === phone).at(-1)?.code,
  };
}
