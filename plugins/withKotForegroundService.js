const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

/**
 * Wires up the Android foreground service used for background KOT printing
 * (see services/printSink.ts). Three things, all required for the service to
 * run without crashing on modern Android:
 *
 *  1. Ensure the foreground-service permissions are declared. On Android 14
 *     (API 34) a typed FGS *requires* both FOREGROUND_SERVICE and the matching
 *     FOREGROUND_SERVICE_CONNECTED_DEVICE permission, plus POST_NOTIFICATIONS
 *     (API 33+) for the ongoing notification.
 *
 *  2. Add `android:foregroundServiceType="connectedDevice"` to Notifee's
 *     service via a manifest-merge entry. Without the type attribute on the
 *     service element, Android 14 throws MissingForegroundServiceTypeException
 *     and the app crashes the moment the service starts. We merge the attribute
 *     onto Notifee's own `app.notifee.core.ForegroundService` rather than
 *     redeclaring the service.
 *
 *  3. Ensure the `tools` namespace exists so `tools:node="merge"` resolves.
 */

const FGS_PERMISSIONS = [
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_CONNECTED_DEVICE',
  'android.permission.POST_NOTIFICATIONS',
];

const NOTIFEE_SERVICE = 'app.notifee.core.ForegroundService';

module.exports = function withKotForegroundService(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;

    // 1) tools namespace
    manifest.$ = manifest.$ || {};
    if (!manifest.$['xmlns:tools']) {
      manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }

    // 2) permissions (idempotent)
    manifest['uses-permission'] = manifest['uses-permission'] || [];
    for (const name of FGS_PERMISSIONS) {
      const exists = manifest['uses-permission'].some(
        (p) => p.$ && p.$['android:name'] === name,
      );
      if (!exists) {
        manifest['uses-permission'].push({ $: { 'android:name': name } });
      }
    }

    // 3) merge foregroundServiceType onto Notifee's service
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(config.modResults);
    application.service = application.service || [];

    let svc = application.service.find(
      (s) => s.$ && s.$['android:name'] === NOTIFEE_SERVICE,
    );
    if (!svc) {
      svc = { $: { 'android:name': NOTIFEE_SERVICE } };
      application.service.push(svc);
    }
    svc.$['android:foregroundServiceType'] = 'connectedDevice';
    svc.$['tools:node'] = 'merge';

    return config;
  });
};
