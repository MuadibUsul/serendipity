import { MATERIALS, PALETTES } from "@serendipity/ui";
import type { ColorScheme, Materials, Palette } from "@serendipity/ui";
import { createContext, useContext } from "react";
import type { ReactNode } from "react";

interface Theme {
  readonly palette: Palette;
  readonly materials: Materials;
}

const ThemeContext = createContext<Theme>({ palette: PALETTES.light, materials: MATERIALS.light });

/** Apple White is the one scheme for now (packages/ui); `scheme` is kept for tests and later schemes. */
export function ThemeProvider({
  scheme = "light",
  children,
}: {
  readonly scheme?: ColorScheme;
  readonly children: ReactNode;
}) {
  return (
    <ThemeContext.Provider value={{ palette: PALETTES[scheme], materials: MATERIALS[scheme] }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function usePalette(): Palette {
  return useContext(ThemeContext).palette;
}

export function useMaterials(): Materials {
  return useContext(ThemeContext).materials;
}
