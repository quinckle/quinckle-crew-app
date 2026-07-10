/**
 * Printer service singleton (KOT_PRINTER_PLAN.md Phase 5)
 *
 * Wraps react-native-thermal-printer with:
 *  - scan()        — list available Bluetooth devices
 *  - pair(device)  — connect + save to AsyncStorage
 *  - unpair()      — disconnect + clear AsyncStorage
 *  - printKot(order, isAddOn?) — builds text, sends over BT, returns ack
 *  - printTest()   — known test page for pairing verification
 *  - getStatus()   — 'connected' | 'disconnected' | 'unpaired' | 'error'
 *  - local queue with AsyncStorage persistence (replays on reconnect)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { PermissionsAndroid, Platform } from 'react-native';
import ThermalPrinter from 'react-native-thermal-printer';
import { buildKotText, type KotOrder } from './kotTemplate';
import { buildInvoiceText, type InvoiceBill } from './invoiceTemplate';
import { buildZReportText } from './zReportTemplate';
import type { ZReport } from './api';
import { profileFromWidth, DEFAULT_PAPER_WIDTH, type PaperProfile } from './paperProfile';
import { printerApi } from './api';

// ── Storage keys ──────────────────────────────────────────────────────────────

const KEY_CONFIG = 'printerConfig';
/** Legacy failed-print queue — dead (never flushed); cleared once on init. */
const KEY_QUEUE_LEGACY = 'pendingPrintQueue';
const KEY_ACK_OUTBOX = 'printAckOutbox';
const KEY_UPI_QR = 'printUpiQrOnBill';
const KEY_UPI_QR_MODE = 'printUpiQrMode';

// End-of-ticket paper feed (mm). Drives DantSu's pre-disconnect flush wait so
// long tickets don't lose their tail — see the note in printRaw(). 40mm is a
// safe margin over the 20mm default; lower it if paper waste is a concern and a
// real-hardware test confirms full tickets still print.
const KOT_END_FEED_MM = 40;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BluetoothDevice {
  name: string;
  address: string;
}

export type PrinterStatus = 'connected' | 'disconnected' | 'unpaired' | 'error';

/** How this device reaches the printer. */
export type TransportKind = 'bluetooth' | 'network';

export interface PrinterConfig {
  /** Reach method. Defaults to 'bluetooth' for pre-existing (pre-network) pairings. */
  transport: TransportKind;
  /** Bluetooth MAC address (transport === 'bluetooth'). Empty for network. */
  address: string;
  /** Network printer host (transport === 'network'). */
  ip?: string;
  /** Network printer port. Defaults to 9100 (raw ESC/POS). */
  port?: number;
  name: string;
  /** Nominal roll width in mm — 58/72/80/112 or a custom value. */
  paperWidth: number;
  /** Print-head density. Optional; defaults to 203. */
  dpi?: number;
  pairedAt: string;
}

/** The active paper profile derived from the stored config (or the default). */
function currentProfile(): PaperProfile {
  return profileFromWidth(_config?.paperWidth ?? DEFAULT_PAPER_WIDTH, _config?.dpi);
}

/**
 * A KOT that made it to PAPER but whose "printed" ack hasn't reached the
 * server yet. Persisted so an app restart can never turn a lost ack into a
 * duplicate ticket: the server keeps re-serving the order (kotPrintedAt is
 * still null) and this outbox is what tells us "already printed — just retry
 * the ack". Flushed at the start of every event-driven drain; no timers.
 */
interface AckOutboxEntry {
  /** De-dupe key of the print (orderId:kot / orderId:addon / reprint:{id}:{ts}). */
  key: string;
  orderId: string;
  isAddOn: boolean;
  printedAt: string;
}

// ── Module state ──────────────────────────────────────────────────────────────

let _config: PrinterConfig | null = null;
let _status: PrinterStatus = 'unpaired';
// On-device preference: print the scan-to-pay UPI QR on unpaid bills. Defaults
// ON; a partner whose printer can't render QR can disable it from Printer Settings.
let _printUpiQr = true;
// On-device preference: which QR to print — 'amount' bakes the bill total into
// the intent, 'static' prints the payee-only QR (diner types the amount). This
// is the remembered DEFAULT the per-print picker starts on; defaults to amount.
export type UpiQrMode = 'amount' | 'static';
let _upiQrMode: UpiQrMode = 'amount';

// ── Print de-duplication guard ────────────────────────────────────────────────
// KOT auto-print is driven by TWO independent triggers that can both fire for
// the same order: the live Ably `new_order` push (fast path) and the 15s server
// pull-queue drain (backstop). Without a guard they race and double-print.
//
//  - _inFlight: orders whose printBluetooth() call is currently running. A second
//    trigger for the same key is skipped while the first is in flight.
//  - _recentlyPrinted: keys that printed successfully in the last RECENT_TTL_MS.
//    Closes the window between "print succeeded" and "server stamped kotPrintedAt"
//    — during that gap the pull-queue can still return the order; we skip it.
//
// A FAILED print is removed from both sets immediately so the next poll retries.
const _inFlight = new Set<string>();
const _recentlyPrinted = new Map<string, number>();
const RECENT_TTL_MS = 90_000;

function dedupeKey(orderId: string, isAddOn: boolean): string {
  return `${orderId}:${isAddOn ? 'addon' : 'kot'}`;
}

function purgeExpiredRecent(): void {
  const now = Date.now();
  for (const [key, expiry] of _recentlyPrinted) {
    if (expiry <= now) _recentlyPrinted.delete(key);
  }
}

// ── Init (call on app launch) ─────────────────────────────────────────────────

export async function initPrinter(): Promise<void> {
  // One-time cleanup: the legacy failed-print queue was appended to but never
  // drained (the server pull-queue is the real retry path), so stale entries
  // accumulated forever. Remove the key.
  AsyncStorage.removeItem(KEY_QUEUE_LEGACY).catch(() => {});
  try {
    const raw = await AsyncStorage.getItem(KEY_CONFIG);
    if (raw) {
      _config = JSON.parse(raw) as PrinterConfig;
      // Back-compat: pairings saved before transport existed are Bluetooth.
      if (!_config.transport) _config.transport = 'bluetooth';
      // react-native-thermal-printer has no persistent connection —
      // it connects per-job via printBluetooth(). Mark as 'connected'
      // optimistically; actual errors will surface on first print attempt.
      _status = 'connected';
    }
  } catch {
    _status = 'error';
  }
  try {
    const raw = await AsyncStorage.getItem(KEY_UPI_QR);
    if (raw !== null) _printUpiQr = raw === 'true';
  } catch { /* keep default ON */ }
  try {
    const raw = await AsyncStorage.getItem(KEY_UPI_QR_MODE);
    if (raw === 'static' || raw === 'amount') _upiQrMode = raw;
  } catch { /* keep default 'amount' */ }
}

// ── UPI QR-on-bill preference ─────────────────────────────────────────────────

export function isUpiQrEnabled(): boolean {
  return _printUpiQr;
}

export async function setUpiQrEnabled(enabled: boolean): Promise<void> {
  _printUpiQr = enabled;
  try {
    await AsyncStorage.setItem(KEY_UPI_QR, enabled ? 'true' : 'false');
  } catch { /* non-fatal — in-memory value still applies this session */ }
}

/** Remembered default for the per-print QR picker ('amount' | 'static'). */
export function getUpiQrMode(): UpiQrMode {
  return _upiQrMode;
}

export async function setUpiQrMode(mode: UpiQrMode): Promise<void> {
  _upiQrMode = mode;
  try {
    await AsyncStorage.setItem(KEY_UPI_QR_MODE, mode);
  } catch { /* non-fatal — in-memory value still applies this session */ }
}

// ── Runtime Bluetooth permissions ────────────────────────────────────────────

async function requestBluetoothPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  if ((Platform.Version as number) >= 31) {
    // Android 12+ needs BLUETOOTH_SCAN + BLUETOOTH_CONNECT at runtime
    const results = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    ]);
    return (
      results[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN] === PermissionsAndroid.RESULTS.GRANTED &&
      results[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] === PermissionsAndroid.RESULTS.GRANTED
    );
  } else {
    // Android < 12 needs ACCESS_FINE_LOCATION for BT discovery
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  }
}

// ── scan ──────────────────────────────────────────────────────────────────────

export async function scan(): Promise<BluetoothDevice[]> {
  const hasPermission = await requestBluetoothPermissions();
  if (!hasPermission) throw new Error('BLUETOOTH_PERMISSION_DENIED');

  try {
    // Timeout guard — getBluetoothDeviceList can hang if BT is off or denied
    const devices = await Promise.race([
      (ThermalPrinter as any).getBluetoothDeviceList(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('SCAN_TIMEOUT')), 10_000),
      ),
    ]);
    return (devices as any[]).map((d: any) => ({
      name: d.name ?? d.deviceName ?? 'Unknown',
      address: d.address ?? d.macAddress ?? '',
    }));
  } catch {
    return [];
  }
}

// ── pair ──────────────────────────────────────────────────────────────────────

export async function pair(
  device: BluetoothDevice,
  paperWidth: number = DEFAULT_PAPER_WIDTH,
  opts: { dpi?: number } = {},
): Promise<void> {
  _config = {
    transport: 'bluetooth',
    address: device.address,
    name: device.name,
    paperWidth,
    dpi: opts.dpi,
    pairedAt: new Date().toISOString(),
  };
  await AsyncStorage.setItem(KEY_CONFIG, JSON.stringify(_config));
  // No BT connection step — react-native-thermal-printer connects per print job.
  _status = 'connected';
}

// ── pairNetwork ─────────────────────────────────────────────────────────────
// Pair a LAN/WiFi ESC/POS printer reachable over raw TCP (port 9100). No BT scan
// — the partner enters the printer's IP. Same per-job connect model as Bluetooth.

export async function pairNetwork(
  conn: { ip: string; port?: number; name?: string },
  paperWidth: number = 80,
  opts: { dpi?: number } = {},
): Promise<void> {
  _config = {
    transport: 'network',
    address: '',
    ip: conn.ip,
    port: conn.port ?? 9100,
    name: conn.name || `Network printer (${conn.ip})`,
    paperWidth,
    dpi: opts.dpi,
    pairedAt: new Date().toISOString(),
  };
  await AsyncStorage.setItem(KEY_CONFIG, JSON.stringify(_config));
  _status = 'connected';
}

// ── unpair ────────────────────────────────────────────────────────────────────

export async function unpair(): Promise<void> {
  _config = null;
  _status = 'unpaired';
  await AsyncStorage.removeItem(KEY_CONFIG);
}

// ── getStatus ─────────────────────────────────────────────────────────────────

export function getStatus(): PrinterStatus {
  return _config ? _status : 'unpaired';
}

export function getConfig(): PrinterConfig | null {
  return _config;
}

// ── printRaw ─────────────────────────────────────────────────────────────────
// react-native-thermal-printer connects, prints, then disconnects per call.
// No persistent connection or reconnect step is needed or supported.

async function printRaw(text: string): Promise<void> {
  if (!_config) throw new Error('PRINTER_NOT_PAIRED');
  const profile = currentProfile();
  // DantSu centers images/QR by the PRINTABLE dot-width (printableWidthMM × dpi),
  // while text centers by character count — so both must come from the resolved
  // profile, not the raw roll width. The profile guarantees 58→48mm/32ch and
  // 80→72mm/48ch (byte-identical to the old hard-coded values) and derives any
  // other width the same way.
  const common = {
    payload: text,
    printerDpi: profile.dpi,
    printerWidthMM: profile.printableWidthMM,
    printerNbrCharactersPerLine: profile.charsPerLine,
    autoCut: true,
    // Extra end-of-ticket paper feed. DantSu (the native ESC/POS layer) ties its
    // post-send wait — the pause BEFORE it closes the Bluetooth socket — to this
    // feed length. Omitting it defaults to 20mm, whose wait is too short for a
    // long ticket: the socket closes while the printer is still draining its
    // buffer, so the TAIL (last items + footer) never renders. This is why a big
    // (~6-item) KOT printed only its first few lines. A larger feed buys the
    // flush time so the whole ticket prints. Tune KOT_END_FEED_MM if needed.
    mmFeedPaper: KOT_END_FEED_MM,
  };
  if (_config.transport === 'network') {
    if (!_config.ip) throw new Error('PRINTER_NO_IP');
    await ThermalPrinter.printTcp({ ip: _config.ip, port: _config.port ?? 9100, ...common });
  } else {
    await ThermalPrinter.printBluetooth({ macAddress: _config.address, ...common });
  }
}

// ── printKot ─────────────────────────────────────────────────────────────────

export async function printKot(
  order: KotOrder,
  isAddOn = false,
  opts: { force?: boolean; dedupeKey?: string } = {},
): Promise<'printed' | 'failed' | 'skipped'> {
  // `dedupeKey` lets reprints share ONE key across their two delivery paths
  // (live Ably push + durable pull-queue fallback) so the same reprint request
  // never prints twice, while a NEW request (different requestedAt) still does.
  const key = opts.dedupeKey ?? dedupeKey(order.id, isAddOn);

  // Manual reprints pass force:true and bypass de-dup entirely. Auto-print
  // (Ably push + pull-queue drain) goes through the guard so the same order
  // never prints twice.
  if (!opts.force) {
    if (_inFlight.has(key)) return 'skipped';        // already printing right now
    purgeExpiredRecent();
    if (_recentlyPrinted.has(key)) return 'skipped'; // printed seconds ago
    // Printed on an earlier run but the ack never reached the server (the
    // in-memory guards don't survive an app restart; the durable outbox does).
    // Never put the same ticket on paper again — just retry the ack.
    if (await outboxHasKey(key)) {
      void flushAckOutbox();
      return 'skipped';
    }
    _inFlight.add(key);
  }

  const orderWithFlag = { ...order, isAddOn };
  const text = buildKotText(orderWithFlag, currentProfile());

  try {
    await printRaw(text);
    // Mark as recently printed BEFORE the (async) ack so a drain firing in the
    // gap before the server stamps kotPrintedAt is skipped, not re-printed.
    if (!opts.force) _recentlyPrinted.set(key, Date.now() + RECENT_TTL_MS);
    // Durably record "paper printed, ack pending" BEFORE attempting the ack —
    // if the ack fails and the app restarts, the outbox (not paper) retries.
    await outboxAdd({ key, orderId: order.id, isAddOn, printedAt: new Date().toISOString() });
    try {
      await printerApi.ack(order.id, 'printed', undefined, isAddOn);
      await outboxRemove(key);
    } catch { /* non-fatal — the outbox retries the ack on the next drain */ }
    return 'printed';
  } catch (err: any) {
    const errorMessage = err?.message ?? 'Unknown error';
    // Failed: do NOT mark recently-printed — the server pull-queue must be able
    // to hand this order back for a retry on the next drain.
    try {
      await printerApi.ack(order.id, 'failed', errorMessage, isAddOn);
    } catch { /* non-fatal */ }
    return 'failed';
  } finally {
    if (!opts.force) _inFlight.delete(key);
  }
}

// ── printBill ─────────────────────────────────────────────────────────────────

/**
 * Prints a diner invoice / bill receipt on the locally-paired Bluetooth printer.
 * Unlike printKot (which goes via Ably to the kitchen device), this prints
 * directly from whatever device calls it — intended for the staff/waiter device.
 */
export async function printBill(bill: InvoiceBill): Promise<'printed' | 'failed'> {
  // Honour the on-device QR toggle by dropping the VPA the template gates on.
  const billToPrint = _printUpiQr ? bill : { ...bill, upiVpa: null };
  const text = buildInvoiceText(billToPrint, currentProfile());
  try {
    await printRaw(text);
    return 'printed';
  } catch {
    return 'failed';
  }
}

export async function printZReport(z: ZReport): Promise<'printed' | 'failed'> {
  const text = buildZReportText(z, currentProfile());
  try {
    await printRaw(text);
    return 'printed';
  } catch {
    return 'failed';
  }
}

// ── printTest ─────────────────────────────────────────────────────────────────

export async function printTest(): Promise<'printed' | 'failed'> {
  const now = new Date().toLocaleTimeString('en-IN', { hour12: false });
  const text = [
    '[C]<b><font size="big">QUINCKLE</font></b>',
    '[C]Test Page',
    `[C]${now}`,
    '[C]Printer is working!',
    '[C]<cut/>',
  ].join('\n');

  try {
    await printRaw(text);
    return 'printed';
  } catch {
    return 'failed';
  }
}

// ── Ack outbox persistence ────────────────────────────────────────────────────
// Retention: entries older than 24h are pruned — by then the order has long
// fallen out of the server's 2h pending window, so a dropped ack can no longer
// cause a re-print.

const OUTBOX_MAX_ENTRIES = 100;
const OUTBOX_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function pruneOutbox(entries: AckOutboxEntry[]): AckOutboxEntry[] {
  const cutoff = Date.now() - OUTBOX_MAX_AGE_MS;
  const fresh = entries.filter((e) => {
    const t = Date.parse(e.printedAt);
    return Number.isFinite(t) ? t >= cutoff : false;
  });
  return fresh.slice(-OUTBOX_MAX_ENTRIES);
}

async function outboxRead(): Promise<AckOutboxEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY_ACK_OUTBOX);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function outboxWrite(entries: AckOutboxEntry[]): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_ACK_OUTBOX, JSON.stringify(entries));
  } catch { /* non-fatal — in-memory de-dup still covers this session */ }
}

async function outboxAdd(entry: AckOutboxEntry): Promise<void> {
  const entries = pruneOutbox(await outboxRead());
  if (!entries.some((e) => e.key === entry.key)) {
    entries.push(entry);
    await outboxWrite(entries);
  }
}

async function outboxRemove(key: string): Promise<void> {
  const entries = await outboxRead();
  const next = entries.filter((e) => e.key !== key);
  if (next.length !== entries.length) await outboxWrite(next);
}

async function outboxHasKey(key: string): Promise<boolean> {
  const entries = await outboxRead();
  return entries.some((e) => e.key === key);
}

/**
 * Retry every un-acked "printed" ack. Called at the start of each event-driven
 * drain (and after an outbox hit in printKot) — never on a timer. Returns the
 * entries that STILL couldn't be acked, so callers can avoid re-printing them.
 */
let _outboxFlushing = false;
export async function flushAckOutbox(): Promise<AckOutboxEntry[]> {
  if (_outboxFlushing) return outboxRead();
  _outboxFlushing = true;
  try {
    const entries = pruneOutbox(await outboxRead());
    if (entries.length === 0) {
      await outboxWrite(entries);
      return [];
    }
    const remaining: AckOutboxEntry[] = [];
    for (const entry of entries) {
      try {
        await printerApi.ack(entry.orderId, 'printed', undefined, entry.isAddOn);
      } catch {
        remaining.push(entry);
      }
    }
    await outboxWrite(remaining);
    return remaining;
  } finally {
    _outboxFlushing = false;
  }
}

/**
 * On app launch: if printer is paired, fetch unprinted orders from the last
 * hour and retry any that haven't been acked yet.
 * (Backend filters by kotPrintedAt = null for this restaurant.)
 */
export async function retryUnprintedOnLaunch(
  fetchUnprinted: () => Promise<KotOrder[]>,
): Promise<void> {
  if (!_config) return;
  try {
    const orders = await fetchUnprinted();
    for (const order of orders) {
      await printKot(order, order.isAddOn);
    }
  } catch { /* non-fatal */ }
}
