/**
 * Shared printer types.
 *
 * These live apart from printer.ts so the transport layer can use them without
 * importing printer.ts, which imports the transport layer. printer.ts re-exports
 * everything here, so existing call sites keep their imports unchanged.
 */

import type { PaperProfile } from './paperProfile';

export interface BluetoothDevice {
  name: string;
  address: string;
}

export interface UsbPrinterDevice {
  deviceName: string;
  vendorId: number;
  productId: number;
}

/** How this device reaches the printer. */
export type TransportKind = 'bluetooth' | 'network' | 'usb';

/**
 * One ticket, ready to send.
 *
 * `payload` is the DantSu markup the shared templates produce. On Android the
 * native library renders it; on desktop the Electron main process does. Neither
 * side changes the markup, so a ticket prints identically on both.
 */
export interface TransportJob {
  transport: TransportKind;
  payload: string;
  profile: PaperProfile;
  autoCut: boolean;
  openCashbox: boolean;
  /** End-of-ticket paper feed in mm. */
  mmFeedPaper: number;
  /** Bluetooth MAC. */
  address?: string;
  ip?: string;
  port?: number;
  vendorId?: number;
  productId?: number;
}

/** What the current platform can actually reach a printer over. */
export interface TransportCapabilities {
  bluetooth: boolean;
  network: boolean;
  usb: boolean;
}
