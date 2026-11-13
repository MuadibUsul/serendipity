import Svg, { Circle, Path } from "react-native-svg";

/** A rounded rectangle as a path (shape x/y props are deprecated in react-native-svg). */
function box(x: number, y: number, w: number, h: number, r: number): string {
  return `M${String(x + r)} ${String(y)}h${String(w - 2 * r)}a${String(r)} ${String(r)} 0 0 1 ${String(r)} ${String(r)}v${String(h - 2 * r)}a${String(r)} ${String(r)} 0 0 1 ${String(-r)} ${String(r)}h${String(-(w - 2 * r))}a${String(r)} ${String(r)} 0 0 1 ${String(-r)} ${String(-r)}v${String(-(h - 2 * r))}a${String(r)} ${String(r)} 0 0 1 ${String(r)} ${String(-r)}z`;
}

export const ICONS = [
  "ai",
  "dates",
  "relationships",
  "me",
  "mic",
  "bell",
  "lock",
  "shield",
] as const;
export type IconName = (typeof ICONS)[number];

/** Thin, even line icons (1.6 pt on a 24 pt grid). Decorative: the label next to them names the control. */
export function Icon({
  name,
  color,
  size = 24,
}: {
  readonly name: IconName;
  readonly color: string;
  readonly size?: number;
}) {
  const line = {
    stroke: color,
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    fill: "none",
  };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      {name === "ai" ? (
        <>
          <Path d="M12 3.5l1.7 4.6 4.6 1.7-4.6 1.7L12 16.1l-1.7-4.6-4.6-1.7 4.6-1.7z" {...line} />
          <Path d="M18.5 15.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" {...line} />
        </>
      ) : null}
      {name === "dates" ? (
        <>
          <Path d={box(3.5, 5, 17, 15.5, 4)} {...line} />
          <Path d="M3.5 10h17M8 3v4M16 3v4" {...line} />
          <Circle cx={12} cy={15} r={1.2} fill={color} />
        </>
      ) : null}
      {name === "relationships" ? (
        <>
          <Circle cx={9} cy={12} r={5.5} {...line} />
          <Circle cx={15} cy={12} r={5.5} {...line} />
        </>
      ) : null}
      {name === "me" ? (
        <>
          <Circle cx={12} cy={8.5} r={3.8} {...line} />
          <Path d="M4.5 20c1.3-3.6 4.2-5.4 7.5-5.4s6.2 1.8 7.5 5.4" {...line} />
        </>
      ) : null}
      {name === "mic" ? (
        <>
          <Path d={box(9, 3, 6, 11.5, 3)} {...line} />
          <Path d="M5.5 11.5a6.5 6.5 0 0013 0M12 18v3" {...line} />
        </>
      ) : null}
      {name === "bell" ? (
        <>
          <Path d="M6 16.5V11a6 6 0 0112 0v5.5l1.5 1.5h-15z" {...line} />
          <Path d="M10 20.5a2.2 2.2 0 004 0" {...line} />
        </>
      ) : null}
      {name === "lock" ? (
        <>
          <Path d={box(5, 10.5, 14, 10, 3)} {...line} />
          <Path d="M8.5 10.5V8a3.5 3.5 0 017 0v2.5" {...line} />
        </>
      ) : null}
      {name === "shield" ? (
        <Path d="M12 3.5l7 2.6v5.4c0 4.3-2.9 7.6-7 9-4.1-1.4-7-4.7-7-9V6.1z" {...line} />
      ) : null}
    </Svg>
  );
}
