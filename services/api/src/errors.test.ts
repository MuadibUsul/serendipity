import { describe, expect, it } from "vitest";

import { PROBLEMS, codeForStatus } from "./errors.js";

describe("codeForStatus", () => {
  it("keeps the general code for a status that more than one code shares", () => {
    expect(PROBLEMS.invalid_code.status).toBe(400);
    expect(codeForStatus(400)).toBe("invalid_request");
  });

  it("maps every other listed status to its code, and falls back by class", () => {
    expect(codeForStatus(401)).toBe("unauthenticated");
    expect(codeForStatus(429)).toBe("rate_limited");
    expect(codeForStatus(418)).toBe("invalid_request");
    expect(codeForStatus(599)).toBe("internal");
  });
});
