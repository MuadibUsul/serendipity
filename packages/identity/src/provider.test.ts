import { describe, expect, it } from "vitest";

import { CallbackRejected, readResult } from "./provider.js";

const BASE = {
  provider_ref: "vendor_ref_0001",
  subject: "6f1c2b8e-1d2a-4c3b-9e8f-0a1b2c3d4e5f",
  status: "verified",
  age_verified: true,
  real_person_verified: true,
  checked_at: "2026-11-11T00:00:00.000Z",
  expires_at: "2027-11-11T00:00:00.000Z",
};

describe("readResult", () => {
  it("keeps exactly the fields eligibility needs, whatever else the vendor sends", () => {
    const result = readResult({
      ...BASE,
      full_name: "Alice Example",
      birthdate: "1999-01-01",
      document_number: "11010519491231002X",
      selfie_url: "https://vendor.example/selfie.jpg",
    });
    expect(Object.keys(result).sort()).toEqual([
      "ageVerified",
      "checkedAt",
      "expiresAt",
      "providerRef",
      "realPersonVerified",
      "status",
      "subject",
    ]);
    expect(JSON.stringify(result)).not.toMatch(/Alice|1999|11010519|selfie/);
  });

  it.each(["rejected", "pending"])(
    "treats a %s check as proving nothing, whatever its flags",
    (status) => {
      expect(readResult({ ...BASE, status })).toMatchObject({
        status,
        ageVerified: false,
        realPersonVerified: false,
      });
    },
  );

  it.each([
    ["a subject that is not a user id", { subject: "alice@example.com" }],
    ["an unknown status", { status: "approved" }],
    ["flags that are not booleans", { age_verified: "yes" }],
    ["a bad date", { checked_at: "yesterday" }],
    ["an expiry before the check", { expires_at: "2026-01-01T00:00:00.000Z" }],
    ["a short reference", { provider_ref: "x" }],
  ])("refuses %s", (_name, override) => {
    expect(() => readResult({ ...BASE, ...override })).toThrow(CallbackRejected);
  });

  it("accepts an attestation that never expires", () => {
    expect(readResult({ ...BASE, expires_at: null }).expiresAt).toBeNull();
  });
});
