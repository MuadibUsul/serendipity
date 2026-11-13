import Svg, { Circle, Path } from "react-native-svg";

import { usePalette } from "./theme";

/**
 * Quiet line drawings for empty states, in the icons' line language with one
 * coral detail. Decorative: the words beside them carry the meaning.
 */
export function Illustration({ name }: { readonly name: "cups" | "threads" }) {
  const palette = usePalette();
  const line = {
    stroke: palette.textSecondary,
    strokeWidth: 1.4,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    fill: "none",
  };
  return (
    <Svg width={168} height={112} viewBox="0 0 168 112" aria-hidden>
      {name === "cups" ? (
        <>
          {/* Two cups at one table, a little steam between them. */}
          <Path d="M30 92h108" {...line} />
          <Path d="M46 58h28v18a12 12 0 01-12 12h-4a12 12 0 01-12-12z" {...line} />
          <Path d="M46 64h-5a6 6 0 000 12h5" {...line} />
          <Path d="M94 58h28v18a12 12 0 01-12 12h-4a12 12 0 01-12-12z" {...line} />
          <Path d="M122 64h5a6 6 0 010 12h-5" {...line} />
          <Path d="M80 46c-4-5 4-9 0-14M88 46c-4-5 4-9 0-14" {...line} />
          <Circle cx={84} cy={22} r={3} fill={palette.accent} />
        </>
      ) : (
        <>
          {/* Two lines that have not met yet, curving toward each other. */}
          <Path d="M18 86c26 0 34-46 62-46" {...line} />
          <Path d="M150 26c-26 0-34 46-62 46" {...line} />
          <Circle cx={84} cy={56} r={3} fill={palette.accent} />
        </>
      )}
    </Svg>
  );
}
