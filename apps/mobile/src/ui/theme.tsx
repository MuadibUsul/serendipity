import { PALETTES } from "@serendipity/ui";
import type { ColorScheme, Palette } from "@serendipity/ui";
import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import { useColorScheme } from "react-native";

const ThemeContext = createContext<Palette>(PALETTES.light);

/** Follows the system's light or dark setting unless `scheme` is given (tests, previews). */
export function ThemeProvider({
  scheme,
  children,
}: {
  readonly scheme?: ColorScheme;
  readonly children: ReactNode;
}) {
  const system = useColorScheme();
  const chosen: ColorScheme = scheme ?? (system === "dark" ? "dark" : "light");
  return <ThemeContext.Provider value={PALETTES[chosen]}>{children}</ThemeContext.Provider>;
}

export function usePalette(): Palette {
  return useContext(ThemeContext);
}
