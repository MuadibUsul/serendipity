// Rendering the app in tests (jsdom + react-native-web). Fictional data only.
import type { ColorScheme } from "@serendipity/ui";
import { render } from "@testing-library/react";
import type { Metrics } from "react-native-safe-area-context";

import { createMockApi } from "./api/mock";
import type { MockOptions } from "./api/mock";
import type { Api } from "./api/types";
import { App } from "./App";
import { createFakePermissions } from "./platform/notifications";
import type { NotificationPermissions, NotificationStatus } from "./platform/notifications";

export const PHONE = "13800000000";

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
    />,
  );
  return { ...result, api, notifications };
}
