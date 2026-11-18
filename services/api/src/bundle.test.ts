// The image installs only the API's own runtime dependencies
// (services/api/Dockerfile, `npm ci --omit=dev --workspace @serendipity/api`).
// Every npm package the bundle leaves external must be one of them, or the
// container fails at startup. Importing a value from a workspace barrel (such
// as `@serendipity/db`, which re-exports the migration runner) is the usual
// way to break this.
import { builtinModules } from "node:module";
import { readFileSync } from "node:fs";

import { build } from "esbuild";
import { describe, expect, it } from "vitest";

// @ts-expect-error -- plain ESM build script, no types
import { buildOptions } from "../build-options.js";

function packageName(path: string): string {
  const parts = path.split("/");
  return path.startsWith("@") ? `${parts[0] ?? ""}/${parts[1] ?? ""}` : (parts[0] ?? "");
}

describe("service bundle", () => {
  it("imports only packages the image installs", async () => {
    const result = await build({
      ...buildOptions,
      write: false,
      metafile: true,
      logLevel: "silent",
    });
    const imported = new Set<string>();
    const outputs = result.metafile?.outputs ?? {};
    expect(Object.keys(outputs)).not.toHaveLength(0);
    for (const output of Object.values(outputs)) {
      for (const entry of output.imports) {
        if (entry.external && !entry.path.startsWith("node:"))
          imported.add(packageName(entry.path));
      }
    }
    const manifest = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { dependencies?: Record<string, string> };
    const installed = new Set([...Object.keys(manifest.dependencies ?? {}), ...builtinModules]);
    expect([...imported].filter((name) => !installed.has(name)).sort()).toEqual([]);
  }, 30_000);
});
