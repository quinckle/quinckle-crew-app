const { withAppBuildGradle } = require('expo/config-plugins');

/**
 * Package only ARM native libraries (every real Android phone) in the APK.
 *
 * `expo-build-properties` → `buildArchs` stops React Native compiling x86/x86_64,
 * but prebuilt .so files inside library AARs (ML Kit, TFLite, Notifee…) still
 * ship all four ABIs unless the app sets ndk.abiFilters. x86 builds only run
 * on emulators and a few Chromebooks, so dropping them removes no features.
 */
const ABIS = '"armeabi-v7a", "arm64-v8a"';

module.exports = function withArmOnlyAbis(config) {
  return withAppBuildGradle(config, (config) => {
    let gradle = config.modResults.contents;
    if (!gradle.includes('// quinckle:arm-only-abis')) {
      gradle = gradle.replace(
        /defaultConfig\s*\{/,
        (m) => `${m}\n        // quinckle:arm-only-abis\n        ndk { abiFilters ${ABIS} }`,
      );
      config.modResults.contents = gradle;
    }
    return config;
  });
};
