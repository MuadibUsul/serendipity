// @vitest-environment jsdom
/**
 * Basic accessibility of every screen the shell can show, in both colour
 * schemes: every control has a name, every page has a heading, rendered text
 * meets WCAG AA contrast against what is actually behind it, and nothing fixes
 * a height that would clip text at a large text size.
 */
import { AA_TEXT, COLOR_SCHEMES, contrastRatio } from "@serendipity/ui";
import type { ColorScheme } from "@serendipity/ui";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createMockApi } from "./api/mock";
import { HOME_STATES } from "./api/types";
import type { HomeState } from "./api/types";
import { AI_HEADLINES, COMMON, PRIMER, SIGN_IN, TAB_LABELS } from "./copy";
import type { NotificationStatus } from "./platform/notifications";
import { TABS } from "./shell/state";
import { renderApp, signIn } from "./test-support";

afterEach(cleanup);

const CONTROL_ROLES = ["button", "tab", "switch", "textbox", "checkbox", "link"] as const;

function rgbToHex(rgb: string): string | undefined {
  const match = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)$/.exec(rgb);
  if (match === null) return undefined;
  if (match[4] !== undefined && Number(match[4]) < 1) return undefined;
  return `#${[match[1], match[2], match[3]]
    .map((part) => Number(part).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** The nearest opaque background behind an element. */
function backgroundOf(element: Element): string | undefined {
  for (let node: Element | null = element; node !== null; node = node.parentElement) {
    const hex = rgbToHex((node as HTMLElement).style.backgroundColor);
    if (hex !== undefined) return hex;
  }
  return undefined;
}

const isDisabled = (element: Element) => element.closest('[aria-disabled="true"]') !== null;

function assertAccessible(where: string) {
  // 1. Every control has an accessible name.
  for (const role of CONTROL_ROLES) {
    const all = screen.queryAllByRole(role);
    const named = screen.queryAllByRole(role, { name: /\S/ });
    expect(named.length, `${where}: every ${role} is named`).toBe(all.length);
  }
  // 2. A heading.
  expect(screen.queryAllByRole("heading").length, `${where}: a heading`).toBeGreaterThan(0);
  // 3. Rendered text contrast (disabled controls are exempt, WCAG 1.4.3).
  const texts = [...document.body.querySelectorAll<HTMLElement>("[dir=auto]")].filter(
    (node) => node.textContent.trim() !== "" && !isDisabled(node),
  );
  expect(texts.length, `${where}: some text`).toBeGreaterThan(0);
  for (const node of texts) {
    const fg = rgbToHex(node.style.color);
    const bg = backgroundOf(node);
    expect(fg, `${where}: "${node.textContent}" has a colour`).toBeDefined();
    expect(bg, `${where}: "${node.textContent}" has a background`).toBeDefined();
    if (fg !== undefined && bg !== undefined) {
      expect(
        contrastRatio(fg, bg),
        `${where}: "${node.textContent}" ${fg} on ${bg}`,
      ).toBeGreaterThanOrEqual(AA_TEXT);
    }
  }
  // 4. No fixed heights around text: it must be free to grow (dynamic type).
  const root = document.body.firstElementChild;
  const holdsText = (node: Element) => node.textContent.trim() !== "";
  for (const node of [...(root?.querySelectorAll<HTMLElement>("*") ?? [])].filter(holdsText)) {
    expect(node.style.height, `${where}: fixed height on <${node.tagName}>`).toBe("");
    expect(node.style.maxHeight, `${where}: max height on <${node.tagName}>`).toBe("");
  }
}

async function reachMain(scheme: ColorScheme, state: HomeState, notifications: NotificationStatus) {
  renderApp({ scheme, mock: { state, verification: "verified" }, notifications });
  await signIn();
  await screen.findByText(AI_HEADLINES[state]);
}

describe.each(COLOR_SCHEMES)("%s scheme", (scheme) => {
  it("sign-in, with an error showing", async () => {
    renderApp({ scheme });
    assertAccessible("sign-in");
    fireEvent.click(screen.getByRole("button", { name: SIGN_IN.sendCode }));
    await screen.findByText(SIGN_IN.problems.invalid_phone);
    assertAccessible("sign-in error");
  });

  it("sign-in, code step", async () => {
    renderApp({ scheme });
    fireEvent.change(screen.getByRole("textbox", { name: SIGN_IN.phoneLabel }), {
      target: { value: "13800000000" },
    });
    fireEvent.click(screen.getByRole("button", { name: SIGN_IN.sendCode }));
    await screen.findByRole("textbox", { name: SIGN_IN.codeLabel });
    assertAccessible("sign-in code step");
  });

  it("notification explainer", async () => {
    renderApp({ scheme, notifications: "undetermined" });
    await signIn();
    await screen.findByText(PRIMER.title);
    assertAccessible("explainer");
  });

  describe.each(HOME_STATES)("account %s", (state) => {
    it.each(TABS)("page %s", async (tab) => {
      await reachMain(scheme, state, "denied");
      fireEvent.click(screen.getByRole("tab", { name: TAB_LABELS[tab] }));
      assertAccessible(`${state}/${tab}`);
    });
  });

  it("loading and failure states", async () => {
    const api = createMockApi();
    vi.spyOn(api, "home").mockRejectedValue(new Error("offline"));
    renderApp({ scheme, api, notifications: "granted" });
    await signIn();
    await screen.findByText(COMMON.loadFailed);
    assertAccessible("failed");
  });
});

describe("the tab bar", () => {
  it("is a tablist of four named tabs, exactly one selected", async () => {
    await reachMain("light", "new", "granted");
    const list = screen.getByRole("tablist");
    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(4);
    for (const tab of tabs) expect(list.contains(tab)).toBe(true);
    expect(tabs.filter((tab) => tab.getAttribute("aria-selected") === "true")).toHaveLength(1);
  });
});
