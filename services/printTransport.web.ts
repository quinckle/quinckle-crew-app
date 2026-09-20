/**
 * Printer transport — desktop (Electron) and web.
 *
 * Metro resolves this file instead of printTransport.ts whenever the platform
 * is web, which is how the desktop shell gets printing without printer.ts
 * knowing anything about Electron.
 *
 * The actual socket / USB work happens in the Electron main process
 * (desktop/print/service.js). This file only marshals a job across the preload
 * bridge, so a plain browser — where `window.quinckle` is absent — degrades to
 * "no printer available" instead of failing in some confusing way.
 */

import type {
  BluetoothDevice, TransportCapabilities, TransportJob, UsbPrinterDevice,
} from './printTypes';

interface DesktopPrinterBridge {
  print: (job: TransportJob) => Promise<void>;
  listUsb: () => Promise<UsbPrinterDevice[]>;
  probeNetwork: (ip: string, port?: number) => Promise<boolean>;
  capabilities: () => Promise<{ network: boolean; usb: boolean; bluetooth: boolean }>;
}

interface DesktopBridge {
  isDesktop: boolean;
  platform: string;
  version: string;
  printer: DesktopPrinterBridge;
}

function bridge(): DesktopPrinterBridge | null {
  const q = (globalThis as any)?.quinckle as DesktopBridge | undefined;
  return q?.isDesktop && q.printer ? q.printer : null;
}

/** True in the Electron shell, false in an ordinary browser tab. */
export function isDesktop(): boolean {
  return bridge() !== null;
}

// Capabilities are async in the main process but sync at every call site, so
// they are fetched once at startup and cached. Until that resolves we report
// the conservative answer, which only means the pairing screen shows USB a
// moment late.
let _caps: TransportCapabilities = { bluetooth: false, network: false, usb: false };

export async function initTransport(): Promise<void> {
  const b = bridge();
  if (!b) return;
  try {
    const caps = await b.capabilities();
    _caps = { bluetooth: false, network: !!caps.network, usb: !!caps.usb };
  } catch {
    // The shell is there but the probe failed — network printing still works.
    _caps = { bluetooth: false, network: true, usb: false };
  }
}

export function capabilities(): TransportCapabilities {
  return _caps;
}

export function isUsbSupported(): boolean {
  return _caps.usb;
}

export async function listUsbPrinters(): Promise<UsbPrinterDevice[]> {
  const b = bridge();
  if (!b) return [];
  try {
    return await b.listUsb();
  } catch {
    return [];
  }
}

export async function probeNetwork(ip: string, port = 9100): Promise<boolean> {
  const b = bridge();
  if (!b) return false;
  try {
    return await b.probeNetwork(ip, port);
  } catch {
    return false;
  }
}

/**
 * No Bluetooth on desktop — see the note in desktop/print/transports.js. The
 * pairing screen gates the Bluetooth option on capabilities().bluetooth, so an
 * empty list here is a fallback, not the mechanism.
 */
export async function scanBluetooth(): Promise<BluetoothDevice[]> {
  return [];
}

export async function sendToPrinter(job: TransportJob): Promise<void> {
  const b = bridge();
  if (!b) throw new Error('PRINTER_NO_DESKTOP_BRIDGE');
  // Errors arrive as the same PRINTER_* codes the native path throws, so
  // printer.ts's ack/retry handling needs no desktop-specific branch.
  await b.print(job);
}
