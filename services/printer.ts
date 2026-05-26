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
import ThermalPrinter from 'react-native-thermal-printer';
import { buildKotText, type KotOrder } from './kotTemplate';
import { printerApi } from './api';

// ── Storage keys ──────────────────────────────────────────────────────────────

const KEY_CONFIG = 'printerConfig';
const KEY_QUEUE  = 'pendingPrintQueue';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BluetoothDevice {
  name: string;
  address: string;
}

export type PrinterStatus = 'connected' | 'disconnected' | 'unpaired' | 'error';

export interface PrinterConfig {
  address: string;
  name: string;
  paperWidth: 58 | 80;
  pairedAt: string;
}

interface QueueItem {
  order: KotOrder;
  isAddOn: boolean;
  addedAt: string;
}

// ── Module state ──────────────────────────────────────────────────────────────

let _config: PrinterConfig | null = null;
let _status: PrinterStatus = 'unpaired';

// ── Init (call on app launch) ─────────────────────────────────────────────────

export async function initPrinter(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY_CONFIG);
    if (raw) {
      _config = JSON.parse(raw) as PrinterConfig;
      // react-native-thermal-printer has no persistent connection —
      // it connects per-job via printBluetooth(). Mark as 'connected'
      // optimistically; actual errors will surface on first print attempt.
      _status = 'connected';
    }
  } catch {
    _status = 'error';
  }
}

// ── scan ──────────────────────────────────────────────────────────────────────

export async function scan(): Promise<BluetoothDevice[]> {
  try {
    const devices = await (ThermalPrinter as any).getBluetoothDeviceList();
    return (devices as any[]).map((d: any) => ({
      name: d.name ?? d.deviceName ?? 'Unknown',
      address: d.address ?? d.macAddress ?? '',
    }));
  } catch {
    return [];
  }
}

// ── pair ──────────────────────────────────────────────────────────────────────

export async function pair(device: BluetoothDevice, paperWidth: 58 | 80 = 58): Promise<void> {
  _config = {
    address: device.address,
    name: device.name,
    paperWidth,
    pairedAt: new Date().toISOString(),
  };
  await AsyncStorage.setItem(KEY_CONFIG, JSON.stringify(_config));
  // No BT connection step — react-native-thermal-printer connects per print job.
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
  await ThermalPrinter.printBluetooth({
    macAddress: _config.address,
    payload: text,
    printerWidthMM: _config.paperWidth,
    printerNbrCharactersPerLine: _config.paperWidth === 58 ? 32 : 48,
    autoCut: true,
  });
}

// ── printKot ─────────────────────────────────────────────────────────────────

export async function printKot(
  order: KotOrder,
  isAddOn = false,
): Promise<'printed' | 'failed'> {
  const orderWithFlag = { ...order, isAddOn };
  const text = buildKotText(orderWithFlag, _config?.paperWidth ?? 58);

  try {
    await printRaw(text);
    // Ack to backend
    try {
      await printerApi.ack(order.id, 'printed', undefined, isAddOn);
    } catch { /* non-fatal — will retry via backend on next pull */ }
    return 'printed';
  } catch (err: any) {
    const errorMessage = err?.message ?? 'Unknown error';
    // Queue for retry
    await enqueue(order, isAddOn);
    // Ack failure to backend
    try {
      await printerApi.ack(order.id, 'failed', errorMessage, isAddOn);
    } catch { /* non-fatal */ }
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

// ── Queue persistence ─────────────────────────────────────────────────────────

async function enqueue(order: KotOrder, isAddOn: boolean): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY_QUEUE);
    const queue: QueueItem[] = raw ? JSON.parse(raw) : [];
    // Don't queue the same orderId twice
    if (!queue.some((q) => q.order.id === order.id)) {
      queue.push({ order, isAddOn, addedAt: new Date().toISOString() });
      await AsyncStorage.setItem(KEY_QUEUE, JSON.stringify(queue));
    }
  } catch { /* non-fatal */ }
}

async function flushQueue(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY_QUEUE);
    if (!raw) return;
    const queue: QueueItem[] = JSON.parse(raw);
    if (queue.length === 0) return;

    const remaining: QueueItem[] = [];
    for (const item of queue) {
      try {
        const text = buildKotText({ ...item.order, isAddOn: item.isAddOn }, _config?.paperWidth ?? 58);
        await printRaw(text);
        try { await printerApi.ack(item.order.id, 'printed', undefined, item.isAddOn); } catch { /* non-fatal */ }
      } catch {
        remaining.push(item);
      }
    }

    await AsyncStorage.setItem(KEY_QUEUE, JSON.stringify(remaining));
  } catch { /* non-fatal */ }
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
