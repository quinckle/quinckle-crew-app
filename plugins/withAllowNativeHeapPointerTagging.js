const { withAndroidManifest } = require('expo/config-plugins');

/**
 * Adds android:allowNativeHeapPointerTagging="false" to the <application> element.
 * Required for compatibility with Xiaomi/MediaTek devices that enforce ARM MTE
 * (Memory Tagging Extension), which conflicts with React Native's JSI runtime.
 */
module.exports = function withAllowNativeHeapPointerTagging(config) {
  return withAndroidManifest(config, (config) => {
    const mainApplication = config.modResults.manifest.application?.[0];
    if (mainApplication?.$) {
      mainApplication.$['android:allowNativeHeapPointerTagging'] = 'false';
    }
    return config;
  });
};
