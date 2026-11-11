import { describe, expect, it } from "vitest";

import type { Attestation } from "./eligibility.js";
import { FAKE_PROVIDER, createFakeIdentityProvider } from "./fake.js";
import { CallbackRejected, signCallback, verifyCallbackSignature } from "./provider.js";
import { NotEligible, createIdentityService } from "./service.js";
import type { AttestationStore, RecordOutcome } from "./service.js";

const NOW = new Date("2026-11-11T00:00:00Z");
const USER = "6f1c2b8e-1d2a-4c3b-9e8f-0a1b2c3d4e5f";
const SECRET = "fake-secret-for-tests";

/** An in-memory store with the same idempotency rule as pgAttestationStore. */
function memoryStore(): AttestationStore & { rows: (Attestation & { userId: string })[] } {
  const rows: (Attestation & { userId: string })[] = [];
  return {
    rows,
    attestationsFor: (userId) => Promise.resolve(rows.filter((row) => row.userId === userId)),
    record(userId, attestation): Promise<RecordOutcome> {
      const existing = rows.findIndex(
        (row) =>
          row.provider === attestation.provider && row.providerRef === attestation.providerRef,
      );
      if (existing === -1) {
        rows.push({ ...attestation, userId });
        return Promise.resolve("recorded");
      }
      const row = rows[existing];
      if (row?.userId === userId && attestation.verifiedAt.getTime() > row.verifiedAt.getTime()) {
        rows[existing] = { ...attestation, userId };
        return Promise.resolve("updated");
      }
      return Promise.resolve("unchanged");
    },
  };
}

function setup(store: AttestationStore = memoryStore(), timeoutMs = 50) {
  const provider = createFakeIdentityProvider({ env: "test", secret: SECRET });
  const service = createIdentityService({ provider, store, timeoutMs, now: () => NOW });
  return { provider, service, store };
}

describe("the identity service", () => {
  it("makes a person eligible once a signed, passing callback arrives", async () => {
    const { provider, service } = setup();
    expect(await service.eligible(USER)).toEqual({ eligible: false, reason: "not_verified" });
    const session = await service.startVerification(USER);
    const callback = provider.complete(session.providerRef, NOW);
    expect(await service.handleCallback(callback.headers, callback.body)).toBe("recorded");
    expect((await service.eligible(USER)).eligible).toBe(true);
    await expect(service.assertEligible(USER)).resolves.toBeUndefined();
  });

  it("records a rejection, and a failed check proves nothing whatever its flags", async () => {
    const { provider, service } = setup();
    const session = await service.startVerification(USER);
    const callback = provider.complete(session.providerRef, NOW, {
      ageVerified: false,
      realPersonVerified: true,
      validDays: 30,
    });
    expect(await service.handleCallback(callback.headers, callback.body)).toBe("recorded");
    expect(await service.eligible(USER)).toEqual({ eligible: false, reason: "age_not_verified" });
    await expect(service.assertEligible(USER)).rejects.toEqual(new NotEligible("age_not_verified"));
  });

  it("changes nothing on a replayed callback", async () => {
    const store = memoryStore();
    const { provider, service } = setup(store);
    const session = await service.startVerification(USER);
    const callback = provider.complete(session.providerRef, NOW);
    await service.handleCallback(callback.headers, callback.body);
    expect(await service.handleCallback(callback.headers, callback.body)).toBe("unchanged");
    expect(store.rows).toHaveLength(1);
  });

  it("refuses unsigned, forged, stale and malformed callbacks", async () => {
    const { provider, service } = setup();
    const session = await service.startVerification(USER);
    const { headers, body } = provider.complete(session.providerRef, NOW);
    const forged = body.replace('"age_verified":true', '"age_verified":true,"x":1');
    const stale = signCallback(SECRET, body, new Date(NOW.getTime() - 301_000));
    for (const [h, b, reason] of [
      [{}, body, "missing_signature"],
      [{ "x-signature": "t=1,v1=zz" }, body, "bad_signature"],
      [headers, forged, "bad_signature"],
      [{ "x-signature": signCallback("another-secret", body, NOW) }, body, "bad_signature"],
      [{ "x-signature": stale }, body, "stale"],
      [{ "x-signature": signCallback(SECRET, "{nope", NOW) }, "{nope", "malformed"],
    ] as const) {
      await expect(service.handleCallback(h, b)).rejects.toEqual(new CallbackRejected(reason));
    }
    expect((await service.eligible(USER)).eligible).toBe(false);
  });

  it("keeps only what eligibility needs from a callback", async () => {
    const store = memoryStore();
    const { service } = setup(store);
    const body = JSON.stringify({
      provider_ref: "fake_ref_0001",
      subject: USER,
      status: "verified",
      age_verified: true,
      real_person_verified: true,
      checked_at: NOW.toISOString(),
      expires_at: null,
      full_name: "Alice Example",
      birthdate: "1999-01-01",
      document_number: "11010519491231002X",
      selfie_url: "https://vendor.example/selfie.jpg",
    });
    await service.handleCallback({ "x-signature": signCallback(SECRET, body, NOW) }, body);
    expect(store.rows).toEqual([
      {
        userId: USER,
        provider: FAKE_PROVIDER,
        providerRef: "fake_ref_0001",
        ageVerified: true,
        realPersonVerified: true,
        verifiedAt: NOW,
        expiresAt: null,
      },
    ]);
  });

  it("records nothing for a pending result", async () => {
    const store = memoryStore();
    const { service } = setup(store);
    const body = JSON.stringify({
      provider_ref: "fake_ref_0002",
      subject: USER,
      status: "pending",
      age_verified: true,
      real_person_verified: true,
      checked_at: NOW.toISOString(),
      expires_at: null,
    });
    expect(
      await service.handleCallback({ "x-signature": signCallback(SECRET, body, NOW) }, body),
    ).toBe("pending");
    expect(store.rows).toEqual([]);
  });
});

describe("failing closed", () => {
  it("answers unavailable when the store fails, and assertEligible throws", async () => {
    const failing: AttestationStore = {
      attestationsFor: () => Promise.reject(new Error("connection refused")),
      record: () => Promise.reject(new Error("connection refused")),
    };
    const { service } = setup(failing);
    expect(await service.eligible(USER)).toEqual({ eligible: false, reason: "unavailable" });
    await expect(service.assertEligible(USER)).rejects.toEqual(new NotEligible("unavailable"));
  });

  it("answers unavailable when the store hangs past the timeout", async () => {
    const hanging: AttestationStore = {
      attestationsFor: () => new Promise(() => undefined),
      record: () => new Promise(() => undefined),
    };
    const { service } = setup(hanging, 20);
    const started = Date.now();
    expect(await service.eligible(USER)).toEqual({ eligible: false, reason: "unavailable" });
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe("the fake provider", () => {
  it.each(["staging", "prod"] as const)("refuses to run in %s", (env) => {
    expect(() => createFakeIdentityProvider({ env, secret: SECRET })).toThrow(/must not run/);
  });

  it("runs in dev and test", () => {
    expect(createFakeIdentityProvider({ env: "dev", secret: SECRET }).name).toBe(FAKE_PROVIDER);
  });
});

describe("verifyCallbackSignature", () => {
  it("accepts a fresh signature within the tolerance on either side", () => {
    const body = "{}";
    for (const offset of [-299_000, 0, 299_000]) {
      const header = signCallback(SECRET, body, new Date(NOW.getTime() + offset));
      expect(() => {
        verifyCallbackSignature(SECRET, header, body, NOW);
      }).not.toThrow();
    }
  });
});
