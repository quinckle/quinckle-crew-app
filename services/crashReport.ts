/**
 * Crash reporting for the crew app.
 *
 * Every JS error the app cannot handle — a screen that throws while it renders,
 * or an uncaught exception anywhere else — is written to AsyncStorage first and
 * sent to the backend afterwards (`POST /api/crew/client-errors`, which forwards
 * it to the backend's Sentry). Store-then-send because a fatal error on Android
 * kills the process: the write has a chance to land, a network call does not.
 * Whatever did not get out is sent on the next launch, once the crew is signed in.
 *
 * Deliberately no Sentry SDK in the app: adding a dependency to package.json
 * changes the fingerprint and strands every crew APK in the field with no
 * further OTAs (docs/DESKTOP_SHELL.md). This file is JS only.
 *
 * Reports carry the error, the screen and the build — never order, bill or
 * customer data.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Updates from 'expo-updates';
import { AppState, Platform } from 'react-native';
import { API_BASE_URL } from '../constants/env';
import { getCrewToken } from './api';

const STORAGE_KEY = 'quinckle.crashReports';
const MAX_STORED = 10;
const MAX_STACK = 4000;

export type CrashSource = 'render' | 'global';

export interface CrashReport {
  message: string;
  name: string;
  stack?: string;
  source: CrashSource;
  fatal: boolean;
  route?: string;
  occurredAt: string;
  platform: string;
  osVersion: string;
  updateId: string | null;
  runtimeVersion: string | null;
}

let _route: string | undefined;
let _flushing = false;

/** The screen the crew is on, so a report says where it broke. */
export function setCrashRoute(route: string | undefined) { _route = route; }

function toReport(error: unknown, source: CrashSource, fatal: boolean): CrashReport {
  const err = error instanceof Error ? error : new Error(String(error));
  return {
    message: (err.message || 'Unknown error').slice(0, 500),
    name: err.name || 'Error',
    stack: err.stack?.slice(0, MAX_STACK),
    source,
    fatal,
    route: _route,
    occurredAt: new Date().toISOString(),
    platform: Platform.OS,
    osVersion: String(Platform.Version),
    updateId: Updates.updateId ?? null,
    runtimeVersion: Updates.runtimeVersion ?? null,
  };
}

async function readStored(): Promise<CrashReport[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeStored(reports: CrashReport[]) {
  try {
    if (reports.length === 0) await AsyncStorage.removeItem(STORAGE_KEY);
    else await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(reports.slice(-MAX_STORED)));
  } catch { /* storage full or unavailable — nothing more we can do */ }
}

/** Save a crash and try to send it. Never throws. */
export async function recordCrash(error: unknown, source: CrashSource, fatal: boolean): Promise<void> {
  try {
    const report = toReport(error, source, fatal);
    await writeStored([...(await readStored()), report]);
    void flushCrashReports();
  } catch { /* reporting must never cause a second crash */ }
}

/**
 * Send stored reports. Needs a signed-in crew token; without one they wait.
 * Plain fetch rather than api.ts's request(): a 401 here must not log the
 * crew out.
 */
export async function flushCrashReports(): Promise<void> {
  if (_flushing) return;
  const token = getCrewToken();
  if (!token) return;
  _flushing = true;
  try {
    const pending = await readStored();
    if (pending.length === 0) return;
    const left: CrashReport[] = [];
    for (const report of pending) {
      try {
        const res = await fetch(`${API_BASE_URL}/api/crew/client-errors`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(report),
        });
        // A 4xx will never succeed (bad report, old backend) — drop it rather
        // than retry it forever. Keep it on 5xx and network failure.
        if (res.status >= 500) left.push(report);
      } catch {
        left.push(report);
      }
    }
    // A crash recorded during the flush is in storage but not in `pending`.
    const added = (await readStored()).slice(pending.length);
    await writeStored([...left, ...added]);
  } finally {
    _flushing = false;
  }
}

/**
 * Catch uncaught JS errors app-wide, then hand them to React Native's own
 * handler so behaviour (red box in dev, crash in release) is unchanged.
 * Also sends stored reports now and whenever the app comes to the foreground.
 * Call once from the app root; returns a cleanup function.
 */
export function installCrashReporting(): () => void {
  const previous = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    void recordCrash(error, 'global', !!isFatal);
    previous(error, isFatal);
  });

  // The token is restored from SecureStore a moment after launch.
  const timer = setTimeout(() => { void flushCrashReports(); }, 15_000);
  const sub = AppState.addEventListener('change', (state) => {
    if (state === 'active') void flushCrashReports();
  });

  return () => {
    ErrorUtils.setGlobalHandler(previous);
    clearTimeout(timer);
    sub.remove();
  };
}
