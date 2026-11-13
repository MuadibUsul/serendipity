// Rendering the app in tests (jsdom + react-native-web). Fictional data only.
import type { ColorScheme } from "@serendipity/ui";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Metrics } from "react-native-safe-area-context";

import { MOCK_CODE, createMockApi } from "./api/mock";
import type { MockOptions } from "./api/mock";
import type { Api } from "./api/types";
import { App } from "./App";
import { SIGN_IN } from "./copy";
import { createFakePermissions } from "./platform/notifications";
import type { NotificationPermissions, NotificationStatus } from "./platform/notifications";

export const PHONE = "13800000000";

/** A fixed "now" for tests: 2026-11-12 12:00 in Shanghai, nine days before the mock date. */
export const NOW = new Date("2026-11-12T04:00:00Z");

export const METRICS: Metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

export function renderApp(
  options: {
    readonly api?: Api;
    readonly mock?: MockOptions;
    readonly notifications?: NotificationStatus | NotificationPermissions;
    readonly answer?: "granted" | "denied";
    readonly scheme?: ColorScheme;
    readonly now?: Date;
  } = {},
) {
  const notifications =
    typeof options.notifications === "object"
      ? options.notifications
      : createFakePermissions(options.notifications ?? "undetermined", options.answer);
  const api = options.api ?? createMockApi(options.mock);
  const result = render(
    <App
      api={api}
      notifications={notifications}
      scheme={options.scheme ?? "light"}
      safeAreaMetrics={METRICS}
      now={() => options.now ?? NOW}
    />,
  );
  return { ...result, api, notifications };
}

/** Both sign-in steps: the number and "获取验证码", then the six digits. */
export async function signIn(code = MOCK_CODE, phone = PHONE) {
  fireEvent.change(screen.getByRole("textbox", { name: SIGN_IN.phoneLabel }), {
    target: { value: phone },
  });
  fireEvent.click(screen.getByRole("button", { name: SIGN_IN.sendCode }));
  const field = await screen.findByRole("textbox", { name: SIGN_IN.codeLabel });
  // The sixth digit submits by itself.
  fireEvent.change(field, { target: { value: code } });
}
