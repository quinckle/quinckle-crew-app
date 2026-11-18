/**
 * Auto-apply EAS OTA updates in-session — and tell the staff it's happening.
 *
 * Default EAS behaviour (fallbackToCacheTimeout: 0) only APPLIES a downloaded
 * update on the NEXT cold start — so a device that stays running (the crew app's
 * foreground service keeps it alive for background KOT printing) can lag a
 * published update for hours or days. This watcher closes that gap: it checks
 * for a newer update and, if one exists, downloads and reloads into it.
 *
 * What staff see (components/OtaUpdateOverlay.tsx reads `useOtaPhase`):
 *   1. 'downloading' — a full-screen "Updating Quinckle" screen with progress.
 *   2. 'restarting'  — "Almost done", then the native reload screen (same dark
 *      background + orange spinner) covers the moment the old app is torn down,
 *      which used to show as a blank screen.
 *   3. After the new version boots, a short "Updated" toast.
 *
 * Safety — reloads ONLY while the app is foregrounded. A reload restarts the JS
 * bundle, which would abort an in-flight background print; background KOTs run
 * under the foreground service with the screen off, so we never reload unless a
 * human just has the app in front of them. A slow
 * download (bad network) stops blocking the screen after DOWNLOAD_PATIENCE_MS
 * and finishes quietly; the update then lands on the next return to the app.
 * Checking hits Expo's update CDN, not our backend/DB, so it has no bearing on
 * Neon compute.
 */

import { useSyncExternalStore } from 'react';
import * as Updates from 'expo-updates';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { QuinckleColors } from '@/constants/Colors';

export type OtaPhase = 'idle' | 'downloading' | 'restarting';

/** Set just before reloading; the overlay reads it after boot to say "Updated". */
export const JUST_UPDATED_KEY = 'ota:justUpdatedAt';

/** How long the updating screen may block the app before we let staff back in. */
const DOWNLOAD_PATIENCE_MS = 30_000;
/** Long enough to read "Almost done" before the screen changes. */
const RESTART_BEAT_MS = 900;

// ── Phase store (tiny external store so the overlay can subscribe) ─────────────

let phase: OtaPhase = 'idle';
const listeners = new Set<() => void>();

function setPhase(next: OtaPhase) {
  if (phase === next) return;
  phase = next;
  listeners.forEach((l) => l());
}

export function useOtaPhase(): OtaPhase {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => phase,
    () => phase
  );
}

// ── Check → download → restart ────────────────────────────────────────────────

let _busy = false;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Restart into the downloaded update, covering the gap with the native reload screen. */
async function restartIntoUpdate(): Promise<void> {
  setPhase('restarting');
  await sleep(RESTART_BEAT_MS);
  await AsyncStorage.setItem(JUST_UPDATED_KEY, String(Date.now())).catch(() => {});
  try {
    await Updates.reloadAsync({
      reloadScreenOptions: {
        backgroundColor: QuinckleColors.background,
        spinner: { enabled: true, color: QuinckleColors.primary, size: 'large' },
        fade: true,
      },
    });
  } catch {
    // A build without reload-screen support: a plain reload still applies it.
    await Updates.reloadAsync();
  }
}

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
    if (AppState.currentState !== 'active') return;

    setPhase('downloading');
    // Race the download against our patience. If it loses, the download keeps
    // going in the background and is applied on the next foreground instead.
    const outcome = await Promise.race([
      Updates.fetchUpdateAsync().then((r) => (r.isNew ? 'ready' : 'none')),
      sleep(DOWNLOAD_PATIENCE_MS).then(() => 'slow' as const),
    ]);

    // Re-confirm we're still foregrounded before the disruptive reload — the
    // user may have backgrounded the app during the fetch.
    if (outcome === 'ready' && AppState.currentState === 'active') {
      await restartIntoUpdate();
      return;
    }
    setPhase('idle');
  } catch {
    setPhase('idle'); // non-fatal — retried on the next foreground
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
