import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { contactView, mayWithdraw, parseContact } from "./contact.js";
import type { ContactCard } from "./contact.js";

const mine: ContactCard = { kind: "wechat", value: "me_wx" };
const theirs: ContactCard = { kind: "phone", value: "13800000000" };

describe("contact swap", () => {
  it("shows the other's card only once both have offered", () => {
    expect(contactView(true, null, null)).toEqual({ status: "none" });
    expect(contactView(true, mine, null)).toEqual({ status: "waiting", mine });
    expect(contactView(true, null, theirs)).toEqual({ status: "invited" });
    expect(contactView(true, mine, theirs)).toEqual({ status: "swapped", mine, theirs });
  });

  it("hides everything once chat has closed", () => {
    expect(contactView(false, mine, theirs)).toEqual({ status: "closed" });
  });

  it("never shows the other's card unless the viewer offered theirs and chat is open", () => {
    const card = fc.option(
      fc.record({
        kind: fc.constantFrom("wechat" as const, "phone" as const),
        value: fc.string({ minLength: 1 }),
      }),
      { nil: null },
    );
    fc.assert(
      fc.property(fc.boolean(), card, card, (open, m, t) => {
        const text = JSON.stringify(contactView(open, m, t));
        if (t !== null && !(open && m !== null))
          expect(text).not.toContain(JSON.stringify(t.value));
      }),
    );
  });

  it("lets an offer be withdrawn only before the swap", () => {
    expect(mayWithdraw(mine, null)).toBe(true);
    expect(mayWithdraw(mine, theirs)).toBe(false);
    expect(mayWithdraw(null, theirs)).toBe(false);
  });

  it("accepts one line of a known kind", () => {
    expect(parseContact("wechat", "  me_wx ")).toEqual({
      ok: true,
      card: { kind: "wechat", value: "me_wx" },
    });
    expect(parseContact("email", "a@b")).toMatchObject({ ok: false });
    expect(parseContact("phone", "")).toMatchObject({ ok: false });
    expect(parseContact("other", "a\nb")).toMatchObject({ ok: false });
    expect(parseContact("other", "x".repeat(65))).toMatchObject({ ok: false });
  });
});
