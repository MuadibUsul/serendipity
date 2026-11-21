/**
 * Sign in with Apple and Google (ADR-0026): checking the ID token the app
 * gets from the platform's own sign-in sheet.
 *
 * A token counts only when all of these hold:
 * - it is an RS256 JWT, signed by one of the provider's published keys;
 * - it comes from the provider's issuer, for one of our app's client IDs;
 * - it is current: not expired, not issued in the future;
 * - it carries the one-time nonce this server issued for the attempt (raw, or
 *   as its SHA-256 hex, which is how Apple's sheet is usually given it), so
 *   a token cannot be replayed.
 *
 * Only the provider's stable subject id is used, and only as a keyed hash.
 * The email, name and anything else in the token are ignored: an email is
 * never used to join accounts, since that is how accounts get taken over.
 */
import { createHash, createPublicKey, verify } from "node:crypto";
import type { JsonWebKey } from "node:crypto";

export const SOCIAL_PROVIDERS = ["apple", "google"] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

export const isSocialProvider = (value: unknown): value is SocialProvider =>
  SOCIAL_PROVIDERS.some((provider) => provider === value);

export interface ProviderEndpoints {
  /** Accepted `iss` values. */
  readonly issuers: readonly string[];
  /** Where the provider publishes its signing keys. */
  readonly jwksUrl: string;
}

export const PROVIDER_ENDPOINTS: Readonly<Record<SocialProvider, ProviderEndpoints>> = {
  apple: {
    issuers: ["https://appleid.apple.com"],
    jwksUrl: "https://appleid.apple.com/auth/keys",
  },
  google: {
    issuers: ["https://accounts.google.com", "accounts.google.com"],
    jwksUrl: "https://www.googleapis.com/oauth2/v3/certs",
  },
};

/** Clock difference tolerated between us and the provider. */
export const CLOCK_SKEW_S = 60;

export type IdTokenRefusal =
  | "malformed"
  | "unsupported_algorithm"
  | "unknown_key"
  | "bad_signature"
  | "wrong_issuer"
  | "wrong_audience"
  | "expired"
  | "not_yet_valid"
  | "nonce_mismatch"
  | "no_subject";

export type IdTokenCheck =
  | { readonly ok: true; readonly subject: string }
  | { readonly ok: false; readonly refusal: IdTokenRefusal };

/** Finds a provider's public key by its `kid`, or `null`. */
export type KeyLookup = (kid: string) => Promise<JsonWebKey | null>;

function decodePart(part: string): unknown {
  try {
    return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** SHA-256 of `value`, lowercase hex: the nonce form Apple's sheet is usually given. */
export const sha256Hex = (value: string) => createHash("sha256").update(value).digest("hex");

export async function verifyIdToken(
  token: string,
  options: {
    readonly endpoints: ProviderEndpoints;
    /** Our app's client IDs at this provider (bundle ID, OAuth client IDs). */
    readonly audiences: readonly string[];
    readonly keys: KeyLookup;
    readonly now: Date;
    /** The raw nonce this server issued for the attempt. */
    readonly nonce: string;
  },
): Promise<IdTokenCheck> {
  const refuse = (refusal: IdTokenRefusal): IdTokenCheck => ({ ok: false, refusal });
  const parts = token.split(".");
  if (parts.length !== 3 || !parts.every((part) => BASE64URL.test(part))) {
    return refuse("malformed");
  }
  const [headerPart = "", payloadPart = "", signaturePart = ""] = parts;
  const header = decodePart(headerPart);
  const claims = decodePart(payloadPart);
  if (!isRecord(header) || !isRecord(claims)) return refuse("malformed");
  // Only RS256: never `none`, never an HMAC keyed with a public key.
  if (header["alg"] !== "RS256") return refuse("unsupported_algorithm");
  const kid = header["kid"];
  if (typeof kid !== "string") return refuse("unknown_key");
  const jwk = await options.keys(kid);
  if (jwk?.kty !== "RSA") return refuse("unknown_key");
  let signed: boolean;
  try {
    signed = verify(
      "RSA-SHA256",
      Buffer.from(`${headerPart}.${payloadPart}`),
      createPublicKey({ key: jwk, format: "jwk" }),
      Buffer.from(signaturePart, "base64url"),
    );
  } catch {
    signed = false;
  }
  if (!signed) return refuse("bad_signature");

  if (typeof claims["iss"] !== "string" || !options.endpoints.issuers.includes(claims["iss"])) {
    return refuse("wrong_issuer");
  }
  const aud = claims["aud"];
  const audiences = typeof aud === "string" ? [aud] : Array.isArray(aud) ? aud : [];
  if (!audiences.some((value) => typeof value === "string" && options.audiences.includes(value))) {
    return refuse("wrong_audience");
  }
  const nowS = Math.floor(options.now.getTime() / 1000);
  const exp = claims["exp"];
  if (typeof exp !== "number" || exp + CLOCK_SKEW_S <= nowS) return refuse("expired");
  const iat = claims["iat"];
  if (typeof iat !== "number" || iat - CLOCK_SKEW_S > nowS) return refuse("not_yet_valid");
  const nonce = claims["nonce"];
  if (
    options.nonce === "" ||
    typeof nonce !== "string" ||
    (nonce !== options.nonce && nonce !== sha256Hex(options.nonce))
  ) {
    return refuse("nonce_mismatch");
  }
  const sub = claims["sub"];
  if (typeof sub !== "string" || sub.length === 0 || sub.length > 255) {
    return refuse("no_subject");
  }
  return { ok: true, subject: sub };
}

/**
 * A provider's published keys, cached. An unknown `kid` (the provider
 * rotated its keys) fetches again, at most once a minute, so a stream of
 * made-up kids cannot turn us into a request amplifier.
 */
export function publishedKeys(
  url: string,
  options: {
    readonly fetch?: (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
    readonly ttlMs?: number;
    readonly minRefetchMs?: number;
    readonly now?: () => number;
  } = {},
): KeyLookup {
  const get = options.fetch ?? ((target: string) => fetch(target));
  const ttlMs = options.ttlMs ?? 60 * 60 * 1000;
  const minRefetchMs = options.minRefetchMs ?? 60 * 1000;
  const now = options.now ?? Date.now;
  let keys = new Map<string, JsonWebKey>();
  let fetchedAt = Number.NEGATIVE_INFINITY;

  async function load(): Promise<void> {
    fetchedAt = now();
    const response = await get(url);
    if (!response.ok) return;
    const body = await response.json();
    if (!isRecord(body) || !Array.isArray(body["keys"])) return;
    const next = new Map<string, JsonWebKey>();
    for (const key of body["keys"]) {
      if (isRecord(key) && typeof key["kid"] === "string") {
        next.set(key["kid"], key);
      }
    }
    keys = next;
  }

  return async (kid) => {
    const age = now() - fetchedAt;
    if (age > ttlMs || (!keys.has(kid) && age > minRefetchMs)) {
      try {
        await load();
      } catch {
        // Unreachable: keep what we had; an unknown kid stays unknown.
      }
    }
    return keys.get(kid) ?? null;
  };
}
