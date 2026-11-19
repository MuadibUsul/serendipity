import type { ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";

export interface GlassProps {
  /** Floating glass (tab bar, invitation): denser, with a deeper shadow. */
  readonly raised?: boolean;
  /** A faint coral halo underneath: the invitation. */
  readonly halo?: boolean;
  /** A tinted fill instead of the plain glass (the sign-in promises). */
  readonly tint?: string;
  readonly radius?: number;
  readonly style?: StyleProp<ViewStyle>;
  readonly children?: ReactNode;
}
