import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { eligibility } from "./eligibility.js";
import type { Attestation } from "./eligibility.js";

const NOW = new Date("2026-11-11T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const POLICY = { provider: "vendor", requireRealPerson: true };

const attestation = (overrides: Partial<Attestation> = {}): Attestation => ({
  provider: "vendor",
  providerRef: "ref_0001",
  ageVerified: true,
  realPersonVerified: true,
  verifiedAt: new Date(NOW.getTime() - 10 * DAY),
  expiresAt: new Date(NOW.getTime() + 300 * DAY),
  ...overrides,
});

describe("eligibility", () => {
  it("accepts a current adult, real-person attestation until it expires", () => {
    const a = attestation();
    expect(eligibility([a], NOW, POLICY)).toEqual({ eligible: true, until: a.expiresAt });
    expect(eligibility([attestation({ expiresAt: null })], NOW, POLICY)).toEqual({
      eligible: true,
      until: null,
    });
  });

  it.each<[string, Attestation[], string]>([
    ["nobody checked", [], "not_verified"],
    ["only another provider checked", [attestation({ provider: "fake" })], "not_verified"],
    ["the check found a minor", [attestation({ ageVerified: false })], "age_not_verified"],
    [
      "no real-person check",
      [attestation({ realPersonVerified: false })],
      "real_person_not_verified",
    ],
    ["it expired", [attestation({ expiresAt: new Date(NOW.getTime() - 1) })], "expired"],
    ["it expires right now", [attestation({ expiresAt: NOW })], "expired"],
    [
      "it is dated in the future",
      [attestation({ verifiedAt: new Date(NOW.getTime() + DAY) })],
      "expired",
    ],
  ])("refuses when %s", (_name, attestations, reason) => {
    expect(eligibility(attestations, NOW, POLICY)).toEqual({ eligible: false, reason });
  });

  it("lets a later failed re-check revoke an earlier success", () => {
    const earlier = attestation({ providerRef: "ref_0001" });
    const revoked = attestation({
      providerRef: "ref_0002",
      ageVerified: false,
      verifiedAt: new Date(NOW.getTime() - DAY),
    });
    expect(eligibility([earlier, revoked], NOW, POLICY)).toEqual({
      eligible: false,
      reason: "age_not_verified",
    });
  });

  it("can drop the real-person requirement only by policy", () => {
    expect(
      eligibility([attestation({ realPersonVerified: false })], NOW, {
        ...POLICY,
        requireRealPerson: false,
      }).eligible,
    ).toBe(true);
  });
});

const anyAttestation: fc.Arbitrary<Attestation> = fc.record({
  provider: fc.constantFrom("vendor", "fake", "other"),
  providerRef: fc.stringMatching(/^ref_[0-9]{4}$/),
  ageVerified: fc.boolean(),
  realPersonVerified: fc.boolean(),
  verifiedAt: fc.integer({ min: -400, max: 10 }).map((d) => new Date(NOW.getTime() + d * DAY)),
  expiresAt: fc.option(
    fc.integer({ min: -400, max: 400 }).map((d) => new Date(NOW.getTime() + d * DAY)),
    { nil: null },
  ),
});

describe("eligibility properties", () => {
  it("is never granted without a current adult, real-person attestation from the provider", () => {
    fc.assert(
      fc.property(fc.array(anyAttestation, { maxLength: 6 }), (attestations) => {
        const answer = eligibility(attestations, NOW, POLICY);
        const current = attestations.filter(
          (a) =>
            a.provider === "vendor" &&
            a.verifiedAt.getTime() <= NOW.getTime() &&
            (a.expiresAt === null || a.expiresAt.getTime() > NOW.getTime()),
        );
        if (answer.eligible) {
          const latest = current.reduce((a, b) =>
            b.verifiedAt.getTime() > a.verifiedAt.getTime() ? b : a,
          );
          expect(latest.ageVerified && latest.realPersonVerified).toBe(true);
        }
        if (!current.some((a) => a.ageVerified && a.realPersonVerified)) {
          expect(answer.eligible).toBe(false);
        }
      }),
      { numRuns: 500 },
    );
  });

  it("never counts another provider's attestations", () => {
    fc.assert(
      fc.property(fc.array(anyAttestation, { maxLength: 6 }), (attestations) => {
        const others = attestations.map((a) => ({ ...a, provider: "fake" }));
        expect(eligibility(others, NOW, POLICY)).toEqual({
          eligible: false,
          reason: "not_verified",
        });
      }),
    );
  });
});
