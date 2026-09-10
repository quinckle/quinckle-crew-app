const path = require('path');
const fs = require('fs');
const { withAndroidManifest, withDangerousMod, AndroidConfig } = require('expo/config-plugins');

/**
 * Wires up USB (OTG) thermal printing — the `usb` transport in
 * services/printer.ts, backed by the patched printUsb() bridge method
 * (see patches/react-native-thermal-printer+2.3.6.patch).
 *
 * Three things:
 *
 *  1. Declare `android.hardware.usb.host`. Marked NOT required so the app still
 *     installs on phones without OTG — most crew devices print over Bluetooth
 *     and must not be excluded from the Play listing.
 *
 *  2. Ship a `device_filter.xml` matching USB class 7 (the USB printer class).
 *     This is the same filter DantSu's UsbPrintersConnections uses to decide
 *     what counts as a printer, so the two agree on which devices are ours.
 *
 *  3. Add a USB_DEVICE_ATTACHED intent-filter to MainActivity pointing at that
 *     filter. This is what makes the permission grant STICK: on attach Android
 *     offers "always open QuinckleCrew for this device", and accepting it grants
 *     persistent USB access. Without it the crew sees a permission dialog on
 *     every single print — unusable mid-service. The side effect is that
 *     plugging in a printer can foreground the app, which for a POS is fine.
 */

const USB_FEATURE = 'android.hardware.usb.host';
const USB_ATTACHED_ACTION = 'android.hardware.usb.action.USB_DEVICE_ATTACHED';

// USB class 7 = printers. Matches DantSu's own UsbPrintersConnections filter.
const DEVICE_FILTER_XML = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <!-- USB class 7 is the USB printer class. Keep in sync with
         DantSu UsbPrintersConnections, which filters on the same class. -->
    <usb-device class="7" />
</resources>
`;

function withUsbManifest(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;

    // 1) uses-feature (idempotent), not required so non-OTG devices still install
    manifest['uses-feature'] = manifest['uses-feature'] || [];
    const hasFeature = manifest['uses-feature'].some(
      (f) => f.$ && f.$['android:name'] === USB_FEATURE,
    );
    if (!hasFeature) {
      manifest['uses-feature'].push({
        $: { 'android:name': USB_FEATURE, 'android:required': 'false' },
      });
    }

    // 2) USB_DEVICE_ATTACHED intent-filter + device_filter meta-data on MainActivity
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(config.modResults);

    activity['intent-filter'] = activity['intent-filter'] || [];
    const hasAttachFilter = activity['intent-filter'].some((f) =>
      (f.action || []).some((a) => a.$ && a.$['android:name'] === USB_ATTACHED_ACTION),
    );
    if (!hasAttachFilter) {
      activity['intent-filter'].push({
        action: [{ $: { 'android:name': USB_ATTACHED_ACTION } }],
      });
    }

    activity['meta-data'] = activity['meta-data'] || [];
    const hasMeta = activity['meta-data'].some(
      (m) => m.$ && m.$['android:name'] === USB_ATTACHED_ACTION,
    );
    if (!hasMeta) {
      activity['meta-data'].push({
        $: {
          'android:name': USB_ATTACHED_ACTION,
          'android:resource': '@xml/device_filter',
        },
      });
    }

    return config;
  });
}

function withDeviceFilterResource(config) {
  return withDangerousMod(config, [
    'android',
    (config) => {
      const xmlDir = path.join(
        config.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'res',
        'xml',
      );
      fs.mkdirSync(xmlDir, { recursive: true });
      fs.writeFileSync(path.join(xmlDir, 'device_filter.xml'), DEVICE_FILTER_XML);
      return config;
    },
  ]);
}

module.exports = function withUsbPrinter(config) {
  return withDeviceFilterResource(withUsbManifest(config));
};
