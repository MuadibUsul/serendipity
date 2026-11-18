/**
 * Rules checked on the source, so a later screen cannot quietly break them:
 * - Text, inputs and anything pressable come only from src/ui, where labels,
 *   touch targets and font scaling are handled once.
 * - Font scaling is never turned off or capped too low (dynamic type).
 * - No screen reads or shows another person's photo, name or profile before a
 *   date (PRD-001 §5.3): the date types have no such fields to begin with.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { MIN_FONT_SCALE_CAP } from "@serendipity/ui";
import { describe, expect, it } from "vitest";

const SRC = fileURLToPath(new URL(".", import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** The source without comments, so prose explaining a rule does not trip it. */
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

const FILES = sources(SRC).map((path) => ({
  path: relative(SRC, path),
  text: code(readFileSync(path, "utf8")),
}));

const RAW_PRIMITIVES = [
  "Text",
  "TextInput",
  "Pressable",
  "Switch",
  "TouchableOpacity",
  "TouchableHighlight",
  "TouchableWithoutFeedback",
  "Button",
];

function reactNativeImports(text: string): string[] {
  return [...text.matchAll(/import\s*\{([^}]*)\}\s*from\s*"react-native"/g)].flatMap((match) =>
    (match[1] ?? "")
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name !== "" && !name.startsWith("type ")),
  );
}

describe("source rules", () => {
  it("finds the sources", () => {
    expect(FILES.length).toBeGreaterThan(10);
  });

  it.each(FILES.filter((file) => !file.path.startsWith("ui")))(
    "$path uses the src/ui primitives, not raw React Native ones",
    ({ text }) => {
      const raw = reactNativeImports(text).filter((name) => RAW_PRIMITIVES.includes(name));
      expect(raw).toEqual([]);
    },
  );

  it.each(FILES)("$path never turns font scaling off or caps it low", ({ text }) => {
    expect(text).not.toMatch(/allowFontScaling\s*=\s*\{\s*false\s*\}/);
    expect(text).not.toMatch(/adjustsFontSizeToFit/);
    for (const match of text.matchAll(/maxFontSizeMultiplier\s*=\s*\{\s*([\d.]+)\s*\}/g)) {
      expect(Number(match[1])).toBeGreaterThanOrEqual(MIN_FONT_SCALE_CAP);
    }
  });

  it.each(FILES)("$path names no photo or profile of another person", ({ text }) => {
    expect(text).not.toMatch(/\b(partner|counterpart|otherUser|candidate)\w*/i);
    expect(text).not.toMatch(/\bphoto(Url|Uri|s)?\b/i);
  });
});
