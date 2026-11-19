import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { MAX_MESSAGE_LENGTH, chatRefusal, parseMessageBody, peerSees } from "./chat.js";
import type { ChatState } from "./chat.js";

const open: ChatState = {
  mutualOptIn: true,
  left: false,
  blocked: false,
  senderStatus: "active",
  peerStatus: "active",
  senderConsent: true,
};

describe("chatRefusal", () => {
  it("lets two people who both said yes write to each other", () => {
    expect(chatRefusal(open)).toBeNull();
  });

  it.each([
    [{ mutualOptIn: false }, "not_mutual"],
    [{ left: true }, "left"],
    [{ blocked: true }, "blocked"],
    [{ senderStatus: "paused" }, "account_inactive"],
    [{ peerStatus: "paused" }, "account_inactive"],
    [{ peerStatus: "suspended" }, "account_inactive"],
    [{ senderConsent: false }, "no_consent"],
  ] as const)("stops new messages when %o", (change, refusal) => {
    expect(chatRefusal({ ...open, ...change })).toBe(refusal);
  });

  it("allows a message only when every condition holds", () => {
    fc.assert(
      fc.property(
        fc.record({
          mutualOptIn: fc.boolean(),
          left: fc.boolean(),
          blocked: fc.boolean(),
          senderStatus: fc.constantFrom("active", "paused", "suspended", "deleted"),
          peerStatus: fc.constantFrom("active", "paused", "suspended", "deleted"),
          senderConsent: fc.boolean(),
        }),
        (state) => {
          const all =
            state.mutualOptIn &&
            !state.left &&
            !state.blocked &&
            state.senderStatus === "active" &&
            state.peerStatus === "active" &&
            state.senderConsent;
          expect(chatRefusal(state) === null).toBe(all);
        },
      ),
    );
  });
});

describe("peerSees", () => {
  it("tells the other person only that chat closed, never why", () => {
    expect(peerSees("left")).toBe("closed");
    expect(peerSees("blocked")).toBe("closed");
    expect(peerSees("account_inactive")).toBe("closed");
    expect(peerSees(null)).toBe("open");
    // A sender without the chat consent is their own business: chat stays open.
    expect(peerSees("no_consent")).toBe("open");
    expect(peerSees("not_mutual")).toBe("not_mutual");
  });
});

describe("parseMessageBody", () => {
  it("trims, drops control characters and keeps line breaks", () => {
    expect(parseMessageBody("  你好\u0007\n明天见  ")).toEqual({ ok: true, body: "你好\n明天见" });
  });

  it("refuses empty, too long and non-text bodies", () => {
    expect(parseMessageBody("   ")).toMatchObject({ ok: false });
    expect(parseMessageBody("a".repeat(MAX_MESSAGE_LENGTH + 1))).toMatchObject({ ok: false });
    expect(parseMessageBody("a".repeat(MAX_MESSAGE_LENGTH))).toMatchObject({ ok: true });
    expect(parseMessageBody(42)).toMatchObject({ ok: false });
  });
});
