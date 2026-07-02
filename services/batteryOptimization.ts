/**
 * Battery-optimization onboarding helper (Android only).
 *
 * The single biggest real-world reason KOTs stop printing when the app is
 * closed: aggressive OEM battery managers (Xiaomi/MIUI, Realme/Oppo/ColorOS,
 * Vivo/FuntouchOS, Samsung) kill the app's process — including the foreground
 * service — and can even suppress the silent wake push. Whitelisting the app
 * from battery optimization (and enabling Autostart on those OEMs) keeps the
 * print path alive.
 *
 * There is no Expo API to *read* the optimization status without a native
 * module, so we can only take the user to the right settings screen and let
 * them flip it. The UI (BatteryOptimizationCard) gates this behind a one-time
 * dismissible prompt.
 */

import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as IntentLauncher from 'expo-intent-launcher';
import AsyncStorage from '@react-native-async-storage/async-storage';

const DISMISS_KEY = 'batteryOptPromptDismissed';

export const isAndroid = Platform.OS === 'android';

/** True once the crew has dismissed / handled the battery-optimization prompt. */
export async function isBatteryPromptDismissed(): Promise<boolean> {
  if (!isAndroid) return true;
  try {
    return (await AsyncStorage.getItem(DISMISS_KEY)) === 'true';
  } catch {
    return false;
  }
}

export async function dismissBatteryPrompt(): Promise<void> {
  try {
    await AsyncStorage.setItem(DISMISS_KEY, 'true');
  } catch {
    /* non-fatal */
  }
}

/**
 * Open the system screen where the user can exempt this app from battery
 * optimization. Tries the direct per-app request dialog first, then falls back
 * to the full optimization list, then to the app's details page.
 */
export async function openBatteryOptimizationSettings(): Promise<void> {
  if (!isAndroid) return;
  const pkg =
    (Constants.expoConfig as any)?.android?.package ??
    (Constants as any).manifest?.android?.package ??
    'com.quinckle.crew';
  try {
    // Direct dialog: "Allow <app> to run in the background?" — needs the
    // REQUEST_IGNORE_BATTERY_OPTIMIZATIONS permission (declared in the manifest).
    await IntentLauncher.startActivityAsync(
      'android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
      { data: `package:${pkg}` },
    );
    return;
  } catch {
    /* fall through */
  }
  try {
    // The full list of apps + their optimization state.
    await IntentLauncher.startActivityAsync(
      'android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS',
    );
    return;
  } catch {
    /* fall through */
  }
  try {
    // Last resort: this app's details page (Battery → Unrestricted lives here).
    await IntentLauncher.startActivityAsync(
      'android.settings.APPLICATION_DETAILS_SETTINGS',
      { data: `package:${pkg}` },
    );
  } catch {
    /* give up silently */
  }
}
