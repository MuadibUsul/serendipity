// The identity service the rest of the backend calls. It fails closed: when
// it cannot find out, the answer is "not eligible", returned as a value (or,
// from assertEligible, thrown), never an error a caller might swallow and
// carry on past.
import { eligibility } from "./eligibility.js";
import type { Attestation, Eligibility, IneligibleReason } from "./eligibility.js";
import type { IdentityProvider, VerificationResult, VerificationSession } from "./provider.js";

export type RecordOutcome = "recorded" | "updated" | "unchanged";

/** Where attestations live (`pgAttestationStore` in @serendipity/db). */
export interface AttestationStore {
  attestationsFor(userId: string): Promise<readonly Attestation[]>;
  /**
   * Stores a provider's verdict for `userId`, once per (provider, reference).
   * A later verdict for the same reference replaces an earlier one; an older
   * or repeated one changes nothing.
   */
  record(
    userId: string,
    attestation: Attestation,
    context: { traceId?: string },
  ): Promise<RecordOutcome>;
}

/** Thrown by `assertEligible`: invitation and payment code must not continue past it. */
export class NotEligible extends Error {
  override readonly name = "NotEligible";
  constructor(readonly reason: IneligibleReason) {
    super(`not eligible: ${reason}`);
  }
}

export interface IdentityService {
  eligible(userId: string): Promise<Eligibility>;
  assertEligible(userId: string): Promise<void>;
  startVerification(userId: string): Promise<VerificationSession>;
  /** Verifies and records a provider callback. Pending results record nothing. */
  handleCallback(
    headers: Readonly<Record<string, string | undefined>>,
    rawBody: string,
    context?: { traceId?: string },
  ): Promise<RecordOutcome | "pending">;
}

export interface IdentityServiceOptions {
  readonly provider: IdentityProvider;
  readonly store: AttestationStore;
  readonly requireRealPerson?: boolean;
  /** A store slower than this counts as unavailable. */
  readonly timeoutMs?: number;
  readonly now?: () => Date;
}

class Timeout extends Error {}

function within<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Timeout());
    }, ms);
  });
  return Promise.race([work, timeout]).finally(() => {
    clearTimeout(timer);
  });
}

function toAttestation(provider: string, result: VerificationResult): Attestation {
  return {
    provider,
    providerRef: result.providerRef,
    ageVerified: result.ageVerified,
    realPersonVerified: result.realPersonVerified,
    verifiedAt: result.checkedAt,
    expiresAt: result.expiresAt,
  };
}

export function createIdentityService({
  provider,
  store,
  requireRealPerson = true,
  timeoutMs = 2_000,
  now = () => new Date(),
}: IdentityServiceOptions): IdentityService {
  const policy = { provider: provider.name, requireRealPerson };

  async function eligible(userId: string): Promise<Eligibility> {
    try {
      const attestations = await within(store.attestationsFor(userId), timeoutMs);
      return eligibility(attestations, now(), policy);
    } catch {
      return { eligible: false, reason: "unavailable" };
    }
  }

  return {
    eligible,
    async assertEligible(userId) {
      const answer = await eligible(userId);
      if (!answer.eligible) throw new NotEligible(answer.reason);
    },
    startVerification: (userId) => within(provider.start(userId), timeoutMs),
    async handleCallback(headers, rawBody, context = {}) {
      const result = provider.parseCallback(headers, rawBody, now());
      if (result.status === "pending") return "pending";
      return store.record(result.subject, toAttestation(provider.name, result), context);
    },
  };
}
