/**
 * Background KOT print sink — Android foreground service.
 *
 * Problem this solves: React Native suspends the JS runtime when the app is
 * backgrounded or the screen is off, so the live Ably push stops arriving — and
 * a KOT placed during that window only prints when someone wakes the device. A
 * foreground service keeps the process (and the JS runtime) alive with an
 * ongoing notification, so the Ably realtime socket stays connected and the live
 * KOT push keeps printing even with the screen off.
 *
 * There is NO periodic DB polling. Reconciliation for anything the live push
 * missed is event-driven: drainPendingPrintJobs() runs on screen mount, on
 * return to foreground, and whenever the realtime socket reconnects (exactly
 * when a push could have been missed). This lets the database autosuspend while
 * the restaurant is idle instead of being pinned awake by a 15s poll.
 *
 * Design:
 *   - registerPrintSinkRunner()  — registers the Notifee FGS task ONCE at app
 *     start. The task only keeps the runtime (and socket) alive; it no longer polls.
 *   - startPrintSink() / stopPrintSink() — show / tear down the ongoing
 *     notification, which starts / stops the service.
 *   - The whole thing is driven by a self-contained watcher (see
 *     watchPrintSinkLifecycle) so it has zero coupling to any screen: it starts
 *     when a printer is locally paired AND a crew member is signed in, and stops
 *     otherwise.
 *
 * Safety: printKot() de-dupes, so the event-driven drains and the live Ably
 * push can all run together without ever double-printing an order.
 * Android-only; on iOS every export is a no-op.
 */

import { Platform } from 'react-native';
import notifee, { AndroidImportance, AndroidForegroundServiceType } from '@notifee/react-native';
import { printerApi } from './api';
import { printKot, getStatus as getPrinterStatus, flushAckOutbox, unpair } from './printer';
import { getPrintDeviceId } from './printDevice';

const CHANNEL_ID = 'kot-print-sink';
const NOTIFICATION_ID = 'kot-print-sink';

// Module state — the FGS task and the watcher read these; setters keep them
// fresh from the React layer without the service ever touching React state.
let _restaurantName = '';
let _authed = false;
let _autoPrintEnabled = true;
let _runnerRegistered = false;
let _serviceRunning = false;

const isAndroid = Platform.OS === 'android';

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
 * This device's pairing was superseded (another device paired, or the pairing
 * was cleared remotely). Clear the stale local pairing and tear the FGS down
 * so this device can never dual-print against the new sink — critical for
 * network (tcp://) printers, which any device on the LAN can reach.
 */
export async function handleSinkSuperseded(): Promise<void> {
  try { await unpair(); } catch { /* best-effort */ }
  try { await stopPrintSink(); } catch { /* best-effort */ }
}

/**
 * The ONE shared drain (staff screen, cook screen, and any future wake path all
 * call this — do not fork per-screen copies; they drift).
 *
 * Order of operations:
 *  1. Flush the ack outbox — tickets already on paper whose ack got lost are
 *     acked, never re-printed (survives app restarts).
 *  2. Pull the server queue (first prints + durable reprint fallbacks) with our
 *     deviceId; a 403 PRINTER_SINK_MISMATCH means another device is the sink
 *     now → clear local pairing and stand down.
 *  3. Print: first-print jobs respect the auto-print toggle; reprint jobs are
 *     a manual crew action, so they print regardless of the toggle.
 *
 * Called on events only (screen mount, foreground resume, socket reconnect) —
 * never on a timer. printKot de-dupes so overlapping triggers are harmless.
 */
export async function drainPendingPrintJobs(): Promise<void> {
  if (getPrinterStatus() !== 'connected') return;

  // Retrying lost acks is always safe and keeps the server queue truthful for
  // the fetch below — do it even when auto-print is toggled off.
  await flushAckOutbox();

  let jobs: Awaited<ReturnType<typeof printerApi.getPending>>['data'] = [];
  try {
    const deviceId = await getPrintDeviceId();
    const res = await printerApi.getPending(25, deviceId);
    jobs = res?.data ?? [];
  } catch (err: any) {
    if (typeof err?.message === 'string' && err.message.includes('PRINTER_SINK_MISMATCH')) {
      await handleSinkSuperseded();
    }
    return; // non-fatal — the next event-driven drain retries
  }

  for (const job of jobs) {
    const isReprint = Boolean(job.isReprint);
    if (!isReprint && !_autoPrintEnabled) continue;
    await printKot(
      {
        id: job.id,
        sessionId: job.sessionId ?? undefined,
        orderNumber: job.orderNumber != null ? String(job.orderNumber) : undefined,
        tableNumber: String(job.tableNumber ?? '?'),
        channel: job.channel,
        pickupToken: job.pickupToken ?? undefined,
        sessionRef: job.sessionRef ?? undefined,
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
      // Reprints share one de-dupe key across the Ably push and this fallback,
      // keyed by requestedAt so a NEW reprint request still prints.
      isReprint ? { dedupeKey: `reprint:${job.id}:${job.reprintRequestedAt ?? ''}` } : {},
    );
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
    // The service exists ONLY to keep the JS runtime — and therefore the Ably
    // realtime socket — alive while the app is backgrounded, so the live KOT
    // push keeps printing with the screen off. It does NO periodic DB polling;
    // reconciliation is event-driven (drainPendingPrintJobs runs on mount, on
    // return to foreground, and on socket reconnect — see the crew screens).
    // The promise never resolves; stopForegroundService() tears it down.
    return new Promise<void>(() => {});
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
