import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { FAKE_PROVIDER, createFakeIdentityProvider } from "./fake.js";
import { STARTS_PER_DAY, drainVendorDeletions, levelFor, startRefusal } from "./verification.js";
import type { StartFacts, VendorDeletion, VendorDeletionQueue } from "./verification.js";

const ready: StartFacts = {
  accountOpen: true,
  hasBirthDate: true,
  biometricConsent: true,
  startsToday: 0,
  eligibility: { eligible: false, reason: "not_verified" },
};

describe("startRefusal", () => {
  it("starts a check once the birth date and the biometric consent are in", () => {
    expect(startRefusal(ready)).toBeNull();
    expect(startRefusal({ ...ready, hasBirthDate: false })).toBe("no_birth_date");
    expect(startRefusal({ ...ready, biometricConsent: false })).toBe("no_consent");
    expect(startRefusal({ ...ready, accountOpen: false })).toBe("account_closed");
  });

  it("does not run a paid check for someone already eligible", () => {
    expect(startRefusal({ ...ready, eligibility: { eligible: true, until: null } })).toBe(
      "already_verified",
    );
  });

  it(`allows ${String(STARTS_PER_DAY)} checks a day`, () => {
    expect(startRefusal({ ...ready, startsToday: STARTS_PER_DAY - 1 })).toBeNull();
    expect(startRefusal({ ...ready, startsToday: STARTS_PER_DAY })).toBe("daily_limit");
  });

  it("never reaches a vendor without a birth date and the biometric consent", () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        fc.nat(10),
        (accountOpen, hasBirthDate, biometricConsent, startsToday) => {
          const refusal = startRefusal({
            ...ready,
            accountOpen,
            hasBirthDate,
            biometricConsent,
            startsToday,
          });
          if (refusal === null) {
            expect(accountOpen && hasBirthDate && biometricConsent).toBe(true);
            expect(startsToday).toBeLessThan(STARTS_PER_DAY);
          }
        },
      ),
    );
  });
});

describe("levelFor", () => {
  it("asks for an ID check only when tiering requires one", () => {
    expect(levelFor({ eligible: false, reason: "not_verified" })).toBe("liveness");
    expect(levelFor({ eligible: false, reason: "expired" })).toBe("liveness");
    expect(
      levelFor({ eligible: false, reason: "document_required", because: "minor_suspected" }),
    ).toBe("document");
  });
});

function memoryQueue(initial: readonly VendorDeletion[]) {
  const pending = [...initial];
  const done: VendorDeletion[] = [];
  const failed: VendorDeletion[] = [];
  const queue: VendorDeletionQueue = {
    pending: (limit) => Promise.resolve(pending.slice(0, limit)),
    done(deletion) {
      done.push(deletion);
      pending.splice(pending.indexOf(deletion), 1);
      return Promise.resolve();
    },
    failed(deletion) {
      failed.push(deletion);
      return Promise.resolve();
    },
  };
  return { queue, pending, done, failed };
}

describe("drainVendorDeletions", () => {
  const vendor = () => createFakeIdentityProvider({ env: "test", secret: "s".repeat(32) });

  it("asks the vendor to delete, and marks the request done only after it accepted", async () => {
    const fake = vendor();
    const session = await fake.start("00000000-0000-4000-8000-00000000000a", "liveness");
    const memory = memoryQueue([{ provider: FAKE_PROVIDER, providerRef: session.providerRef }]);
    expect(await drainVendorDeletions(memory.queue, [fake])).toEqual({
      done: 1,
      failed: 0,
      skipped: 0,
    });
    expect(fake.wasDeleted(session.providerRef)).toBe(true);
    expect(memory.pending).toEqual([]);
  });

  it("keeps a request queued when the vendor fails, or is not configured here", async () => {
    const memory = memoryQueue([
      { provider: "down", providerRef: "a" },
      { provider: "elsewhere", providerRef: "b" },
    ]);
    const down = { name: "down", deleteData: () => Promise.reject(new Error("timeout")) };
    expect(await drainVendorDeletions(memory.queue, [down])).toEqual({
      done: 0,
      failed: 1,
      skipped: 1,
    });
    expect(memory.done).toEqual([]);
    expect(memory.pending).toHaveLength(2);
  });
});
