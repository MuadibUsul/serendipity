// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createMockApi } from "./api/mock";
import {
  AI_HEADLINES,
  COMMON,
  DATES_PAGE,
  ME_PAGE,
  PRIMER,
  RELATIONSHIPS_PAGE,
  SIGN_IN,
  TAB_LABELS,
} from "./copy";
import { createFakePermissions } from "./platform/notifications";
import { RESEND_AFTER_S, maskPhone } from "./screens/SignInScreen";
import { PHONE, renderApp, signIn } from "./test-support";

afterEach(cleanup);

const type = (label: string, value: string) => {
  fireEvent.change(screen.getByRole("textbox", { name: label }), { target: { value } });
};
const press = (name: string) => {
  fireEvent.click(screen.getByRole("button", { name }));
};

const heading = () => screen.getAllByRole("heading")[0]?.textContent;

describe("sign-in", () => {
  it("starts signed out", () => {
    renderApp();
    expect(heading()).toBe(SIGN_IN.title);
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("refuses a malformed phone number and says why", async () => {
    renderApp();
    type(SIGN_IN.phoneLabel, "12345");
    press(SIGN_IN.sendCode);
    expect(await screen.findByText(SIGN_IN.problems.invalid_phone)).toBeTruthy();
  });

  it("refuses a wrong code and stays on the sign-in screen", async () => {
    renderApp();
    await signIn("123456");
    expect(await screen.findByText(SIGN_IN.problems.invalid_code)).toBeTruthy();
    expect(heading()).toBe(SIGN_IN.title);
  });

  it("reports a failing backend instead of hanging", async () => {
    const api = createMockApi();
    vi.spyOn(api, "signIn").mockRejectedValue(new Error("offline"));
    renderApp({ api });
    await signIn();
    expect(await screen.findByText(SIGN_IN.problems.unavailable)).toBeTruthy();
  });
});

describe("sign-in steps", () => {
  it("asks for the code only once it has been sent, to a masked number", async () => {
    renderApp();
    expect(screen.queryByRole("textbox", { name: SIGN_IN.codeLabel })).toBeNull();
    expect(screen.queryByRole("button", { name: SIGN_IN.submit })).toBeNull();
    type(SIGN_IN.phoneLabel, PHONE);
    press(SIGN_IN.sendCode);
    await screen.findByRole("textbox", { name: SIGN_IN.codeLabel });
    expect(screen.getByText(SIGN_IN.sentTo("138****0000"))).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: SIGN_IN.phoneLabel })).toBeNull();
    expect(screen.getByText(SIGN_IN.resendIn(RESEND_AFTER_S))).toBeTruthy();
    expect(screen.queryByRole("button", { name: SIGN_IN.resend })).toBeNull();
  });

  it("offers a new code only after the wait", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderApp();
      type(SIGN_IN.phoneLabel, PHONE);
      press(SIGN_IN.sendCode);
      await screen.findByRole("textbox", { name: SIGN_IN.codeLabel });
      for (let second = 0; second < RESEND_AFTER_S; second += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1000);
        });
      }
      expect(screen.getByRole("button", { name: SIGN_IN.resend })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("goes back to change the number", async () => {
    renderApp();
    type(SIGN_IN.phoneLabel, PHONE);
    press(SIGN_IN.sendCode);
    await screen.findByRole("textbox", { name: SIGN_IN.codeLabel });
    press(SIGN_IN.changePhone);
    expect(await screen.findByRole("textbox", { name: SIGN_IN.phoneLabel })).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: SIGN_IN.codeLabel })).toBeNull();
  });

  it.each([
    ["13800000000", "138****0000"],
    ["123", "123"],
  ])("masks %s as %s", (phone, masked) => {
    expect(maskPhone(phone)).toBe(masked);
  });
});

describe("notification permission", () => {
  it("explains notifications once, then asks the system when the person allows", async () => {
    const notifications = createFakePermissions("undetermined", "granted");
    renderApp({ notifications });
    await signIn();
    await screen.findByText(PRIMER.title);
    expect(notifications.requests()).toBe(0);
    press(PRIMER.allow);
    await screen.findByText(AI_HEADLINES.new);
    expect(notifications.requests()).toBe(1);
    fireEvent.click(screen.getByRole("tab", { name: TAB_LABELS.me }));
    expect(await screen.findByText(ME_PAGE.notificationStatus.granted)).toBeTruthy();
  });

  it("lets the person decide later without showing the system prompt", async () => {
    const notifications = createFakePermissions("undetermined");
    renderApp({ notifications });
    await signIn();
    await screen.findByText(PRIMER.title);
    press(PRIMER.later);
    await screen.findByText(AI_HEADLINES.new);
    expect(notifications.requests()).toBe(0);
    // …and turn them on from the Me page.
    fireEvent.click(screen.getByRole("tab", { name: TAB_LABELS.me }));
    press(ME_PAGE.enableNotifications);
    expect(await screen.findByText(ME_PAGE.notificationStatus.granted)).toBeTruthy();
    expect(notifications.requests()).toBe(1);
  });

  it("carries on when the person refuses", async () => {
    renderApp({ notifications: "undetermined", answer: "denied" });
    await signIn();
    await screen.findByText(PRIMER.title);
    press(PRIMER.allow);
    await screen.findByText(AI_HEADLINES.new);
    fireEvent.click(screen.getByRole("tab", { name: TAB_LABELS.me }));
    expect(await screen.findByText(ME_PAGE.notificationStatus.denied)).toBeTruthy();
    expect(screen.getByRole("button", { name: ME_PAGE.openSettings })).toBeTruthy();
  });

  it.each(["granted", "denied", "unavailable"] as const)(
    "skips the explainer when the permission is already %s",
    async (status) => {
      renderApp({ notifications: status });
      await signIn();
      await screen.findByText(AI_HEADLINES.new);
      expect(screen.queryByText(PRIMER.title)).toBeNull();
    },
  );
});

describe("the invitation", () => {
  it("shows the date as an invitation, counting days gently, with nothing about the other person", async () => {
    renderApp({ mock: { state: "booked" }, notifications: "granted" });
    await signIn();
    await screen.findByText(AI_HEADLINES.booked);
    fireEvent.click(screen.getByRole("tab", { name: TAB_LABELS.dates }));
    expect(await screen.findByText("15:00")).toBeTruthy();
    expect(screen.getByText("11月21日 周六")).toBeTruthy();
    expect(screen.getByText(DATES_PAGE.countdown(9))).toBeTruthy();
    expect(screen.getByText("¥88.00")).toBeTruthy();
    expect(screen.getByText(DATES_PAGE.hidden)).toBeTruthy();
  });

  it.each([
    [2, "还有 2 天"],
    [1, "明天见"],
    [0, "就在今天"],
    [-1, "已结束"],
  ])("words %i days as %j", (days, text) => {
    expect(DATES_PAGE.countdown(days)).toBe(text);
  });
});

describe("empty pages", () => {
  it("meet the person with a warm line instead of a blank page", async () => {
    renderApp({ notifications: "granted" });
    await signIn();
    await screen.findByText(AI_HEADLINES.new);
    fireEvent.click(screen.getByRole("tab", { name: TAB_LABELS.dates }));
    expect(await screen.findByText(DATES_PAGE.empty)).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: TAB_LABELS.relationships }));
    expect(await screen.findByText(RELATIONSHIPS_PAGE.empty)).toBeTruthy();
  });
});

describe("the four pages", () => {
  it("moves between pages and marks the current tab", async () => {
    renderApp({ notifications: "granted" });
    await signIn();
    await screen.findByText(AI_HEADLINES.new);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(Object.values(TAB_LABELS));
    for (const [key, label] of Object.entries(TAB_LABELS)) {
      fireEvent.click(screen.getByRole("tab", { name: label }));
      const selected = screen
        .getAllByRole("tab")
        .filter((tab) => tab.getAttribute("aria-selected") === "true");
      expect(
        selected.map((tab) => tab.textContent),
        key,
      ).toEqual([label]);
    }
  });

  it("shows a retry when the home data cannot be loaded", async () => {
    const api = createMockApi();
    const home = vi.spyOn(api, "home").mockRejectedValueOnce(new Error("offline"));
    renderApp({ api, notifications: "granted" });
    await signIn();
    fireEvent.click(await screen.findByRole("button", { name: COMMON.retry }));
    await screen.findByText(AI_HEADLINES.new);
    expect(home).toHaveBeenCalledTimes(2);
  });

  it("shows loading again while a retry is on its way", async () => {
    const api = createMockApi();
    let answer: (home: Awaited<ReturnType<typeof api.home>>) => void = () => undefined;
    const real = await api.home({ userId: "mock-0000" });
    vi.spyOn(api, "home")
      .mockRejectedValueOnce(new Error("offline"))
      .mockReturnValueOnce(
        new Promise((resolve) => {
          answer = resolve;
        }),
      );
    renderApp({ api, notifications: "granted" });
    await signIn();
    fireEvent.click(await screen.findByRole("button", { name: COMMON.retry }));
    expect(await screen.findByText(COMMON.loading)).toBeTruthy();
    expect(screen.queryByText(COMMON.loadFailed)).toBeNull();
    await act(async () => {
      answer(real);
      await Promise.resolve();
    });
    expect(await screen.findByText(AI_HEADLINES.new)).toBeTruthy();
  });

  it("pauses and resumes matching from the Me page", async () => {
    renderApp({ notifications: "granted" });
    await signIn();
    await screen.findByText(AI_HEADLINES.new);
    fireEvent.click(screen.getByRole("tab", { name: TAB_LABELS.me }));
    const toggle = screen.getByRole("switch", { name: ME_PAGE.pauseMatching });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    await act(async () => {
      fireEvent.click(toggle);
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(
        screen.getByRole("switch", { name: ME_PAGE.pauseMatching }).getAttribute("aria-checked"),
      ).toBe("true");
    });
  });

  it("signs out back to the sign-in screen", async () => {
    renderApp({ notifications: "granted" });
    await signIn();
    await screen.findByText(AI_HEADLINES.new);
    fireEvent.click(screen.getByRole("tab", { name: TAB_LABELS.me }));
    press(ME_PAGE.signOut);
    expect(await screen.findByText(SIGN_IN.title)).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
  });
});
