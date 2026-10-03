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
import { getPrintDeviceId } from './printDevice';
import {
  isUsbSupported,
  listUsbPrinters,
  printUsb as printOverUsb,
  type UsbPrinterDevice,
} from './usbPrinter';

export { isUsbSupported, listUsbPrinters, type UsbPrinterDevice };

// ── Storage keys ──────────────────────────────────────────────────────────────

const KEY_CONFIG = 'printerConfig';
/** The printers THIS device drives. Supersedes KEY_CONFIG (migrated on init). */
const KEY_PRINTERS = 'printerConfigs';
/** Legacy failed-print queue — dead (never flushed); cleared once on init. */
const KEY_QUEUE_LEGACY = 'pendingPrintQueue';
const KEY_ACK_OUTBOX = 'printAckOutbox';
const KEY_UPI_QR = 'printUpiQrOnBill';
const KEY_UPI_QR_MODE = 'printUpiQrMode';
const KEY_BILL_LOGO = 'printLogoOnBill';

// End-of-ticket paper feed (mm). Drives DantSu's pre-disconnect flush wait so
// long tickets don't lose their tail — see the note in printRaw(). 40mm is a
// safe margin over the 20mm default; lower it if paper waste is a concern and a
// real-hardware test confirms full tickets still print.
const KOT_END_FEED_MM = 40;

// Bills carry images (logo, scan-to-pay QR) that the printer cannot buffer
// whole, so the socket must stay open until the QR and footer have printed —
// 320ms (the KOT wait) cut a 58mm bill off mid-QR.
const BILL_END_WAIT_MS = 2500;

/**
 * mmFeedPaper for a given pre-disconnect wait. DantSu sends the end feed as
 * ESC J (byte)dots but sleeps `dots` ms, so any dots ≡ 64 (mod 256) feeds the
 * same 64 dots (8mm at 203dpi) KOT_END_FEED_MM already does (320 dots) while
 * the wait grows. A plain larger mm would wrap the feed byte instead.
 */
function endFeedMmForWait(waitMs: number, dpi: number): number {
  const dots = 64 + 256 * Math.max(1, Math.ceil((waitMs - 64) / 256));
  return Number(((dots * 25.4) / dpi).toFixed(3));
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BluetoothDevice {
  name: string;
  address: string;
}

export type PrinterStatus = 'connected' | 'disconnected' | 'unpaired' | 'error';

/** How this device reaches the printer. */
export type TransportKind = 'bluetooth' | 'network' | 'usb';

export interface PrinterConfig {
  /** Reach method. Defaults to 'bluetooth' for pre-existing (pre-network) pairings. */
  transport: TransportKind;
  /** Bluetooth MAC address (transport === 'bluetooth'). Empty for network/USB. */
  address: string;
  /** Network printer host (transport === 'network'). */
  ip?: string;
  /** Network printer port. Defaults to 9100 (raw ESC/POS). */
  port?: number;
  /** USB device identity (transport === 'usb'). Survives re-plugging. */
  usbVendorId?: number;
  usbProductId?: number;
  name: string;
  /** Nominal roll width in mm — 58/72/80/112 or a custom value. */
  paperWidth: number;
  /** Print-head density. Optional; defaults to 203. */
  dpi?: number;
  pairedAt: string;
}

/** What a registered printer is allowed to print (mirrors PrinterRole server-side). */
export type PrinterRole = 'KOT' | 'BILL' | 'BOTH';

/**
 * One printer this device drives.
 *
 * The registry lives on the server now, so this is a local CACHE of the rows
 * whose hostDeviceId is us — we keep it because the addressing (MAC, IP, USB
 * ids) is what actually reaches the hardware, and a device must be able to
 * print a queued ticket before it has managed to re-read the registry.
 */
export interface LocalPrinter extends PrinterConfig {
  /** Server Printer.id. Absent only for a pairing made before the registry. */
  id?: string;
  role: PrinterRole;
}

/** The paper profile for a specific printer (58→32ch, 80→48ch, others derived). */
function profileOf(printer: LocalPrinter | null): PaperProfile {
  return profileFromWidth(printer?.paperWidth ?? DEFAULT_PAPER_WIDTH, printer?.dpi);
}

/** Back-compat for device-wide settings (logo sizing, test print). */
function currentProfile(): PaperProfile {
  return profileOf(primaryPrinter());
}

/** First printer, for the settings that are still per-device rather than per-printer. */
function primaryPrinter(): LocalPrinter | null {
  return _printers[0] ?? null;
}

/** Every printer here that prints kitchen tickets. */
export function kotPrinters(): LocalPrinter[] {
  return _printers.filter((p) => p.role === 'KOT' || p.role === 'BOTH');
}

/** Where a bill printed FROM this device goes. */
export function billPrinter(): LocalPrinter | null {
  return _printers.find((p) => p.role === 'BILL' || p.role === 'BOTH') ?? null;
}

export function getPrinters(): LocalPrinter[] {
  return _printers;
}

export function findPrinter(id: string | undefined | null): LocalPrinter | null {
  if (!id) return null;
  return _printers.find((p) => p.id === id) ?? null;
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
  /** Which printer put it on paper — the ack is per printer now. */
  printerId?: string;
}

// ── Module state ──────────────────────────────────────────────────────────────

let _printers: LocalPrinter[] = [];
let _status: PrinterStatus = 'unpaired';
// On-device preference: print the scan-to-pay UPI QR on unpaid bills. Defaults
// ON; a partner whose printer can't render QR can disable it from Printer Settings.
let _printUpiQr = true;
// On-device preference: which QR to print — 'amount' bakes the bill total into
// the intent, 'static' prints the payee-only QR (diner types the amount). This
// is the remembered DEFAULT the per-print picker starts on; defaults to amount.
export type UpiQrMode = 'amount' | 'static';
let _upiQrMode: UpiQrMode = 'amount';

// Venue logo on printed bills. OFF until someone turns it on for this device:
// not every uploaded logo prints well, so it's opt-in per printer station.
let _printBillLogo = false;

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

function dedupeKey(orderId: string, isAddOn: boolean, printerId?: string): string {
  // The printer belongs in the key: the same ticket legitimately prints in the
  // kitchen AND at the bar, but must never print twice on either.
  const base = `${orderId}:${isAddOn ? 'addon' : 'kot'}`;
  return printerId ? `${base}:${printerId}` : base;
}

function purgeExpiredRecent(): void {
  const now = Date.now();
  for (const [key, expiry] of _recentlyPrinted) {
    if (expiry <= now) _recentlyPrinted.delete(key);
  }
}

// ── Local printer list ───────────────────────────────────────────────────────

/** Back-compat for entries written before transport/role existed. */
function normaliseLocal(p: any): LocalPrinter {
  return { ...p, transport: p.transport ?? 'bluetooth', role: p.role ?? 'BOTH' };
}

async function persistPrinters(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY_PRINTERS, JSON.stringify(_printers));
  } catch { /* non-fatal — the in-memory list still prints this session */ }
}

/** Add or replace one local printer, keyed by server id when it has one. */
async function upsertLocal(printer: LocalPrinter): Promise<LocalPrinter> {
  const next = normaliseLocal(printer);
  const at = next.id
    ? _printers.findIndex((p) => p.id === next.id)
    : _printers.findIndex((p) => !p.id && p.transport === next.transport);
  if (at >= 0) _printers[at] = next;
  else _printers.push(next);
  _status = 'connected';
  await persistPrinters();
  return next;
}

/**
 * Reconcile against the server registry: keep exactly the printers whose host
 * is this device. A printer moved to another device disappears from here, which
 * is what stops two devices racing to drive the same hardware.
 *
 * Server rows carry the addressing, so a device that has never paired locally
 * (a fresh install signing in at the counter) still learns how to reach them.
 */
export async function syncLocalPrinters(
  rows: Record<string, any>[],
  myDeviceId: string,
): Promise<LocalPrinter[]> {
  const mine = rows.filter((r) => r.enabled !== false && r.hostDeviceId === myDeviceId);
  _printers = mine.map((r) =>
    normaliseLocal({
      id: r.id,
      role: r.role ?? 'BOTH',
      name: r.name ?? 'Printer',
      transport: (String(r.transport ?? 'BLUETOOTH').toLowerCase()) as TransportKind,
      address: r.address ?? '',
      ip: r.ip ?? undefined,
      port: r.port ?? undefined,
      usbVendorId: r.usbVendorId ?? undefined,
      usbProductId: r.usbProductId ?? undefined,
      paperWidth: r.paperWidth ?? DEFAULT_PAPER_WIDTH,
      dpi: r.dpi ?? undefined,
      pairedAt: r.createdAt ?? new Date().toISOString(),
    }),
  );
  _status = _printers.length > 0 ? 'connected' : 'unpaired';
  await persistPrinters();
  return _printers;
}

/** Forget one printer locally (it was deleted, or handed to another device). */
export async function removeLocalPrinter(id: string): Promise<void> {
  _printers = _printers.filter((p) => p.id !== id);
  if (_printers.length === 0) _status = 'unpaired';
  await persistPrinters();
}

// ── Init (call on app launch) ─────────────────────────────────────────────────

export async function initPrinter(): Promise<void> {
  // One-time cleanup: the legacy failed-print queue was appended to but never
  // drained (the server pull-queue is the real retry path), so stale entries
  // accumulated forever. Remove the key.
  AsyncStorage.removeItem(KEY_QUEUE_LEGACY).catch(() => {});
  try {
    const rawList = await AsyncStorage.getItem(KEY_PRINTERS);
    if (rawList) {
      _printers = (JSON.parse(rawList) as LocalPrinter[]).map(normaliseLocal);
    } else {
      // Migrate the single pre-registry pairing. It printed both KOTs and
      // bills, so BOTH is the only role that preserves this device's behaviour.
      const raw = await AsyncStorage.getItem(KEY_CONFIG);
      if (raw) {
        _printers = [normaliseLocal({ ...(JSON.parse(raw) as PrinterConfig), role: 'BOTH' })];
        await persistPrinters();
      }
    }
    // react-native-thermal-printer has no persistent connection —
    // it connects per-job via printBluetooth(). Mark as 'connected'
    // optimistically; actual errors will surface on first print attempt.
    if (_printers.length > 0) _status = 'connected';
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
  try {
    _printBillLogo = (await AsyncStorage.getItem(KEY_BILL_LOGO)) === 'true';
  } catch { /* keep default OFF */ }
}

// ── Logo-on-bill preference ───────────────────────────────────────────────────

export function isBillLogoEnabled(): boolean {
  return _printBillLogo;
}

export async function setBillLogoEnabled(enabled: boolean): Promise<void> {
  _printBillLogo = enabled;
  // Load it now so the first bill after switching on doesn't wait for it.
  if (enabled) void billLogoFor(currentProfile());
  try {
    await AsyncStorage.setItem(KEY_BILL_LOGO, enabled ? 'true' : 'false');
  } catch { /* non-fatal — in-memory value still applies this session */ }
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
  opts: { dpi?: number; role?: PrinterRole; id?: string } = {},
): Promise<void> {
  await upsertLocal({
    transport: 'bluetooth',
    address: device.address,
    name: device.name,
    paperWidth,
    dpi: opts.dpi,
    pairedAt: new Date().toISOString(),
    role: opts.role ?? 'BOTH',
    id: opts.id,
  });
  // No BT connection step — react-native-thermal-printer connects per print job.
}

// ── pairNetwork ─────────────────────────────────────────────────────────────
// Pair a LAN/WiFi ESC/POS printer reachable over raw TCP (port 9100). No BT scan
// — the partner enters the printer's IP. Same per-job connect model as Bluetooth.

export async function pairNetwork(
  conn: { ip: string; port?: number; name?: string },
  paperWidth: number = 80,
  opts: { dpi?: number; role?: PrinterRole; id?: string } = {},
): Promise<void> {
  await upsertLocal({
    transport: 'network',
    address: '',
    ip: conn.ip,
    port: conn.port ?? 9100,
    name: conn.name || `Network printer (${conn.ip})`,
    paperWidth,
    dpi: opts.dpi,
    pairedAt: new Date().toISOString(),
    role: opts.role ?? 'BOTH',
    id: opts.id,
  });
}

// ── pairUsb ─────────────────────────────────────────────────────────────────
// Pair a printer attached over USB/OTG. Stored by vendor/product id rather than
// by the kernel device path, so unplugging and re-plugging the same printer
// keeps the pairing valid.

export async function pairUsb(
  device: UsbPrinterDevice,
  paperWidth: number = DEFAULT_PAPER_WIDTH,
  opts: { dpi?: number; role?: PrinterRole; id?: string } = {},
): Promise<void> {
  if (!isUsbSupported()) throw new Error('PRINTER_USB_UNSUPPORTED');
  await upsertLocal({
    transport: 'usb',
    address: '',
    usbVendorId: device.vendorId,
    usbProductId: device.productId,
    name: device.deviceName || 'USB printer',
    paperWidth,
    dpi: opts.dpi,
    pairedAt: new Date().toISOString(),
    role: opts.role ?? 'BOTH',
    id: opts.id,
  });
}

// ── unpair ────────────────────────────────────────────────────────────────────

/** Forget every printer this device drives (sink handover, or manual unpair). */
export async function unpair(): Promise<void> {
  _printers = [];
  _status = 'unpaired';
  await AsyncStorage.removeItem(KEY_CONFIG);
  await AsyncStorage.removeItem(KEY_PRINTERS);
}

// ── getStatus ─────────────────────────────────────────────────────────────────

export function getStatus(): PrinterStatus {
  return _printers.length > 0 ? _status : 'unpaired';
}

/** The first local printer. Kept for the per-device settings and test print. */
export function getConfig(): PrinterConfig | null {
  return primaryPrinter();
}

// ── printRaw ─────────────────────────────────────────────────────────────────
// react-native-thermal-printer connects, prints, then disconnects per call.
// No persistent connection or reconnect step is needed or supported.

async function printRaw(
  text: string,
  target?: LocalPrinter | null,
  opts: { endWaitMs?: number } = {},
): Promise<void> {
  const printer = target ?? primaryPrinter();
  if (!printer) throw new Error('PRINTER_NOT_PAIRED');
  const profile = profileOf(printer);
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
    mmFeedPaper: opts.endWaitMs ? endFeedMmForWait(opts.endWaitMs, profile.dpi) : KOT_END_FEED_MM,
  };
  if (printer.transport === 'network') {
    if (!printer.ip) throw new Error('PRINTER_NO_IP');
    await ThermalPrinter.printTcp({ ip: printer.ip, port: printer.port ?? 9100, ...common });
  } else if (printer.transport === 'usb') {
    // A USB pairing can outlive the build that created it — an OTA rollback to
    // a pre-USB APK would leave the config pointing at a bridge method that no
    // longer exists. Fail with a clear code instead of a native crash.
    if (!isUsbSupported()) throw new Error('PRINTER_USB_UNSUPPORTED');
    await printOverUsb({
      vendorId: printer.usbVendorId ?? 0,
      productId: printer.usbProductId ?? 0,
      ...common,
    });
  } else {
    await ThermalPrinter.printBluetooth({ macAddress: printer.address, ...common });
  }
}

// ── printKot ─────────────────────────────────────────────────────────────────

/**
 * Put a kitchen ticket on paper.
 *
 * With no `printerId`, this fans the ticket out to EVERY KOT printer this
 * device drives — which is what the live Ably push wants, since the push says
 * "this order exists", not "this printer needs it". The pull queue addresses a
 * single printer instead, and passes its id.
 */
export async function printKot(
  order: KotOrder,
  isAddOn = false,
  opts: { force?: boolean; dedupeKey?: string; printerId?: string } = {},
): Promise<'printed' | 'failed' | 'skipped'> {
  const targets = opts.printerId
    ? [findPrinter(opts.printerId)].filter(Boolean) as LocalPrinter[]
    : kotPrinters();
  if (targets.length === 0) return 'skipped';

  const results = await Promise.all(
    targets.map((printer) => printKotOn(printer, order, isAddOn, opts)),
  );
  if (results.includes('printed')) return 'printed';
  if (results.includes('failed')) return 'failed';
  return 'skipped';
}

async function printKotOn(
  printer: LocalPrinter,
  order: KotOrder,
  isAddOn: boolean,
  opts: { force?: boolean; dedupeKey?: string },
): Promise<'printed' | 'failed' | 'skipped'> {
  // `dedupeKey` lets reprints share ONE key across their two delivery paths
  // (live Ably push + durable pull-queue fallback) so the same reprint request
  // never prints twice, while a NEW request (different requestedAt) still does.
  // It is still per-printer, or the kitchen printing a reprint would convince
  // the bar it had already printed it.
  const key = opts.dedupeKey
    ? `${opts.dedupeKey}:${printer.id ?? 'local'}`
    : dedupeKey(order.id, isAddOn, printer.id);

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
  // Rendered at THIS printer's width — the kitchen's 80mm and the bar's 58mm
  // are different tickets, not the same bytes sent twice.
  const text = buildKotText(orderWithFlag, profileOf(printer));

  try {
    await printRaw(text, printer);
    // Mark as recently printed BEFORE the (async) ack so a drain firing in the
    // gap before the server stamps kotPrintedAt is skipped, not re-printed.
    if (!opts.force) _recentlyPrinted.set(key, Date.now() + RECENT_TTL_MS);
    // Durably record "paper printed, ack pending" BEFORE attempting the ack —
    // if the ack fails and the app restarts, the outbox (not paper) retries.
    await outboxAdd({
      key, orderId: order.id, isAddOn, printedAt: new Date().toISOString(), printerId: printer.id,
    });
    try {
      await printerApi.ack(order.id, 'printed', undefined, isAddOn, printer.id);
      await outboxRemove(key);
    } catch { /* non-fatal — the outbox retries the ack on the next drain */ }
    return 'printed';
  } catch (err: any) {
    const errorMessage = err?.message ?? 'Unknown error';
    // Failed: do NOT mark recently-printed — the server pull-queue must be able
    // to hand this order back for a retry on the next drain.
    try {
      await printerApi.ack(order.id, 'failed', errorMessage, isAddOn, printer.id);
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
export async function printBill(
  bill: InvoiceBill,
  opts: { printerId?: string } = {},
): Promise<'printed' | 'failed'> {
  const printer = findPrinter(opts.printerId) ?? billPrinter();
  if (!printer) return 'failed';
  // Honour the on-device QR toggle by dropping the VPA the template gates on.
  const billToPrint = _printUpiQr ? bill : { ...bill, upiVpa: null };
  const profile = profileOf(printer);
  const logoDataUri = await billLogoFor(profile);
  try {
    await printRaw(buildInvoiceText({ ...billToPrint, logoDataUri }, profile), printer, { endWaitMs: BILL_END_WAIT_MS });
    return 'printed';
  } catch {
    if (!logoDataUri) return 'failed';
    // The logo is the least-proven part of the bill — never let it cost the
    // customer their bill. The image is converted before anything is sent, so
    // a logo failure has printed nothing yet.
    try {
      await printRaw(buildInvoiceText({ ...billToPrint, logoDataUri: null }, profile), printer, { endWaitMs: BILL_END_WAIT_MS });
      return 'printed';
    } catch {
      return 'failed';
    }
  }
}

// ── Dispatched bills ─────────────────────────────────────────────────────────

/**
 * A bill another staffer asked us to print. Arrives twice by design — once on
 * the live Ably push, once on the next pull-queue drain — so it is de-duped by
 * job id the way KOTs are de-duped by order id.
 *
 * Unlike a KOT there is nothing to rebuild: the server sent the finished bill,
 * which is the whole point (the requesting phone never names the totals, and
 * this device never recomputes them).
 */
const _billsInFlight = new Set<string>();
const _billsPrinted = new Map<string, number>();
const BILL_RECENT_TTL_MS = 10 * 60_000;

export async function printDispatchedBill(job: {
  jobId: string;
  printerId: string;
  sessionId?: string;
  bill: InvoiceBill;
}): Promise<'printed' | 'failed' | 'skipped'> {
  if (_billsInFlight.has(job.jobId)) return 'skipped';
  const now = Date.now();
  for (const [id, expiry] of _billsPrinted) if (expiry <= now) _billsPrinted.delete(id);
  if (_billsPrinted.has(job.jobId)) return 'skipped';

  const printer = findPrinter(job.printerId);
  // Addressed to a printer we no longer drive (it was moved while the job was
  // in flight). Stay silent — the device that holds it now will drain it.
  if (!printer) return 'skipped';

  _billsInFlight.add(job.jobId);
  try {
    const result = await printBill(job.bill, { printerId: job.printerId });
    if (result === 'printed') _billsPrinted.set(job.jobId, Date.now() + BILL_RECENT_TTL_MS);
    const deviceId = await getPrintDeviceId();
    try {
      await printerApi.ackBillPrint(
        {
          jobId: job.jobId,
          status: result === 'printed' ? 'printed' : 'failed',
          errorMessage: result === 'printed' ? undefined : 'Printer did not accept the bill',
          printerId: job.printerId,
          sessionId: job.sessionId,
        },
        deviceId,
      );
    } catch {
      // The requester's overlay will time out and say so; the parked job is
      // cleared by the next successful ack rather than lost.
    }
    return result;
  } finally {
    _billsInFlight.delete(job.jobId);
  }
}

// ── Bill logo ────────────────────────────────────────────────────────────────
// The server renders the venue logo black-on-white at the size it prints and
// returns it as a data: URI, which the native layer (Glide) decodes without
// touching the network. Kept in memory per paper width; a stale copy prints
// straight away while a fresh one loads, so a Bill Settings change lands
// within LOGO_TTL_MS without ever making a bill wait twice.

const LOGO_TTL_MS = 10 * 60_000;
/** Longest a bill waits for a logo it has never loaded; after this it prints without one. */
const LOGO_FIRST_WAIT_MS = 2500;
/** Share of the printable width the logo may take. */
const LOGO_WIDTH_SHARE = 0.6;

let _logo: { widthDots: number; dataUri: string | null; at: number } | null = null;
let _logoFetch: Promise<string | null> | null = null;

function fetchBillLogo(widthDots: number): Promise<string | null> {
  if (!_logoFetch) {
    _logoFetch = printerApi
      .getBillLogo(widthDots)
      .then((res) => {
        const dataUri = res?.data?.dataUri ?? null;
        _logo = { widthDots, dataUri, at: Date.now() };
        return dataUri;
      })
      // Offline or an older server: keep whatever we had rather than forgetting it.
      .catch(() => (_logo?.widthDots === widthDots ? _logo.dataUri : null))
      .finally(() => { _logoFetch = null; });
  }
  return _logoFetch;
}

async function billLogoFor(profile: PaperProfile): Promise<string | null> {
  if (!_printBillLogo) return null;
  // iOS's printer bridge has no <img> support; the tag would print as text.
  if (Platform.OS !== 'android') return null;
  const widthDots = Math.floor(((profile.printableWidthMM * profile.dpi) / 25.4) * LOGO_WIDTH_SHARE);
  if (_logo && _logo.widthDots === widthDots) {
    if (Date.now() - _logo.at > LOGO_TTL_MS) void fetchBillLogo(widthDots);
    return _logo.dataUri;
  }
  return Promise.race([
    fetchBillLogo(widthDots),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), LOGO_FIRST_WAIT_MS)),
  ]);
}

export async function printZReport(
  z: ZReport,
  opts: { printerId?: string } = {},
): Promise<'printed' | 'failed'> {
  // A Z-report is a cash-drawer document, so it belongs on the bill printer.
  const printer = findPrinter(opts.printerId) ?? billPrinter() ?? primaryPrinter();
  const text = buildZReportText(z, profileOf(printer));
  try {
    await printRaw(text, printer);
    return 'printed';
  } catch {
    return 'failed';
  }
}

// ── printTest ─────────────────────────────────────────────────────────────────

/** Test one specific printer — the Printers screen offers this per row. */
export async function printTest(opts: { printerId?: string } = {}): Promise<'printed' | 'failed'> {
  const printer = findPrinter(opts.printerId) ?? primaryPrinter();
  const now = new Date().toLocaleTimeString('en-IN', { hour12: false });
  const text = [
    '[C]<b><font size="big">QUINCKLE</font></b>',
    '[C]Test Page',
    `[C]${now}`,
    `[C]${printer?.name ?? 'Printer'} is working!`,
    '[C]<cut/>',
  ].join('\n');

  try {
    await printRaw(text, printer);
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
        await printerApi.ack(entry.orderId, 'printed', undefined, entry.isAddOn, entry.printerId);
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
  if (_printers.length === 0) return;
  try {
    const orders = await fetchUnprinted();
    for (const order of orders) {
      await printKot(order, order.isAddOn);
    }
  } catch { /* non-fatal */ }
}
