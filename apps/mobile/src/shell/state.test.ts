import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { INITIAL, TABS, reduce } from "./state";
import type { ShellEvent, ShellState } from "./state";

const SESSION = { userId: "user-1" };
const signedIn = (notifications: "undetermined" | "granted" | "denied" | "unavailable") =>
  ({ type: "signed_in", session: SESSION, notifications }) as const;

describe("reduce", () => {
  it("shows the explainer after sign-in while the permission was never asked", () => {
    expect(reduce(INITIAL, signedIn("undetermined"))).toEqual({
      phase: "notification_primer",
      session: SESSION,
    });
  });

  it.each(["granted", "denied", "unavailable"] as const)(
    "goes straight to the AI page when the permission is %s",
    (status) => {
      expect(reduce(INITIAL, signedIn(status))).toEqual({
        phase: "main",
        session: SESSION,
        tab: "ai",
      });
    },
  );

  it("leaves the explainer for the AI page once the person decided", () => {
    const primer = reduce(INITIAL, signedIn("undetermined"));
    expect(reduce(primer, { type: "notifications_decided" })).toEqual({
      phase: "main",
      session: SESSION,
      tab: "ai",
    });
  });

  it("selects tabs only on the main pages", () => {
    const main = reduce(INITIAL, signedIn("granted"));
    expect(reduce(main, { type: "tab_selected", tab: "me" })).toMatchObject({ tab: "me" });
    expect(reduce(INITIAL, { type: "tab_selected", tab: "me" })).toBe(INITIAL);
  });

  it("returns the same object when nothing changes", () => {
    const main = reduce(INITIAL, signedIn("granted"));
    expect(reduce(main, { type: "tab_selected", tab: "ai" })).toBe(main);
    expect(reduce(main, signedIn("granted"))).toBe(main);
    expect(reduce(main, { type: "notifications_decided" })).toBe(main);
  });

  it("signs out from anywhere", () => {
    const primer = reduce(INITIAL, signedIn("undetermined"));
    const main = reduce(INITIAL, signedIn("granted"));
    expect(reduce(primer, { type: "signed_out" })).toEqual(INITIAL);
    expect(reduce(main, { type: "signed_out" })).toEqual(INITIAL);
  });
});

const eventArb: fc.Arbitrary<ShellEvent> = fc.oneof(
  fc
    .constantFrom("undetermined", "granted", "denied", "unavailable" as const)
    .map((status) => signedIn(status)),
  fc.constant({ type: "notifications_decided" } as const),
  fc.constantFrom(...TABS).map((tab) => ({ type: "tab_selected", tab }) as const),
  fc.constant({ type: "signed_out" } as const),
);

describe("reduce, over any sequence of events", () => {
  it("never shows a page without a session, and the explainer only right after sign-in", () => {
    fc.assert(
      fc.property(fc.array(eventArb, { maxLength: 40 }), (events) => {
        let state: ShellState = INITIAL;
        for (const event of events) {
          const previous = state;
          state = reduce(state, event);
          if (state.phase !== "signed_out") expect(state.session).toEqual(SESSION);
          if (state.phase === "notification_primer" && previous.phase !== "notification_primer") {
            expect(previous.phase).toBe("signed_out");
            expect(event).toEqual(signedIn("undetermined"));
          }
          if (state.phase === "main" && previous.phase === "signed_out") {
            expect(event.type).toBe("signed_in");
          }
          if (event.type === "signed_out") expect(state).toEqual(INITIAL);
        }
      }),
    );
  });
});
