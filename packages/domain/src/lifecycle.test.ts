import { describe, expect, it } from "vitest";

import { IllegalTransition, defineLifecycle } from "./lifecycle.js";

const light = defineLifecycle({
  name: "test.light",
  states: ["off", "on", "broken"],
  initial: "off",
  transitions: { off: ["on", "broken"], on: ["off", "broken"], broken: [] },
});

describe("defineLifecycle", () => {
  it("answers moves from the table", () => {
    expect(light.can("off", "on")).toBe(true);
    expect(light.can("broken", "on")).toBe(false);
    expect(light.can("on", "on")).toBe(false);
    expect(light.isTerminal("broken")).toBe(true);
    expect(light.isTerminal("on")).toBe(false);
    expect(light.edges()).toEqual([
      ["off", "on"],
      ["off", "broken"],
      ["on", "off"],
      ["on", "broken"],
    ]);
  });

  it("names the lifecycle and the move it refuses", () => {
    expect(() => {
      light.assertCan("broken", "on");
    }).toThrow(new IllegalTransition("test.light", "broken", "on"));
    expect(() => {
      light.assertCan("off", "on");
    }).not.toThrow();
  });

  it("refuses a spec with an unknown, missing, looping, repeated or unreachable state", () => {
    const base = { name: "bad", initial: "a" } as const;
    expect(() =>
      defineLifecycle({ ...base, states: ["a", "b"], transitions: { a: ["c" as "b"], b: [] } }),
    ).toThrow(/unknown state c/);
    expect(() =>
      defineLifecycle({ ...base, states: ["a", "b"], transitions: { a: ["b"] } as never }),
    ).toThrow(/no transitions listed for b/);
    expect(() =>
      defineLifecycle({ ...base, states: ["a", "b"], transitions: { a: ["a", "b"], b: [] } }),
    ).toThrow(/a → a/);
    expect(() => defineLifecycle({ ...base, states: ["a", "a"], transitions: { a: [] } })).toThrow(
      /listed twice/,
    );
    expect(() =>
      defineLifecycle({
        ...base,
        states: ["a", "b", "c"],
        transitions: { a: ["b"], b: [], c: [] },
      }),
    ).toThrow(/unreachable from a: c/);
    expect(() =>
      defineLifecycle({
        name: "bad",
        initial: "z" as "a",
        states: ["a"],
        transitions: { a: [] },
      }),
    ).toThrow(/unknown initial state/);
  });
});
