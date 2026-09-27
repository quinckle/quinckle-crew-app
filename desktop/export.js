#!/usr/bin/env node
/**
 * Export the crew app to web for the Electron shell.
 *
 * Why this exists rather than just setting `web.output` in app.json:
 * runtimeVersion is the FINGERPRINT policy, and the fingerprint covers the app
 * config. Committing `"output": "single"` moves it — measured, not guessed:
 *
 *     app.json as committed  → 1fa004ede6b8ed19149a61a98ad28bd402679013
 *     with output: "single"  → efc884ac71c42d8880811e7b1e446e1761977348
 *
 * A moved runtimeVersion means every crew APK already installed on a device
 * stops matching, and OTA updates silently stop reaching them. The desktop
 * build must not be able to do that to the phones.
 *
 * So the override is applied to app.json for the duration of the export and
 * restored afterwards — including on failure and on Ctrl-C — leaving the file
 * byte-identical, and the fingerprint untouched.
 *
 * The same reasoning is why every desktop script lives in desktop/package.json
 * rather than the app's: package.json is fingerprinted too, so even adding an
 * npm script to it would move runtimeVersion. Measured:
 *
 *     package.json as committed     → a3fc006cafa344f6b24afb554c94d7787858db41
 *     + four desktop:* npm scripts  → 743b3d800e81d8cca286b3f9d2e18c1b55a77fb8
 *
 * ("single" rather than the default "static" because a static export writes one
 * HTML file per route, which hydrates with React #418 mismatches under
 * react-native-web and needs SPA-fallback routing in the shell anyway.)
 */

const path = require('path');
const { spawnSync } = require('child_process');
const { applySingleOutput } = require('./singleOutput');

const APP_ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join('desktop', 'web-build');

// The override, and the guarantee that app.json is restored whatever happens,
// live in singleOutput.js — `npm run live` needs the identical treatment.
const restore = applySingleOutput();

try {
  const result = spawnSync(
    'npx',
    ['expo', 'export', '--platform', 'web', '--output-dir', OUT_DIR],
    { stdio: 'inherit', cwd: APP_ROOT },
  );
  restore();

  if (result.status !== 0) {
    console.error('\n  Web export failed — app.json has been restored.\n');
    process.exit(result.status ?? 1);
  }
} finally {
  restore();
}
