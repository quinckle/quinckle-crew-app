/**
 * Background KOT print sink — Android foreground service.
 *
 * Problem this solves: React Native suspends the JS runtime when the app is
 * backgrounded or the screen is off, so the live Ably push and the in-screen
 * 15s drain stop running — and a KOT placed during that window only prints when
 * someone wakes the device. A foreground service keeps the process (and the JS
 * runtime) alive with an ongoing notification, so the drain loop below keeps
 * pulling the server's unprinted-order queue and printing even with the screen
 * off.
 *
 * Design:
 *   - registerPrintSinkRunner()  — registers the Notifee FGS task ONCE at app
 *     start. The task runs the drain loop on its own timer (NOT a React
 *     setInterval, which Android throttles in the background).
 *   - startPrintSink() / stopPrintSink() — show / tear down the ongoing
 *     notification, which starts / stops the service.
 *   - The whole thing is driven by a self-contained watcher (see
 *     watchPrintSinkLifecycle) so it has zero coupling to any screen: it starts
 *     when a printer is locally paired AND a crew member is signed in, and stops
 *     otherwise.
 *
 * Safety: printKot() de-dupes, so the FGS drain, the screen drains, and the
 * live Ably push can all run together without ever double-printing an order.
 * Android-only; on iOS every export is a no-op.
 */

import { Platform } from 'react-native';
import notifee, { AndroidImportance, AndroidForegroundServiceType } from '@notifee/react-native';
import { printerApi } from './api';
import { printKot, getStatus as getPrinterStatus } from './printer';

const CHANNEL_ID = 'kot-print-sink';
const NOTIFICATION_ID = 'kot-print-sink';
const DRAIN_INTERVAL_MS = 15_000;

// Module state — the FGS task and the watcher read these; setters keep them
// fresh from the React layer without the service ever touching React state.
let _restaurantName = '';
let _authed = false;
let _autoPrintEnabled = true;
let _runnerRegistered = false;
let _serviceRunning = false;

const isAndroid = Platform.OS === 'android';
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Keep the sink's context fresh (called from the screens / AuthContext). */
export function setSinkContext(opts: {
  restaurantName?: string;
  authed?: boolean;
  autoPrint?: boolean;
}): void {
  if (opts.restaurantName !== undefined) _restaurantName = opts.restaurantName;
  if (opts.authed !== undefined) _authed = opts.authed;
  if (opts.autoPrint !== undefined) _autoPrintEnabled = opts.autoPrint;
}

/**
 * Pull every order the backend still has marked kotPrintedAt=null (last 2h) and
 * print any that slipped past the live push. Shared by the FGS task AND the
 * on-screen drains — printKot de-dupes so overlap is harmless. No-ops unless the
 * auto-print toggle is on and this device holds the Bluetooth pairing.
 */
export async function drainPendingPrintJobs(): Promise<void> {
  if (!_autoPrintEnabled) return;
  if (getPrinterStatus() !== 'connected') return;
  try {
    const res = await printerApi.getPending(25);
    const jobs = res?.data ?? [];
    for (const job of jobs) {
      await printKot(
        {
          id: job.id,
          sessionId: job.sessionId ?? undefined,
          orderNumber: job.orderNumber != null ? String(job.orderNumber) : undefined,
          tableNumber: String(job.tableNumber ?? '?'),
          restaurantName: _restaurantName,
          createdAt: job.createdAt ?? new Date().toISOString(),
          items: (job.items ?? []).map((i) => ({
            name: i.name,
            quantity: i.quantity,
            notes: i.notes ?? undefined,
            modifiersSummary: i.modifiersSummary ?? undefined,
          })),
          isAddOn: Boolean(job.isAddOn),
        },
        Boolean(job.isAddOn),
      );
    }
  } catch {
    /* non-fatal — the next loop tick retries */
  }
}

/**
 * Register the foreground-service task exactly once. MUST be called at module
 * scope on app start (see app/_layout.tsx), not inside a component — Notifee
 * requires the runner to be registered before the app finishes booting so it
 * can be re-attached if Android restarts the service.
 *
 * The returned promise never resolves; it owns the drain loop. When
 * stopForegroundService() is called the task is cancelled and the loop ends.
 */
export function registerPrintSinkRunner(): void {
  if (_runnerRegistered || !isAndroid) return;
  _runnerRegistered = true;
  notifee.registerForegroundService(() => {
    return new Promise<void>(() => {
      // Intentionally never resolves. Drain immediately, then every 15s for as
      // long as the service lives. `stopForegroundService()` tears this down.
      (async () => {
        // small initial delay so a cold start settles (token restore, etc.)
        await sleep(1_000);
        // eslint-disable-next-line no-constant-condition
        while (true) {
          await drainPendingPrintJobs();
          await sleep(DRAIN_INTERVAL_MS);
        }
      })();
    });
  });
}

/** Show the ongoing notification → starts the foreground service. Idempotent. */
export async function startPrintSink(): Promise<void> {
  if (!isAndroid || _serviceRunning) return;
  _serviceRunning = true;
  try {
    // Android 13+ (API 33) requires POST_NOTIFICATIONS to be granted at runtime
    // before any notification (including the FGS ongoing chip) can be shown.
    // Request it here so the service can start; if already granted this is a no-op.
    const settings = await notifee.requestPermission();
    if (!settings.authorizationStatus) {
      // Permission denied — can't show the notification, so can't run the FGS.
      _serviceRunning = false;
      return;
    }

    await notifee.createChannel({
      id: CHANNEL_ID,
      name: 'KOT printing',
      description: 'Keeps the kitchen printer ready while the app is in the background.',
      importance: AndroidImportance.LOW, // silent, no heads-up — it's a status chip
    });
    await notifee.displayNotification({
      id: NOTIFICATION_ID,
      title: 'Quinckle — printer ready',
      body: 'Kitchen tickets will keep printing in the background.',
      android: {
        channelId: CHANNEL_ID,
        asForegroundService: true,
        foregroundServiceTypes: [
          AndroidForegroundServiceType.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE,
        ],
        ongoing: true,
        // Notifee falls back to the app icon if this drawable is absent; the
        // expo-notifications plugin generates `notification_icon`.
        smallIcon: 'notification_icon',
        color: '#F35D3B',
        pressAction: { id: 'default' },
      },
    });
  } catch {
    // If the service couldn't start, reset the flag so the watcher retries.
    _serviceRunning = false;
  }
}

/** Tear down the foreground service + its notification. Idempotent. */
export async function stopPrintSink(): Promise<void> {
  if (!isAndroid || !_serviceRunning) return;
  _serviceRunning = false;
  try {
    await notifee.stopForegroundService();
    await notifee.cancelNotification(NOTIFICATION_ID);
  } catch {
    /* non-fatal */
  }
}

/**
 * Self-contained lifecycle watcher. Start once from app root. Every few seconds
 * it reconciles the service against the desired state: run the FGS only while a
 * crew member is signed in AND this device holds the Bluetooth pairing. Returns
 * a stop function for cleanup.
 */
export function watchPrintSinkLifecycle(): () => void {
  if (!isAndroid) return () => {};
  registerPrintSinkRunner();

  const reconcile = () => {
    // Run the service only when it can actually do something: signed in, this
    // device holds the printer, and auto-print is enabled.
    const shouldRun = _authed && _autoPrintEnabled && getPrinterStatus() === 'connected';
    if (shouldRun && !_serviceRunning) {
      void startPrintSink();
    } else if (!shouldRun && _serviceRunning) {
      void stopPrintSink();
    }
  };

  reconcile();
  const timer = setInterval(reconcile, 8_000);
  return () => clearInterval(timer);
}
