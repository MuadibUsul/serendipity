// A deterministic stand-in provider for dev and test, until the real vendor
// is chosen (ser-p00-04). It cannot be built in staging or prod, and its
// attestations never count there: eligibility only counts the configured
// provider's.
import { randomUUID } from "node:crypto";

import { DEPLOYED } from "@serendipity/config";
import type { Environment } from "@serendipity/config";

import { CallbackRejected, readResult, signCallback, verifyCallbackSignature } from "./provider.js";
import type { IdentityProvider, VerificationResult, VerificationSession } from "./provider.js";

export const FAKE_PROVIDER = "fake";

export interface FakeOutcome {
  readonly ageVerified: boolean;
  readonly realPersonVerified: boolean;
  /** Days until the attestation expires; null for never. */
  readonly validDays: number | null;
}

export interface FakeIdentityProvider extends IdentityProvider {
  /** Completes a started session and returns the signed callback the provider would send. */
  complete(
    providerRef: string,
    at: Date,
    outcome?: FakeOutcome,
  ): { headers: Record<string, string>; body: string };
}

const PASS: FakeOutcome = { ageVerified: true, realPersonVerified: true, validDays: 365 };
const DAY = 24 * 60 * 60 * 1000;

export function createFakeIdentityProvider(options: {
  readonly env: Environment;
  readonly secret: string;
}): FakeIdentityProvider {
  if (DEPLOYED.includes(options.env)) {
    throw new Error(`the fake identity provider must not run in ${options.env}`);
  }
  const sessions = new Map<string, { subject: string; result?: VerificationResult }>();

  function resultFor(providerRef: string): VerificationResult {
    const session = sessions.get(providerRef);
    if (session === undefined) throw new CallbackRejected("malformed");
    return (
      session.result ?? {
        providerRef,
        subject: session.subject,
        status: "pending",
        ageVerified: false,
        realPersonVerified: false,
        checkedAt: new Date(0),
        expiresAt: null,
      }
    );
  }

  return {
    name: FAKE_PROVIDER,
    start(subject): Promise<VerificationSession> {
      const providerRef = `fake_${randomUUID().replaceAll("-", "")}`;
      sessions.set(providerRef, { subject });
      return Promise.resolve({
        providerRef,
        url: `https://identity.fake.invalid/verify/${providerRef}`,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      });
    },
    result: (providerRef) => Promise.resolve(resultFor(providerRef)),
    parseCallback(headers, rawBody, now) {
      verifyCallbackSignature(options.secret, headers["x-signature"], rawBody, now);
      let body: unknown;
      try {
        body = JSON.parse(rawBody);
      } catch {
        throw new CallbackRejected("malformed");
      }
      return readResult(body);
    },
    complete(providerRef, at, outcome = PASS) {
      const session = sessions.get(providerRef);
      if (session === undefined) throw new Error(`no fake session ${providerRef}`);
      const verified = outcome.ageVerified;
      const result: VerificationResult = {
        providerRef,
        subject: session.subject,
        status: verified ? "verified" : "rejected",
        ageVerified: outcome.ageVerified,
        realPersonVerified: outcome.realPersonVerified,
        checkedAt: at,
        expiresAt:
          outcome.validDays === null ? null : new Date(at.getTime() + outcome.validDays * DAY),
      };
      session.result = result;
      const body = JSON.stringify({
        provider_ref: providerRef,
        subject: session.subject,
        status: result.status,
        age_verified: result.ageVerified,
        real_person_verified: result.realPersonVerified,
        checked_at: at.toISOString(),
        expires_at: result.expiresAt?.toISOString() ?? null,
      });
      return { headers: { "x-signature": signCallback(options.secret, body, at) }, body };
    },
  };
}
