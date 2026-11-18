import { describe, expect, it } from "vitest";

import { createFakePermissions, safely, statusFrom } from "./notifications";

describe("statusFrom", () => {
  it.each([
    [{ granted: true, canAskAgain: true, status: "granted" }, "granted"],
    [{ granted: true, canAskAgain: false, status: "granted" }, "granted"],
    [{ granted: false, canAskAgain: true, status: "undetermined" }, "undetermined"],
    // Never asked, but the system will not show the prompt: treat as refused.
    [{ granted: false, canAskAgain: false, status: "undetermined" }, "denied"],
    [{ granted: false, canAskAgain: true, status: "denied" }, "denied"],
    [{ granted: false, canAskAgain: false, status: "denied" }, "denied"],
    [{ granted: false, canAskAgain: true, status: "something_new" }, "denied"],
  ] as const)("%j → %s", (response, expected) => {
    expect(statusFrom(response)).toBe(expected);
  });
});

describe("safely", () => {
  it("turns a failing call into unavailable", async () => {
    expect(await safely(() => Promise.reject(new Error("no module")))).toBe("unavailable");
  });

  it("turns a throwing call into unavailable", async () => {
    expect(
      await safely(() => {
        throw new Error("sync");
      }),
    ).toBe("unavailable");
  });
});

describe("createFakePermissions", () => {
  it("answers the prompt once and then remembers", async () => {
    const fake = createFakePermissions("undetermined", "denied");
    expect(await fake.request()).toBe("denied");
    expect(await fake.request()).toBe("denied");
    expect(await fake.status()).toBe("denied");
    expect(fake.requests()).toBe(2);
  });
});
