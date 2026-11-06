// Bundles the service for its image: our code and the workspace packages it
// imports (TypeScript source) go into dist/main.js; npm packages stay
// external and are installed in the image (services/api/Dockerfile).
import { build } from "esbuild";

const externalNpmPackages = {
  name: "external-npm-packages",
  setup(builder) {
    builder.onResolve({ filter: /^[^./]/ }, (args) =>
      args.path.startsWith("@serendipity/") ? undefined : { path: args.path, external: true },
    );
  },
};

await build({
  absWorkingDir: import.meta.dirname,
  entryPoints: ["src/main.ts"],
  outfile: "dist/main.js",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  plugins: [externalNpmPackages],
  logLevel: "warning",
});
