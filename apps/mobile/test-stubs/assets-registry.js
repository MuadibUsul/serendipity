// Tests only (vitest.config.ts): react-native-svg's web build imports React
// Native's asset registry, which Metro provides at run time. The app's SVGs
// load no image assets, so nothing is ever registered.
export function getAssetByID() {
  return undefined;
}

export function registerAsset() {
  return 0;
}
