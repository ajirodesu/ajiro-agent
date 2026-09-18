const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

// Web Preview: expo-sqlite's web worker imports wa-sqlite.wasm, which
// Metro only resolves when registered as an asset extension. Native
// platforms are unaffected (their sqlite implementations never touch it).
config.resolver.assetExts.push("wasm");

module.exports = withNativeWind(config, { input: "./src/app/global.css" });
