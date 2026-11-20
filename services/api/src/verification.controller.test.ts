// The age and real-person check endpoints over HTTP (ADR-0025): a fake
// vendor, an in-memory attestation store and an in-memory repository.
import { SCOPES } from "@serendipity/consent";
import type {
  InvitationRepository,
  VerificationFacts,
  VerificationRepository,
} from "@serendipity/db";
import { createFakeIdentityProvider, createIdentityService } from "@serendipity/identity";
import type { Attestation, AttestationStore, TierFacts } from "@serendipity/identity";
import { afterEach, describe, expect, it } from "vitest";

import { DEV_CALLER_HEADER, devHeaderCallers } from "./callers.js";
import { READY, fixedReadiness, testApi } from "./test-support.js";

const NOW = new Date("2026-11-19T20:00:00Z");
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SECRET = "test-identity-callback-secret-0123456789";
const as = { [DEV_CALLER_HEADER]: ME };

const NO_INVITATIONS: InvitationRepository = {
  forUser: () => Promise.resolve([]),
  forUserDate: () => Promise.resolve(null),
  answer: () => Promise.resolve({ kind: "not_found" }),
  open: () => Promise.resolve(false),
  expireDue: () => Promise.resolve(0),
};

function memory(initial: Partial<VerificationFacts> = {}, tier: Partial<TierFacts> = {}) {
  let facts: VerificationFacts = {
    accountOpen: true,
    hasBirthDate: true,
    biometricConsent: false,
    startsToday: 0,
    ...initial,
  };
  const attestations: Attestation[] = [];
  const started: unknown[][] = [];
  const store: AttestationStore = {
    attestationsFor: () => Promise.resolve(attestations),
    factsFor: () =>
      Promise.resolve({
        declaredAge: 30,
        region: null,
        impersonationReported: false,
        minorSuspected: false,
        ...tier,
      }),
    record(_userId, attestation) {
      attestations.push(attestation);
      return Promise.resolve("recorded");
    },
  };
  const repository: VerificationRepository = {
    facts: (userId) => Promise.resolve(userId === ME ? facts : null),
    grantConsent() {
      facts = { ...facts, biometricConsent: true };
      return Promise.resolve("granted");
    },
    withdrawConsent() {
      const held = facts.biometricConsent;
      facts = { ...facts, biometricConsent: false };
      return Promise.resolve(
        held ? { kind: "withdrawn", deletionsQueued: 1 } : { kind: "not_held" },
      );
    },
    recordStart(...args) {
      started.push(args.slice(0, 4));
      facts = { ...facts, startsToday: facts.startsToday + 1 };
      return Promise.resolve();
    },
  };
  return { repository, store, started, attestations };
}

let running: Awaited<ReturnType<typeof testApi>> | undefined;

async function start(initial: Partial<VerificationFacts> = {}, tier: Partial<TierFacts> = {}) {
  const state = memory(initial, tier);
  const provider = createFakeIdentityProvider({ env: "test", secret: SECRET });
  const identity = createIdentityService({ provider, store: state.store, now: () => NOW });
  running = await testApi(fixedReadiness(READY), "test", {
    repository: NO_INVITATIONS,
    verification: { repository: state.repository, identity },
    callers: devHeaderCallers("test"),
    clock: () => NOW,
  });
  return { app: running.app, provider, ...state };
}

afterEach(async () => {
  await running?.app.close();
  running = undefined;
});

const agree = { agreed: true, version: SCOPES.biometric_verification.version };

describe("verification endpoints", () => {
  it("answer 401 without a caller", async () => {
    const { app } = await start();
    for (const [method, url] of [
      ["GET", "/v1/me/verification"],
      ["POST", "/v1/me/verification"],
      ["PUT", "/v1/me/verification/consent"],
      ["DELETE", "/v1/me/verification/consent"],
    ] as const) {
      const response = await app.inject({ method, url, payload: agree });
      expect(response.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it("shows the biometric terms in full, and that consent is needed first", async () => {
    const { app } = await start();
    const response = await app.inject({ method: "GET", url: "/v1/me/verification", headers: as });
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({
      verified: false,
      next_check: "liveness",
      consent: {
        held: false,
        text: SCOPES.biometric_verification.description,
        version: SCOPES.biometric_verification.version,
      },
      blocked_by: "no_consent",
    });
  });

  it("refuses to start a check before the person agreed, and never reaches the vendor", async () => {
    const { app, started } = await start();
    const response = await app.inject({ method: "POST", url: "/v1/me/verification", headers: as });
    expect(response.statusCode).toBe(403);
    expect(started).toEqual([]);
  });

  it("asks for the date of birth before anything else", async () => {
    const { app, started } = await start({ hasBirthDate: false, biometricConsent: true });
    const response = await app.inject({ method: "POST", url: "/v1/me/verification", headers: as });
    expect(response.statusCode).toBe(409);
    expect(started).toEqual([]);
  });

  it("takes agreement only to the version shown", async () => {
    const { app } = await start();
    for (const payload of [{}, { agreed: true }, { agreed: true, version: 0 }, { agreed: "yes" }]) {
      const response = await app.inject({
        method: "PUT",
        url: "/v1/me/verification/consent",
        headers: as,
        payload,
      });
      expect(response.statusCode, JSON.stringify(payload)).toBe(400);
    }
  });

  it("runs a selfie check end to end: agree, start, vendor callback, verified", async () => {
    const { app, provider, started } = await start();
    const agreed = await app.inject({
      method: "PUT",
      url: "/v1/me/verification/consent",
      headers: as,
      payload: agree,
    });
    expect(agreed.json()).toEqual({ held: true });

    const begun = await app.inject({ method: "POST", url: "/v1/me/verification", headers: as });
    expect(begun.statusCode).toBe(201);
    const body = begun.json<{ url: string; check: string }>();
    expect(body.check).toBe("liveness");
    const providerRef = body.url.split("/").at(-1) ?? "";
    expect(started).toEqual([[ME, "fake", providerRef, "liveness"]]);

    const callback = provider.complete(providerRef, NOW, {
      level: "liveness",
      estimatedAge: 31,
      faceMatch: true,
      ageVerified: false,
      realPersonVerified: true,
      validDays: 365,
    });
    const delivered = await app.inject({
      method: "POST",
      url: "/v1/identity/callback",
      headers: { ...callback.headers, "content-type": "application/json" },
      payload: callback.body,
    });
    expect(delivered.statusCode).toBe(204);

    const after = await app.inject({ method: "GET", url: "/v1/me/verification", headers: as });
    expect(after.json()).toMatchObject({ verified: true, next_check: null });
  });

  it("asks for an ID check when tiering needs one, without saying why", async () => {
    const { app } = await start({ biometricConsent: true }, { impersonationReported: true });
    const status = await app.inject({ method: "GET", url: "/v1/me/verification", headers: as });
    expect(status.json()).toMatchObject({ next_check: "document" });
    expect(status.body).not.toMatch(/impersonation|report/);
    const begun = await app.inject({ method: "POST", url: "/v1/me/verification", headers: as });
    expect(begun.json()).toMatchObject({ check: "document" });
  });

  it("refuses a callback whose signature does not cover the exact body", async () => {
    const { app, provider, attestations } = await start({ biometricConsent: true });
    const begun = await app.inject({ method: "POST", url: "/v1/me/verification", headers: as });
    const providerRef = begun.json<{ url: string }>().url.split("/").at(-1) ?? "";
    const callback = provider.complete(providerRef, NOW);
    for (const [headers, payload] of [
      // No signature.
      [{}, callback.body],
      // The same JSON, but not the same bytes: a re-serialised body must not pass.
      [callback.headers, `${callback.body} `],
      // Another person's reference under this signature.
      [callback.headers, callback.body.replace(providerRef, `${providerRef}0`)],
    ] as const) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/identity/callback",
        headers: { ...headers, "content-type": "application/json" },
        payload,
      });
      expect(response.statusCode).toBe(401);
    }
    expect(attestations).toEqual([]);
  });

  it("allows three checks a day", async () => {
    const { app, started } = await start({ biometricConsent: true });
    const answers = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/v1/me/verification",
        headers: as,
      });
      answers.push(response.statusCode);
    }
    expect(answers).toEqual([201, 201, 201, 429]);
    expect(started).toHaveLength(3);
  });

  it("withdraws the agreement", async () => {
    const { app } = await start({ biometricConsent: true });
    const response = await app.inject({
      method: "DELETE",
      url: "/v1/me/verification/consent",
      headers: as,
    });
    expect(response.json()).toEqual({ held: false });
    const after = await app.inject({ method: "GET", url: "/v1/me/verification", headers: as });
    expect(after.json()).toMatchObject({ consent: { held: false }, blocked_by: "no_consent" });
  });
});
