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
import {
  printKot, getStatus as getPrinterStatus, flushAckOutbox, unpair,
  printDispatchedBill, syncLocalPrinters, getPrinters, type LocalPrinter,
} from './printer';
import { printerApi, printersApi, type RegisteredPrinter } from './api';
import { subscribeChannel } from './realtime';
import { invalidateInvoicePrinters, primeInvoicePrinters } from './billPrint';
import { getPrintDeviceId } from './printDevice';

const CHANNEL_ID = 'kot-print-sink';
const NOTIFICATION_ID = 'kot-print-sink';

// Module state — the FGS task and the watcher read these; setters keep them
// fresh from the React layer without the service ever touching React state.
let _restaurantName = '';
let _authed = false;
let _autoPrintEnabled = true;
// Takeaway-only overrides from the Printer screen. Defaults match a backend
// that predates them: takeaway KOTs print, takeaway bills wait for a tap.
let _takeawayKotAutoPrint = true;
let _takeawayInvoiceAutoPrint = false;
let _runnerRegistered = false;
let _serviceRunning = false;

const isAndroid = Platform.OS === 'android';

/** Keep the sink's context fresh (called from the screens / AuthContext). */
export function setSinkContext(opts: {
  restaurantName?: string;
  authed?: boolean;
  autoPrint?: boolean;
  takeawayKot?: boolean;
  takeawayInvoice?: boolean;
}): void {
  if (opts.restaurantName !== undefined) _restaurantName = opts.restaurantName;
  if (opts.authed !== undefined) _authed = opts.authed;
  if (opts.autoPrint !== undefined) _autoPrintEnabled = opts.autoPrint;
  if (opts.takeawayKot !== undefined) _takeawayKotAutoPrint = opts.takeawayKot;
  if (opts.takeawayInvoice !== undefined) _takeawayInvoiceAutoPrint = opts.takeawayInvoice;
}

/**
 * Apply the venue's auto-print toggles from /print/status, or from the
 * kot_autoprint_changed / takeaway_autoprint_changed pushes (their fields are
 * named the same). Fields that are absent keep their last known value, so a
 * transient failure never silently disables printing.
 */
export function applyAutoPrintSettings(data: {
  kotAutoPrint?: unknown;
  takeawayKotAutoPrint?: unknown;
  takeawayInvoiceAutoPrint?: unknown;
} | null | undefined): void {
  if (!data) return;
  if (typeof data.kotAutoPrint === 'boolean') _autoPrintEnabled = data.kotAutoPrint;
  if (typeof data.takeawayKotAutoPrint === 'boolean') _takeawayKotAutoPrint = data.takeawayKotAutoPrint;
  if (typeof data.takeawayInvoiceAutoPrint === 'boolean') _takeawayInvoiceAutoPrint = data.takeawayInvoiceAutoPrint;
}

/**
 * Should a first-print KOT for this channel print without anyone asking?
 * Takeaway follows its own toggle; everything else follows Auto-print KOT.
 * The ONE gate for the live push (both dashboards) and the queue drain.
 */
export function kotAutoPrintFor(channel: string | null | undefined): boolean {
  return channel === 'TAKEAWAY' ? _takeawayKotAutoPrint : _autoPrintEnabled;
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
  // Reconcile which printers are ours BEFORE draining: a device that has just
  // been handed the counter printer should print its queue on this pass, not
  // the next one.
  await refreshLocalPrinters();
  if (getPrinterStatus() !== 'connected') return;

  // Retrying lost acks is always safe and keeps the server queue truthful for
  // the fetch below — do it even when auto-print is toggled off.
  await flushAckOutbox();

  let jobs: Awaited<ReturnType<typeof printerApi.getPending>>['data'] = [];
  let bills: NonNullable<Awaited<ReturnType<typeof printerApi.getPending>>['bills']> = [];
  try {
    const deviceId = await getPrintDeviceId();
    const res = await printerApi.getPending(25, deviceId);
    jobs = res?.data ?? [];
    bills = res?.bills ?? [];
  } catch (err: any) {
    if (typeof err?.message === 'string' && err.message.includes('PRINTER_SINK_MISMATCH')) {
      await handleSinkSuperseded();
    }
    return; // non-fatal — the next event-driven drain retries
  }

  // Bills first: someone is standing at a table waiting for paper, whereas a
  // kitchen ticket is already late by the time a drain is reconciling it.
  // The auto-print toggle does NOT gate these — a bill is a human asking.
  for (const bill of bills) {
    await printDispatchedBill(bill);
  }

  for (const job of jobs) {
    const isReprint = Boolean(job.isReprint);
    if (!isReprint && !kotAutoPrintFor(job.channel)) continue;
    await printKot(
      {
        id: job.id,
        sessionId: job.sessionId ?? undefined,
        orderNumber: job.orderNumber != null ? String(job.orderNumber) : undefined,
        tableNumber: `${String(job.tableNumber ?? '?')}${job.partyGroupLabel ? ` · ${job.partyGroupLabel}` : ''}`,
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
      {
        // The queue addresses ONE printer per job now, so print exactly there
        // rather than fanning out again across everything this device drives.
        printerId: job.printerId,
        ...(isReprint ? { dedupeKey: `reprint:${job.id}:${job.reprintRequestedAt ?? ''}` } : {}),
      },
    );
  }
}

/**
 * Subscribe this device to the two registry events, in ONE place.
 *
 * Deliberately not written inline on each dashboard: the drains were forked per
 * screen once before and drifted, which is why they were consolidated into
 * drainPendingPrintJobs. Both dashboards call this; the work lives here.
 *
 * Returns an unsubscribe function for useEffect cleanup.
 */
export function watchPrintDispatch(restaurantId: string): () => void {
  if (!restaurantId) return () => {};

  const offPrintersChanged = subscribeChannel(
    `partner:${restaurantId}`,
    'printers_changed',
    () => {
      // The invoice-printer picker caches the venue's list; a printer added,
      // re-roled or moved must show up on the very next Print Invoice.
      invalidateInvoicePrinters();
      void refreshLocalPrinters();
    },
  );

  // Another staffer asked for a bill on a printer this device drives. The
  // payload carries the finished bill — nothing is recomputed here.
  const offBillPrint = subscribeChannel(
    `partner:${restaurantId}`,
    'bill_print_request',
    (data: any) => {
      if (!data?.jobId || !data?.bill) return;
      void printDispatchedBill({
        jobId: data.jobId,
        printerId: data.printerId,
        sessionId: data.sessionId,
        bill: data.bill,
      });
    },
  );

  return () => { offPrintersChanged(); offBillPrint(); };
}

/**
 * Re-read the registry and keep only the printers this device drives.
 *
 * Runs on the same events as a drain (mount, foreground, socket reconnect) and
 * whenever the server broadcasts printers_changed. This is what makes moving a
 * printer to another device take effect without anyone reinstalling anything:
 * the old host simply stops finding it here.
 */
export async function refreshLocalPrinters(): Promise<void> {
  let rows: RegisteredPrinter[];
  let deviceId: string;
  try {
    deviceId = await getPrintDeviceId();
    rows = (await printersApi.list())?.data ?? [];
  } catch {
    return; // offline — the cached list keeps printing until the next refresh
  }
  // Same list the invoice picker needs — warm its cache for free, so Print
  // Invoice doesn't have to fetch it at the moment someone is waiting.
  primeInvoicePrinters(rows, deviceId);

  const hostedByUs = rows.filter((r) => r.enabled !== false && r.hostDeviceId === deviceId);

  // Adoption. The migration backfills one Printer row per already-paired venue
  // with NO host, because the paired device's UUID lives in Redis, not
  // Postgres. Whoever holds the legacy pairing claims that row here, on its
  // first drain after the update.
  //
  // Without this a device that paired the old way would sync to an empty list
  // and stop printing the moment it was updated — the rollout hazard this whole
  // path exists to avoid.
  if (hostedByUs.length === 0) {
    const legacy = getPrinters().find((p) => !p.id);
    if (legacy) {
      const unclaimed = rows.filter((r) => r.enabled !== false && !r.hostDeviceId);
      const candidate = unclaimed.find((r) => addressesSamePrinter(r, legacy)) ?? unclaimed[0];
      if (!candidate) {
        // Nothing to adopt. Keep the legacy pairing rather than going silent —
        // a duplicate ticket is recoverable, a kitchen that prints nothing is not.
        return;
      }
      try {
        await printersApi.claimHost(candidate.id, deviceId);
        rows = (await printersApi.list())?.data ?? rows;
      } catch {
        return; // keep the legacy pairing and retry on the next drain
      }
    }
  }

  primeInvoicePrinters(rows, deviceId); // rows may have been re-read after a host claim
  await syncLocalPrinters(rows, deviceId);
}

/** Do a server row and a local pre-registry pairing point at the same hardware? */
function addressesSamePrinter(row: RegisteredPrinter, local: LocalPrinter): boolean {
  const transport = String(row.transport ?? '').toLowerCase();
  if (transport !== local.transport) return false;
  switch (transport) {
    case 'bluetooth': return !!local.address && row.address === local.address;
    case 'network':   return !!local.ip && row.ip === local.ip;
    case 'usb':       return row.usbVendorId === local.usbVendorId
                          && row.usbProductId === local.usbProductId;
    default: return false;
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
    // device holds the printer, and something prints without a tap — a KOT
    // either way, or a takeaway bill the server dispatches on placement.
    const anyAutoPrint = _autoPrintEnabled || _takeawayKotAutoPrint || _takeawayInvoiceAutoPrint;
    const shouldRun = _authed && anyAutoPrint && getPrinterStatus() === 'connected';
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
