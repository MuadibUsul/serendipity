import { fileURLToPath } from "node:url";

import { configDefaults, defineConfig } from "vitest/config";

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    // Platform files first, as Metro resolves them for the web build.
    extensions: [".web.tsx", ".web.ts", ".web.js", ".tsx", ".ts", ".mjs", ".js", ".json"],
    // The mobile app's components render through react-native-web in tests
    // (files marked `@vitest-environment jsdom`); a device runs the real thing.
    alias: {
      "react-native": "react-native-web",
      // Their CommonJS builds `require` react-native past the alias; use the ES builds.
      "react-native-safe-area-context": fromRoot(
        "node_modules/react-native-safe-area-context/lib/module/index.js",
      ),
      "react-native-svg": fromRoot("node_modules/react-native-svg/lib/module/index.js"),
      "@react-native/assets-registry/registry": fromRoot(
        "apps/mobile/test-stubs/assets-registry.js",
      ),
    },
  },
  test: {
    include: ["{apps,services,packages,tests}/**/*.test.{ts,tsx}"],
    // Suites that need PostgreSQL run with `npm run test:db` (vitest.db.config.ts).
    exclude: [...configDefaults.exclude, "**/*.db.test.ts"],
    environment: "node",
    passWithNoTests: false,
    server: {
      // Transformed by Vite, so the alias above reaches its `react-native` import.
      deps: { inline: ["react-native-safe-area-context", "react-native-svg"] },
    },
  },
});
