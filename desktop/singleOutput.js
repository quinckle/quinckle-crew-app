/**
 * Temporarily set `web.output: "single"` in app.json, and put it back — byte for
 * byte — however the process ends.
 *
 * Why this is a runtime override and not a committed setting: see the long
 * comment in export.js. Short version — runtimeVersion is the FINGERPRINT
 * policy and the fingerprint covers app.json, so committing the change would
 * strand every installed crew APK off OTA updates.
 *
 * Used by `npm run export` (seconds) and `npm run live` (a whole dev session).
 * The longer the window, the more the guarantee matters, so it covers a crash,
 * Ctrl-C, SIGTERM and a closed terminal (SIGHUP). It cannot cover SIGKILL or a
 * power cut; if that ever happens `git diff app.json` shows the leftover and
 * `git checkout app.json` clears it.
 */

const fs = require('fs');
const path = require('path');

const APP_JSON = path.join(__dirname, '..', 'app.json');

/** @returns {() => void} restore — idempotent, also runs on process exit. */
function applySingleOutput() {
  const original = fs.readFileSync(APP_JSON); // Buffer — byte-exact restore
  let restored = false;

  function restore() {
    if (restored) return;
    restored = true;
    fs.writeFileSync(APP_JSON, original);
  }

  // Signals become a normal exit so every 'exit' handler runs — this one, and
  // any the caller registered to stop its child processes.
  process.on('exit', restore);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    process.on(sig, () => process.exit(1));
  }

  const config = JSON.parse(original.toString('utf8'));
  config.expo.web = { ...(config.expo.web || {}), output: 'single' };
  fs.writeFileSync(APP_JSON, JSON.stringify(config, null, 2));

  return restore;
}

module.exports = { applySingleOutput };
