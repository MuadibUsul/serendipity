import { describe, expect, it } from "vitest";

import { MOCK_CODE, createMockApi } from "./mock";
import { HOME_STATES } from "./types";

const PHONE = "13800000000";
const SESSION = { userId: "mock-0000" };

describe("createMockApi", () => {
  it("signs in with the mock code only", async () => {
    const api = createMockApi();
    expect(await api.signIn(PHONE, MOCK_CODE)).toEqual({ ok: true, session: SESSION });
    expect(await api.signIn(PHONE, "123456")).toEqual({ ok: false, problem: "invalid_code" });
    expect(await api.signIn(PHONE, "0000")).toEqual({ ok: false, problem: "invalid_code" });
  });

  it.each(["", "12345", "23800000000", "138000000001", "1380000000a"])(
    "refuses the phone number %j",
    async (phone) => {
      const api = createMockApi();
      expect(await api.requestCode(phone)).toEqual({ ok: false, problem: "invalid_phone" });
      expect(await api.signIn(phone, MOCK_CODE)).toEqual({ ok: false, problem: "invalid_phone" });
    },
  );

  it.each(HOME_STATES)("answers the %s home with matching content", async (state) => {
    const home = await createMockApi({ state }).home(SESSION);
    expect(home.state).toBe(state);
    expect(home.upcoming !== null).toBe(state === "booked");
    expect(home.relationships.length > 0).toBe(state === "in_relationship");
  });

  it("keeps the pause setting", async () => {
    const api = createMockApi();
    expect((await api.setMatchingPaused(SESSION, true)).matchingPaused).toBe(true);
    expect((await api.home(SESSION)).me.matchingPaused).toBe(true);
  });

  it("can be made to fail", async () => {
    await expect(createMockApi({ failHome: true }).home(SESSION)).rejects.toThrow();
  });

  it("never carries anything about the other person in an upcoming date", async () => {
    const { upcoming } = await createMockApi({ state: "booked" }).home(SESSION);
    expect(Object.keys(upcoming ?? {}).sort()).toEqual([
      "amountMinor",
      "cancelRule",
      "currency",
      "id",
      "packageName",
      "startsAt",
      "timeZone",
      "venueAddress",
      "venueName",
    ]);
  });
});
