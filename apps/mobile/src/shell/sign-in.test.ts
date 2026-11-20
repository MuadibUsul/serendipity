import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { INITIAL_SIGN_IN, RESEND_AFTER_S, canSend, reduceSignIn } from "./sign-in";
import type { SignInEvent, SignInState } from "./sign-in";

const SESSION = { userId: "u-1" };

const run = (events: readonly SignInEvent[], from: SignInState = INITIAL_SIGN_IN) =>
  events.reduce(reduceSignIn, from);

/** On the code step, with a code sent on attempt 1. */
const ON_CODE = run([
  { type: "phone_edited", phone: "4155550123" },
  { type: "send_requested" },
  { type: "code_sent", attempt: 1 },
]);

describe("the happy path", () => {
  it("goes number → code → signed in", () => {
    expect(ON_CODE).toMatchObject({
      step: "code",
      phone: "4155550123",
      code: "",
      wait: RESEND_AFTER_S,
      pending: null,
      attempt: 1,
    });
    const done = run(
      [
        { type: "code_edited", code: "000000" },
        { type: "verify_requested" },
        { type: "signed_in", attempt: 2, session: SESSION },
      ],
      ON_CODE,
    );
    expect(done).toEqual({ step: "signed_in", session: SESSION, attempt: 2 });
  });
});

describe("failures", () => {
  it("says why a number is refused and stays on the number", () => {
    const state = run([
      { type: "phone_edited", phone: "123" },
      { type: "send_requested" },
      { type: "refused", attempt: 1, problem: "invalid_phone" },
    ]);
    expect(state).toMatchObject({ step: "phone", pending: null, problem: "invalid_phone" });
  });

  it("shakes and clears the cells on a wrong code", () => {
    const state = run(
      [
        { type: "code_edited", code: "123456" },
        { type: "verify_requested" },
        { type: "refused", attempt: 2, problem: "invalid_code" },
      ],
      ON_CODE,
    );
    expect(state).toMatchObject({ step: "code", code: "", shakes: 1, problem: "invalid_code" });
  });

  it("reports an unreachable server on either step, and allows trying again", () => {
    const phone = run([{ type: "send_requested" }, { type: "failed", attempt: 1 }]);
    expect(phone).toMatchObject({ step: "phone", pending: null, problem: "unavailable" });
    expect(canSend(phone)).toBe(true);
    const code = run([{ type: "verify_requested" }, { type: "failed", attempt: 2 }], ON_CODE);
    expect(code).toMatchObject({ step: "code", pending: null, problem: "unavailable" });
  });

  it("clears a problem as soon as the person types again", () => {
    const wrong = run(
      [{ type: "verify_requested" }, { type: "refused", attempt: 2, problem: "invalid_code" }],
      ON_CODE,
    );
    expect(run([{ type: "code_edited", code: "1" }], wrong)).toMatchObject({ problem: null });
  });
});

describe("timing", () => {
  it("counts down, then allows a resend that restarts the countdown and clears the code", () => {
    expect(canSend(ON_CODE)).toBe(false);
    const ready = run(
      Array.from({ length: RESEND_AFTER_S + 3 }, () => ({ type: "tick" }) as const),
      ON_CODE,
    );
    expect(ready).toMatchObject({ wait: 0 });
    expect(canSend(ready)).toBe(true);
    const resent = run(
      [
        { type: "code_edited", code: "12" },
        { type: "send_requested" },
        { type: "code_sent", attempt: 2 },
      ],
      ready,
    );
    expect(resent).toMatchObject({ step: "code", code: "", wait: RESEND_AFTER_S });
  });

  it("never sends twice at once, and never verifies while something is in flight", () => {
    const sending = run([{ type: "send_requested" }]);
    expect(run([{ type: "send_requested" }], sending)).toBe(sending);
    const verifying = run([{ type: "verify_requested" }], ON_CODE);
    expect(run([{ type: "verify_requested" }], verifying)).toBe(verifying);
  });
});

describe("late answers", () => {
  it("ignores a code that arrives after the person went back to change the number", () => {
    // "Change" while resending: the old request must not pull them back to the code step.
    const ready = { ...ON_CODE, wait: 0 } as SignInState;
    const back = run([{ type: "send_requested" }, { type: "change_phone" }], ready);
    expect(back).toMatchObject({ step: "phone", pending: null });
    expect(run([{ type: "code_sent", attempt: 2 }], back)).toBe(back);
  });

  it("ignores a sign-in that arrives after the person went back to change the number", () => {
    const back = run([{ type: "verify_requested" }, { type: "change_phone" }], ON_CODE);
    expect(run([{ type: "signed_in", attempt: 2, session: SESSION }], back)).toBe(back);
    expect(run([{ type: "refused", attempt: 2, problem: "invalid_code" }], back)).toBe(back);
  });

  it("never lets a result for another attempt change anything (property)", () => {
    const resultFor = (attempt: number) =>
      fc.constantFrom<SignInEvent>(
        { type: "code_sent", attempt },
        { type: "signed_in", attempt, session: SESSION },
        { type: "refused", attempt, problem: "invalid_code" },
        { type: "failed", attempt },
      );
    const action = fc.constantFrom<SignInEvent>(
      { type: "phone_edited", phone: "4155550123" },
      { type: "send_requested" },
      { type: "code_edited", code: "123456" },
      { type: "verify_requested" },
      { type: "change_phone" },
      { type: "tick" },
    );
    fc.assert(
      fc.property(
        fc.array(action, { maxLength: 12 }),
        fc.integer({ min: 1, max: 5 }),
        (events, skew) => {
          const state = run(events);
          if (state.step === "signed_in") return;
          for (const stale of [state.attempt - skew, state.attempt + skew]) {
            fc.assert(
              fc.property(resultFor(stale), (result) => {
                expect(reduceSignIn(state, result)).toBe(state);
              }),
              { numRuns: 4 },
            );
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("is final once signed in", () => {
    const done = run(
      [{ type: "verify_requested" }, { type: "signed_in", attempt: 2, session: SESSION }],
      ON_CODE,
    );
    for (const event of [
      { type: "change_phone" },
      { type: "send_requested" },
      { type: "failed", attempt: 2 },
      { type: "tick" },
    ] as const) {
      expect(reduceSignIn(done, event)).toBe(done);
    }
  });
});
