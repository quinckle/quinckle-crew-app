/**
 * Printer transport — native (Android / iOS).
 *
 * Everything that physically touches a printer lives here; printer.ts keeps the
 * logic worth trusting (de-duplication, the durable ack outbox, retry, pairing
 * state) and is platform-agnostic.
 *
 * The desktop build swaps this file for printTransport.web.ts via Metro's
 * platform extensions — no call site changes, no branching inside printer.ts.
 */

import { PermissionsAndroid, Platform } from 'react-native';
import ThermalPrinter from 'react-native-thermal-printer';
import {
  isUsbSupported as usbSupported,
  listUsbPrinters as usbList,
  printUsb as printOverUsb,
} from './usbPrinter';
import type {
  BluetoothDevice, TransportCapabilities, TransportJob, UsbPrinterDevice,
} from './printTypes';

/** Nothing to warm up natively; the web transport uses this to probe the shell. */
export async function initTransport(): Promise<void> {}

/** Always false natively — this is the Electron shell's answer to the same question. */
export function isDesktop(): boolean {
  return false;
}

export function isUsbSupported(): boolean {
  return usbSupported();
}

export function listUsbPrinters(): Promise<UsbPrinterDevice[]> {
  return usbList();
}

export function capabilities(): TransportCapabilities {
  return { bluetooth: Platform.OS === 'android', network: true, usb: usbSupported() };
}

/**
 * Network reachability check. The native bridge has no probe, and pairNetwork
 * already validates by printing a test page, so this reports "assume reachable"
 * rather than pretending to have checked.
 */
export async function probeNetwork(): Promise<boolean> {
  return true;
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

export async function scanBluetooth(): Promise<BluetoothDevice[]> {
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

// ── send ─────────────────────────────────────────────────────────────────────

/**
 * react-native-thermal-printer connects, prints, then disconnects per call.
 * No persistent connection or reconnect step is needed or supported.
 */
export async function sendToPrinter(job: TransportJob): Promise<void> {
  const common = {
    payload: job.payload,
    printerDpi: job.profile.dpi,
    printerWidthMM: job.profile.printableWidthMM,
    printerNbrCharactersPerLine: job.profile.charsPerLine,
    autoCut: job.autoCut,
    mmFeedPaper: job.mmFeedPaper,
  };

  if (job.transport === 'network') {
    if (!job.ip) throw new Error('PRINTER_NO_IP');
    await ThermalPrinter.printTcp({ ip: job.ip, port: job.port ?? 9100, ...common });
  } else if (job.transport === 'usb') {
    // A USB pairing can outlive the build that created it — an OTA rollback to
    // a pre-USB APK would leave the config pointing at a bridge method that no
    // longer exists. Fail with a clear code instead of a native crash.
    if (!usbSupported()) throw new Error('PRINTER_USB_UNSUPPORTED');
    await printOverUsb({
      vendorId: job.vendorId ?? 0,
      productId: job.productId ?? 0,
      openCashbox: job.openCashbox,
      ...common,
    });
  } else {
    if (!job.address) throw new Error('PRINTER_NO_ADDRESS');
    await ThermalPrinter.printBluetooth({ macAddress: job.address, ...common });
  }
}
