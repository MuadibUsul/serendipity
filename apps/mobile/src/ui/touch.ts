import { MIN_TOUCH_TARGET } from "@serendipity/ui";
import { Platform } from "react-native";

/** The smallest size of anything that can be pressed, for this platform. */
export function touchTarget(os: string = Platform.OS): { minHeight: number; minWidth: number } {
  const size =
    os === "android"
      ? MIN_TOUCH_TARGET.android
      : os === "web"
        ? MIN_TOUCH_TARGET.web
        : MIN_TOUCH_TARGET.ios;
  return { minHeight: size, minWidth: size };
}
