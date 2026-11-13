// Metro for the mobile app. Expo's defaults already understand the npm
// workspace; one addition: the shared packages are TypeScript written for
// NodeNext, so they import "./x.js" meaning "./x.ts". For files of this
// repository (never node_modules), such an import is tried without the
// extension first, which finds the .ts source.
const { sep } = require("node:path");

const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const fromRepo = !context.originModulePath.includes(`${sep}node_modules${sep}`);
  if (fromRepo && moduleName.startsWith(".") && moduleName.endsWith(".js")) {
    try {
      return context.resolveRequest(context, moduleName.slice(0, -3), platform);
    } catch {
      // No TypeScript source of that name: resolve the .js as written.
    }
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
