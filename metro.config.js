// Metro config. Previously absent — the Expo defaults were fine.
//
// It exists now for one reason: `.tflite` is not a known asset extension, so
// without this line the face models resolve to nothing at build time and the
// station fails at runtime on a device, not in CI. Bundling is the only way the
// model reaches the APK; fast-tflite loads it through the asset registry.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.assetExts.push('tflite');

module.exports = config;
