// The esbuild options for the service bundle, shared by build.js and the
// bundle test: our code and the workspace packages it imports (TypeScript
// source) go into dist/main.js; npm packages stay external and are installed
// in the image (services/api/Dockerfile).
const externalNpmPackages = {
  name: "external-npm-packages",
  setup(builder) {
    builder.onResolve({ filter: /^[^./]/ }, (args) =>
      args.path.startsWith("@serendipity/") ? undefined : { path: args.path, external: true },
    );
  },
};

export const buildOptions = {
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
};
