import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/**
 * Keyed hashes, so the database never holds a phone number, a network
 * address, a code or a token in the clear: a stolen copy of the tables
 * cannot be read back or replayed without the server's secret.
 */
export interface Hasher {
  /** The keyed hash of `value` for one `purpose` (phone, ip, code, token). */
  readonly hash: (purpose: "phone" | "ip" | "code" | "token", value: string) => string;
}

/** The secret must be long enough to resist guessing: at least 32 bytes. */
export const MIN_SECRET_BYTES = 32;

export function createHasher(secret: string): Hasher {
  if (Buffer.byteLength(secret, "utf8") < MIN_SECRET_BYTES) {
    throw new Error(`auth: the secret must be at least ${String(MIN_SECRET_BYTES)} bytes`);
  }
  return {
    hash: (purpose, value) =>
      createHmac("sha256", secret).update(`${purpose}:${value}`).digest("base64url"),
  };
}

/** Constant-time equality of two hashes. */
export function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** A uniformly random code of `length` digits. */
export function randomCode(length: number): string {
  return Array.from({ length }, () => String(randomInt(10))).join("");
}

/** An unguessable bearer token: 256 random bits, with a prefix that says what it is. */
export function randomToken(kind: "access" | "refresh"): string {
  return `${kind === "access" ? "sa" : "sr"}_${randomBytes(32).toString("base64url")}`;
}
