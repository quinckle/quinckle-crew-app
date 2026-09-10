/**
 * Auto-apply EAS OTA updates in-session.
 *
 * Default EAS behaviour (fallbackToCacheTimeout: 0) only APPLIES a downloaded
 * update on the NEXT cold start — so a device that stays running (the crew app's
 * foreground service keeps it alive for background KOT printing) can lag a
 * published update for hours or days. This watcher closes that gap: it checks
 * for a newer update and, if one exists, downloads and reloads into it.
 *
 * Safety — reloads ONLY while the app is foregrounded. A reload restarts the JS
 * bundle, which would abort an in-flight background print; background KOTs run
 * under the foreground service with the screen off, so we never reload unless a
 * human just has the app in front of them. Checking hits Expo's update CDN, not
 * our own backend/DB, so it has no bearing on Neon compute.
 */

import * as Updates from 'expo-updates';
import { AppState } from 'react-native';

let _busy = false;

/**
 * Check for a newer update and apply it by reloading, but only when safe.
 * Re-entrancy-guarded and a no-op in dev / Expo Go (Updates.isEnabled === false).
 */
async function checkAndApplyUpdate(): Promise<void> {
  if (!Updates.isEnabled) return;                 // dev client / Expo Go
  if (_busy) return;                              // a check is already running
  if (AppState.currentState !== 'active') return; // never reload in background
  _busy = true;
  try {
    const res = await Updates.checkForUpdateAsync();
    if (!res.isAvailable) return;
    await Updates.fetchUpdateAsync();
    // Re-confirm we're still foregrounded before the disruptive reload — the
    // user may have backgrounded the app during the fetch.
    if (AppState.currentState === 'active') {
      await Updates.reloadAsync();
    }
  } catch {
    /* non-fatal — retried on the next foreground */
  } finally {
    _busy = false;
  }
}

/**
 * Start auto-applying OTA updates: check once now and again on every return to
 * the foreground. Returns a cleanup function. Call once from the app root.
 */
export function watchForOtaUpdates(): () => void {
  void checkAndApplyUpdate();
  const sub = AppState.addEventListener('change', (state) => {
    if (state === 'active') void checkAndApplyUpdate();
  });
  return () => sub.remove();
}
