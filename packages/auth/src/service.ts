/**
 * Sign-in by phone and one-time code (CHG-001 D9; ARCH-001 §11.1).
 *
 * 1. `requestCode`: a US mobile number gets a six-digit code by SMS,
 *    at most one a minute and five an hour per number, twenty an hour per
 *    network address. A new code replaces the previous one.
 * 2. `signIn`: the right code, within five minutes and five tries, signs the
 *    person in: their account is created on the first sign-in. They get an
 *    access token (an hour) and a refresh token (thirty days, once).
 * 3. `refresh`: a refresh token buys a new pair and is spent. Spent twice
 *    means someone kept a copy: every session of that sign-in is revoked.
 * 4. `logout` revokes the session; `callerFor` names the person behind an
 *    access token, or nobody.
 *
 * 5. `issueNonce` and `signInWith`: Sign in with Apple or Google (ADR-0026).
 *    The app asks for a one-time nonce, hands it to the platform's sign-in
 *    sheet, and sends back the ID token it got. A verified token finds the
 *    account by the provider's subject id, or creates one.
 *
 * The database never sees a number, an address, a code, a token or a
 * provider's subject id in the clear (`Hasher`). The answers never say
 * whether a number or an Apple or Google account has an account here.
 */
import { PROVIDER_ENDPOINTS, verifyIdToken } from "./oidc.js";
import type { KeyLookup, SocialProvider } from "./oidc.js";
import { normalizePhone } from "./phone.js";
import { AUTH_POLICY } from "./policy.js";
import { randomCode, randomToken } from "./secrets.js";
import type { Hasher } from "./secrets.js";

/** A freshly minted pair; only their hashes are stored. */
export interface IssuedTokens {
  readonly accessToken: string;
  readonly accessExpiresAt: Date;
  readonly refreshToken: string;
  readonly refreshExpiresAt: Date;
}

/** What the repository stores for a new session. */
export interface StoredTokens {
  readonly accessHash: string;
  readonly accessExpiresAt: Date;
  readonly refreshHash: string;
  readonly refreshExpiresAt: Date;
}

export interface CodeLimits {
  readonly resendAfterS: number;
  readonly perPhonePerHour: number;
  readonly perIpPerHour: number;
}

export type VerifyRefusal =
  /** No pending code for this number. */
  | "no_code"
  | "wrong_code"
  | "expired"
  /** Too many wrong tries: the code is locked, a new one is needed. */
  | "locked";

export type RefreshRefusal = "unknown" | "expired" | "revoked" | "reused";

/** The storage sign-in needs; `@serendipity/db` `pgAuthRepository` implements it. */
export interface AuthRepository {
  /**
   * Records a new pending code for the number, replacing any earlier one,
   * unless a limit is reached; then says how long to wait.
   */
  requestCode(input: {
    readonly phoneHash: string;
    readonly ipHash: string;
    readonly codeHash: string;
    readonly now: Date;
    readonly expiresAt: Date;
    readonly limits: CodeLimits;
  }): Promise<{ readonly ok: true } | { readonly ok: false; readonly retryAfterS: number }>;
  /**
   * Checks a code against the number's pending one, counting a wrong try.
   * On success, spends it, finds or creates the account and stores a session.
   */
  verify(input: {
    readonly phoneHash: string;
    readonly codeHash: string;
    readonly now: Date;
    readonly maxAttempts: number;
    readonly tokens: StoredTokens;
  }): Promise<
    | { readonly ok: true; readonly userId: string; readonly created: boolean }
    | { readonly ok: false; readonly refusal: VerifyRefusal }
  >;
  /** Spends a refresh token for a new session in the same family; a reused one revokes the family. */
  refresh(input: {
    readonly refreshHash: string;
    readonly now: Date;
    readonly tokens: StoredTokens;
  }): Promise<
    | { readonly ok: true; readonly userId: string }
    | { readonly ok: false; readonly refusal: RefreshRefusal }
  >;
  /** Revokes the session the access token belongs to (nothing if none). */
  logout(accessHash: string, now: Date): Promise<void>;
  /** Stores a one-time sign-in nonce, unless the address asked for too many. */
  issueNonce(input: {
    readonly nonceHash: string;
    readonly ipHash: string;
    readonly now: Date;
    readonly expiresAt: Date;
    readonly perIpPerHour: number;
  }): Promise<{ readonly ok: true } | { readonly ok: false; readonly retryAfterS: number }>;
  /**
   * Spends the nonce, then finds the account for the provider's subject or
   * creates one, and stores a session. Refuses a spent, expired or unknown
   * nonce, a closed account and a subject banned with a suspended account.
   */
  socialSignIn(input: {
    readonly provider: SocialProvider;
    readonly subjectHash: string;
    readonly nonceHash: string;
    readonly now: Date;
    readonly tokens: StoredTokens;
  }): Promise<
    | { readonly ok: true; readonly userId: string; readonly created: boolean }
    | { readonly ok: false; readonly refusal: "bad_nonce" | "account_closed" }
  >;
  /** The user behind a live access token, or `null`. */
  callerFor(accessHash: string, now: Date): Promise<string | null>;
}

/** Delivers a code. Real vendors plug in here (P00-04/CHG-001 D9); dev and test use a fake. */
export interface SmsProvider {
  /** The provider's name, for the audit trail and to refuse fakes in deployed environments. */
  readonly name: string;
  sendCode(phoneE164: string, code: string): Promise<void>;
}

export type CodeRequest =
  | { readonly ok: true; readonly resendAfterS: number }
  | { readonly ok: false; readonly problem: "invalid_phone" }
  | { readonly ok: false; readonly problem: "rate_limited"; readonly retryAfterS: number };

export type SignIn =
  | {
      readonly ok: true;
      readonly userId: string;
      /** The account was created by this sign-in. */
      readonly created: boolean;
      readonly tokens: IssuedTokens;
    }
  | { readonly ok: false; readonly problem: "invalid_phone" | "invalid_code" };

/** How the server checks Apple's and Google's ID tokens. */
export interface SocialConfig {
  /** Our client IDs per provider; a provider with none is not offered. */
  readonly audiences: Readonly<Partial<Record<SocialProvider, readonly string[]>>>;
  readonly keys: Readonly<Partial<Record<SocialProvider, KeyLookup>>>;
}

export type NonceRequest =
  | { readonly ok: true; readonly nonce: string; readonly expiresAt: Date }
  | { readonly ok: false; readonly problem: "rate_limited"; readonly retryAfterS: number };

export type SocialSignIn =
  | {
      readonly ok: true;
      readonly userId: string;
      readonly created: boolean;
      readonly tokens: IssuedTokens;
    }
  /** Not configured here (503), or any token or nonce that will not do (401). */
  | { readonly ok: false; readonly problem: "unavailable" | "rejected" };

export type Refresh =
  | { readonly ok: true; readonly userId: string; readonly tokens: IssuedTokens }
  | { readonly ok: false };

export interface AuthService {
  requestCode(rawPhone: string, ip: string): Promise<CodeRequest>;
  signIn(rawPhone: string, code: string): Promise<SignIn>;
  refresh(refreshToken: string): Promise<Refresh>;
  logout(accessToken: string): Promise<void>;
  callerFor(accessToken: string): Promise<string | null>;
  /** The providers this server can check tokens for. */
  readonly socialProviders: readonly SocialProvider[];
  issueNonce(ip: string): Promise<NonceRequest>;
  signInWith(provider: SocialProvider, idToken: string, nonce: string): Promise<SocialSignIn>;
}

const CODE = /^\d+$/;
const ACCESS = /^sa_[A-Za-z0-9_-]{43}$/;
const REFRESH = /^sr_[A-Za-z0-9_-]{43}$/;
const NONCE = /^sn_[A-Za-z0-9_-]{43}$/;
/** Apple's and Google's tokens are a few kilobytes at most. */
const MAX_ID_TOKEN_LENGTH = 8_192;

export function createAuthService(deps: {
  readonly repository: AuthRepository;
  readonly sms: SmsProvider;
  readonly hasher: Hasher;
  readonly clock?: () => Date;
  /** Draws a code; tests and the dev fake may fix it. */
  readonly codes?: () => string;
  /** Sign in with Apple and Google; left out, neither is offered. */
  readonly social?: SocialConfig;
}): AuthService {
  const now = deps.clock ?? (() => new Date());
  const draw = deps.codes ?? (() => randomCode(AUTH_POLICY.codeLength));
  const { hash } = deps.hasher;
  const codeHashFor = (phoneHash: string, code: string) => hash("code", `${phoneHash}:${code}`);

  function issue(at: Date): { issued: IssuedTokens; stored: StoredTokens } {
    const accessToken = randomToken("access");
    const refreshToken = randomToken("refresh");
    const accessExpiresAt = new Date(at.getTime() + AUTH_POLICY.accessTtlS * 1000);
    const refreshExpiresAt = new Date(at.getTime() + AUTH_POLICY.refreshTtlS * 1000);
    return {
      issued: { accessToken, accessExpiresAt, refreshToken, refreshExpiresAt },
      stored: {
        accessHash: hash("token", accessToken),
        accessExpiresAt,
        refreshHash: hash("token", refreshToken),
        refreshExpiresAt,
      },
    };
  }

  const social = deps.social;
  const socialProviders = (["apple", "google"] as const).filter(
    (provider) =>
      (social?.audiences[provider]?.length ?? 0) > 0 && social?.keys[provider] !== undefined,
  );

  return {
    socialProviders,

    async issueNonce(ip) {
      const at = now();
      const nonce = randomToken("nonce");
      const expiresAt = new Date(at.getTime() + AUTH_POLICY.nonceTtlS * 1000);
      const stored = await deps.repository.issueNonce({
        nonceHash: hash("nonce", nonce),
        ipHash: hash("ip", ip),
        now: at,
        expiresAt,
        perIpPerHour: AUTH_POLICY.noncesPerIpPerHour,
      });
      if (!stored.ok)
        return { ok: false, problem: "rate_limited", retryAfterS: stored.retryAfterS };
      return { ok: true, nonce, expiresAt };
    },

    async signInWith(provider, idToken, nonce) {
      const audiences = social?.audiences[provider] ?? [];
      const keys = social?.keys[provider];
      if (!socialProviders.includes(provider) || keys === undefined) {
        return { ok: false, problem: "unavailable" };
      }
      if (!NONCE.test(nonce) || idToken.length > MAX_ID_TOKEN_LENGTH) {
        return { ok: false, problem: "rejected" };
      }
      const at = now();
      const checked = await verifyIdToken(idToken, {
        endpoints: PROVIDER_ENDPOINTS[provider],
        audiences,
        keys,
        now: at,
        nonce,
      });
      if (!checked.ok) return { ok: false, problem: "rejected" };
      const { issued, stored } = issue(at);
      const signedIn = await deps.repository.socialSignIn({
        provider,
        subjectHash: hash("subject", `${provider}:${checked.subject}`),
        nonceHash: hash("nonce", nonce),
        now: at,
        tokens: stored,
      });
      // A spent nonce and a closed account read alike to the client.
      if (!signedIn.ok) return { ok: false, problem: "rejected" };
      return { ok: true, userId: signedIn.userId, created: signedIn.created, tokens: issued };
    },

    async requestCode(rawPhone, ip) {
      const phone = normalizePhone(rawPhone);
      if (phone === null) return { ok: false, problem: "invalid_phone" };
      const at = now();
      const phoneHash = hash("phone", phone);
      const code = draw();
      const recorded = await deps.repository.requestCode({
        phoneHash,
        ipHash: hash("ip", ip),
        codeHash: codeHashFor(phoneHash, code),
        now: at,
        expiresAt: new Date(at.getTime() + AUTH_POLICY.codeTtlS * 1000),
        limits: {
          resendAfterS: AUTH_POLICY.resendAfterS,
          perPhonePerHour: AUTH_POLICY.codesPerPhonePerHour,
          perIpPerHour: AUTH_POLICY.codesPerIpPerHour,
        },
      });
      if (!recorded.ok) {
        return { ok: false, problem: "rate_limited", retryAfterS: recorded.retryAfterS };
      }
      await deps.sms.sendCode(phone, code);
      return { ok: true, resendAfterS: AUTH_POLICY.resendAfterS };
    },

    async signIn(rawPhone, code) {
      const phone = normalizePhone(rawPhone);
      if (phone === null) return { ok: false, problem: "invalid_phone" };
      // Not a code at all: refused without counting, and without a lookup.
      if (code.length !== AUTH_POLICY.codeLength || !CODE.test(code)) {
        return { ok: false, problem: "invalid_code" };
      }
      const at = now();
      const phoneHash = hash("phone", phone);
      const { issued, stored } = issue(at);
      const verified = await deps.repository.verify({
        phoneHash,
        codeHash: codeHashFor(phoneHash, code),
        now: at,
        maxAttempts: AUTH_POLICY.maxAttempts,
        tokens: stored,
      });
      // Every refusal reads the same to the client: no hint about which numbers have codes.
      if (!verified.ok) return { ok: false, problem: "invalid_code" };
      return { ok: true, userId: verified.userId, created: verified.created, tokens: issued };
    },

    async refresh(refreshToken) {
      if (!REFRESH.test(refreshToken)) return { ok: false };
      const at = now();
      const { issued, stored } = issue(at);
      const refreshed = await deps.repository.refresh({
        refreshHash: hash("token", refreshToken),
        now: at,
        tokens: stored,
      });
      return refreshed.ok ? { ok: true, userId: refreshed.userId, tokens: issued } : { ok: false };
    },

    async logout(accessToken) {
      if (!ACCESS.test(accessToken)) return;
      await deps.repository.logout(hash("token", accessToken), now());
    },

    async callerFor(accessToken) {
      if (!ACCESS.test(accessToken)) return null;
      return deps.repository.callerFor(hash("token", accessToken), now());
    },
  };
}
