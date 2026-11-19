import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { deadlineOf, feedbackView, parseFeedback, submitRefusal } from "./feedback.js";
import type { FeedbackAnswer, FeedbackState } from "./feedback.js";

const ENDED = new Date("2026-11-21T08:30:00Z");
const DURING = new Date(ENDED.getTime() + 60 * 60 * 1000);
const AFTER = deadlineOf(ENDED);
const yes: FeedbackAnswer = { feltSafe: true, comfort: 4, wantsToContinue: true };
const no: FeedbackAnswer = { feltSafe: true, comfort: 2, wantsToContinue: false };
const state = (
  mine: FeedbackAnswer | null,
  theirs: FeedbackAnswer | null,
  dateStatus = "POST_DATE_FEEDBACK",
): FeedbackState => ({
  dateStatus,
  dateEndedAt: ENDED,
  mine,
  theirs,
});

describe("parseFeedback", () => {
  it("accepts the three answers and nothing else", () => {
    expect(parseFeedback({ felt_safe: true, comfort: 4, wants_to_continue: true })).toEqual({
      ok: true,
      answer: yes,
    });
    for (const raw of [
      { felt_safe: true, comfort: 4, wants_to_continue: true, note: "too short" },
      { felt_safe: "yes", comfort: 4, wants_to_continue: true },
      { felt_safe: true, comfort: 6, wants_to_continue: true },
      { felt_safe: true, comfort: 3.5, wants_to_continue: true },
      { felt_safe: true, comfort: 4 },
      null,
      [],
    ]) {
      expect(parseFeedback(raw)).toMatchObject({ ok: false });
    }
  });
});

describe("feedbackView", () => {
  it("asks the person until they answer, with the deadline", () => {
    expect(feedbackView(state(null, null), DURING)).toEqual({
      status: "awaiting_you",
      answer_by: AFTER.toISOString(),
    });
  });

  it("reveals a mutual yes at once", () => {
    expect(feedbackView(state(yes, yes), DURING)).toEqual({ status: "mutual" });
    expect(feedbackView(state(yes, yes, "CLOSED"), AFTER)).toEqual({ status: "mutual" });
  });

  it("never tells a 'no' from no answer", () => {
    expect(feedbackView(state(yes, no), DURING)).toEqual(feedbackView(state(yes, null), DURING));
    expect(feedbackView(state(yes, no), AFTER)).toEqual({ status: "closed" });
    expect(feedbackView(state(yes, null), AFTER)).toEqual({ status: "closed" });
  });

  it("is not open before the date reaches feedback", () => {
    expect(feedbackView(state(null, null, "REVEALED"), DURING)).toEqual({ status: "not_open" });
  });

  const answer = fc.record({
    feltSafe: fc.boolean(),
    comfort: fc.constantFrom(1 as const, 2 as const, 3 as const, 4 as const, 5 as const),
    wantsToContinue: fc.boolean(),
  });
  const status = fc.constantFrom("POST_DATE_FEEDBACK", "CLOSED", "COMPLETED", "REVEALED");
  const moment = fc
    .integer({ min: -2, max: 100 })
    .map((h) => new Date(ENDED.getTime() + h * 3_600_000));

  it("depends on the other's answer only through whether both said yes", () => {
    fc.assert(
      fc.property(
        status,
        fc.option(answer, { nil: null }),
        answer,
        moment,
        (s, mine, theirs, now) => {
          const mutual = mine?.wantsToContinue === true && theirs.wantsToContinue;
          if (!mutual) {
            expect(feedbackView(state(mine, theirs, s), now)).toEqual(
              feedbackView(state(mine, null, s), now),
            );
          } else {
            const started = s === "POST_DATE_FEEDBACK" || s === "CLOSED";
            expect(feedbackView(state(mine, theirs, s), now)).toEqual({
              status: started ? "mutual" : "not_open",
            });
          }
        },
      ),
    );
  });
});

describe("submitRefusal", () => {
  it("lets each person answer once, while the window is open", () => {
    expect(submitRefusal(state(null, yes), DURING)).toBeNull();
    expect(submitRefusal(state(no, null), DURING)).toBe("already_answered");
    expect(submitRefusal(state(null, null), AFTER)).toBe("closed");
    expect(submitRefusal(state(null, null, "CLOSED"), DURING)).toBe("closed");
    expect(submitRefusal(state(null, null, "COMPLETED"), DURING)).toBe("not_open");
    expect(submitRefusal({ ...state(null, null), dateEndedAt: null }, DURING)).toBe("closed");
  });
});
