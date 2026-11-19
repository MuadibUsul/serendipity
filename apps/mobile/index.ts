// The app's entry point. Everything below App is testable without a device;
// this file only picks the real platform pieces.
import {
  Outfit_200ExtraLight,
  Outfit_300Light,
  Outfit_500Medium,
  useFonts,
} from "@expo-google-fonts/outfit";
import { registerRootComponent } from "expo";
import { createElement } from "react";

import { createHttpAuth } from "./src/api/http";
import { createMockApi } from "./src/api/mock";
import { HOME_STATES } from "./src/api/types";
import { App } from "./src/App";
import { expoNotificationPermissions } from "./src/platform/expo-notifications";

// The mock backend plays the app (ser-p01-06). Which of the four account
// states it plays can be set at build time, e.g.
// EXPO_PUBLIC_MOCK_STATE=booked npx expo start
const requested = process.env.EXPO_PUBLIC_MOCK_STATE;
const state = HOME_STATES.find((name) => name === requested) ?? "new";
// EXPO_PUBLIC_MOCK_LATENCY_MS=1500 slows every answer, to see loading states.
const latencyMs = Number(process.env.EXPO_PUBLIC_MOCK_LATENCY_MS ?? "0") || 0;

const mock = createMockApi({ state, verification: "verified", latencyMs });
// EXPO_PUBLIC_API_URL=http://127.0.0.1:4000 signs in against the dev API
// (its code is always 000000); everything after sign-in is still the mock.
const apiUrl = process.env.EXPO_PUBLIC_API_URL;
const api = apiUrl === undefined || apiUrl === "" ? mock : { ...mock, ...createHttpAuth(apiUrl) };

/**
 * Loads the Outfit faces the type scale names (packages/ui LOADED_FONTS).
 * The app renders at once; text uses the system font until they arrive.
 */
function Root() {
  useFonts({ Outfit_200ExtraLight, Outfit_300Light, Outfit_500Medium });
  return createElement(App, { api, notifications: expoNotificationPermissions });
}

registerRootComponent(Root);
