import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { withCurrentLifecycles } from "./state-machines.js";

describe("docs/state-machines.md", () => {
  it("shows the lifecycles the code and the database enforce (npm run docs:state-machines)", () => {
    const document = readFileSync(
      new URL("../../../docs/state-machines.md", import.meta.url),
      "utf8",
    );
    expect(document).toBe(withCurrentLifecycles(document));
  });
});
