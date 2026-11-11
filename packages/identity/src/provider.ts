// The contract every verification vendor adapter fulfils (ARCH-001 §2: a
// provider adapter; the vendor is chosen in ser-p00-04). Results carry only
// what eligibility needs; anything else a vendor sends is dropped here.
import { createHmac, timingSafeEqual } from "node:crypto";

export type VerificationStatus = "pending" | "verified" | "rejected";

export interface VerificationResult {
  readonly providerRef: string;
  /** Our user id, sent to the provider as its external reference (a pseudonymous UUID). */
  readonly subject: string;
  readonly status: VerificationStatus;
  readonly ageVerified: boolean;
  readonly realPersonVerified: boolean;
  readonly checkedAt: Date;
  readonly expiresAt: Date | null;
}

export interface VerificationSession {
  readonly providerRef: string;
  /** Where the person completes the check, on the provider's side. */
  readonly url: string;
  readonly expiresAt: Date;
}

export interface IdentityProvider {
  readonly name: string;
  start(subject: string): Promise<VerificationSession>;
  /** Asks the provider directly (for reconciliation when a callback is missed). */
  result(providerRef: string): Promise<VerificationResult>;
  /** A callback's result, or `CallbackRejected` unless it is authentic and fresh. */
  parseCallback(
    headers: Readonly<Record<string, string | undefined>>,
    rawBody: string,
    now: Date,
  ): VerificationResult;
}

export type CallbackRejection = "missing_signature" | "bad_signature" | "stale" | "malformed";

export class CallbackRejected extends Error {
  override readonly name = "CallbackRejected";
  constructor(readonly reason: CallbackRejection) {
    super(`identity callback rejected: ${reason}`);
  }
}

/** Callbacks older or newer than this are refused: a captured callback cannot be replayed later. */
export const CALLBACK_TOLERANCE_SECONDS = 300;

/** `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`: the scheme the fake provider uses. */
export function signCallback(secret: string, rawBody: string, at: Date): string {
  const t = Math.floor(at.getTime() / 1000);
  const v1 = createHmac("sha256", secret)
    .update(`${String(t)}.${rawBody}`)
    .digest("hex");
  return `t=${String(t)},v1=${v1}`;
}

export function verifyCallbackSignature(
  secret: string,
  header: string | undefined,
  rawBody: string,
  now: Date,
  toleranceSeconds = CALLBACK_TOLERANCE_SECONDS,
): void {
  if (header === undefined || header === "") throw new CallbackRejected("missing_signature");
  const parts = new Map(
    header.split(",").map((part) => {
      const [key = "", ...value] = part.trim().split("=");
      return [key, value.join("=")] as const;
    }),
  );
  const t = Number(parts.get("t"));
  const given = parts.get("v1") ?? "";
  if (!Number.isInteger(t) || !/^[0-9a-f]{64}$/.test(given))
    throw new CallbackRejected("bad_signature");
  const expected = createHmac("sha256", secret)
    .update(`${String(t)}.${rawBody}`)
    .digest();
  if (!timingSafeEqual(expected, Buffer.from(given, "hex")))
    throw new CallbackRejected("bad_signature");
  if (Math.abs(now.getTime() / 1000 - t) > toleranceSeconds) throw new CallbackRejected("stale");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REF = /^[A-Za-z0-9_-]{8,128}$/;
const STATUSES = new Set<string>(["pending", "verified", "rejected"]);

function date(value: unknown): Date | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/**
 * Reads the fields eligibility needs from a decoded callback body, checking
 * each, and nothing else: names, birthdates and document numbers a vendor
 * might add never get past this function.
 */
export function readResult(body: unknown): VerificationResult {
  if (typeof body !== "object" || body === null) throw new CallbackRejected("malformed");
  const fields = body as Record<string, unknown>;
  const providerRef = fields["provider_ref"];
  const subject = fields["subject"];
  const status = fields["status"];
  const ageVerified = fields["age_verified"];
  const realPersonVerified = fields["real_person_verified"];
  const checkedAt = date(fields["checked_at"]);
  const expiresAt = fields["expires_at"] === null ? null : date(fields["expires_at"]);
  if (
    typeof providerRef !== "string" ||
    !REF.test(providerRef) ||
    typeof subject !== "string" ||
    !UUID.test(subject) ||
    typeof status !== "string" ||
    !STATUSES.has(status) ||
    typeof ageVerified !== "boolean" ||
    typeof realPersonVerified !== "boolean" ||
    checkedAt === undefined ||
    expiresAt === undefined ||
    (expiresAt !== null && expiresAt.getTime() <= checkedAt.getTime())
  ) {
    throw new CallbackRejected("malformed");
  }
  // A check that is not verified proves nothing, whatever its flags say.
  const verified = status === "verified";
  return {
    providerRef,
    subject,
    status: status as VerificationStatus,
    ageVerified: verified && ageVerified,
    realPersonVerified: verified && realPersonVerified,
    checkedAt,
    expiresAt,
  };
}
