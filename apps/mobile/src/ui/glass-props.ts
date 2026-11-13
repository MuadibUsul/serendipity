import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";

export interface GlassProps {
  /** Floating glass (tab bar, invitation): denser, with a deeper shadow. */
  readonly raised?: boolean;
  readonly radius?: number;
  readonly style?: StyleProp<ViewStyle>;
  readonly children?: ReactNode;
}
