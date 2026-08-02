/**
 * USB (OTG) transport for ESC/POS printing.
 *
 * `react-native-thermal-printer` ships only printBluetooth/printTcp on its JS
 * surface, but the DantSu library it wraps has always had a USB connection
 * class. We expose it with a native patch — see
 * `patches/react-native-thermal-printer+2.3.6.patch` — and reach the two added
 * bridge methods directly here rather than patching the library's JS as well,
 * which keeps the patch to a single file.
 *
 * IMPORTANT — the methods below exist only in builds carrying that patch.
 * runtimeVersion is `appVersion`, so a device still on an older APK keeps
 * receiving new JS over OTA. Anything USB-related must therefore be gated on
 * `isUsbSupported()`, or that device crashes on an undefined native method.
 */

import { NativeModules, Platform } from 'react-native';

export interface UsbPrinterDevice {
  deviceName: string;
  vendorId: number;
  productId: number;
}

interface ThermalPrinterNative {
  getUsbDeviceList?: () => Promise<UsbPrinterDevice[]>;
  printUsb?: (
    vendorId: number,
    productId: number,
    payload: string,
    autoCut: boolean,
    openCashbox: boolean,
    mmFeedPaper: number,
    printerDpi: number,
    printerWidthMM: number,
    printerNbrCharactersPerLine: number,
  ) => Promise<void>;
}

const native: ThermalPrinterNative | undefined =
  NativeModules.ThermalPrinterModule as ThermalPrinterNative | undefined;

/**
 * Whether this build can print over USB. False on iOS (no USB ESC/POS at all)
 * and on any Android build predating the native patch.
 */
export function isUsbSupported(): boolean {
  return (
    Platform.OS === 'android' &&
    typeof native?.printUsb === 'function' &&
    typeof native?.getUsbDeviceList === 'function'
  );
}

/** Attached USB printers. Empty when USB isn't supported or nothing is plugged in. */
export async function listUsbPrinters(): Promise<UsbPrinterDevice[]> {
  if (!isUsbSupported()) return [];
  try {
    return (await native!.getUsbDeviceList!()) ?? [];
  } catch {
    return [];
  }
}

export interface UsbPrintArgs {
  vendorId: number;
  productId: number;
  payload: string;
  autoCut: boolean;
  openCashbox?: boolean;
  mmFeedPaper: number;
  printerDpi: number;
  printerWidthMM: number;
  printerNbrCharactersPerLine: number;
}

/**
 * Print one payload over USB. The first print after a printer is attached may
 * block on the system's USB permission dialog; accepting "always open for this
 * device" makes the grant persistent so later prints are silent.
 */
export async function printUsb(args: UsbPrintArgs): Promise<void> {
  if (!isUsbSupported()) throw new Error('PRINTER_USB_UNSUPPORTED');
  await native!.printUsb!(
    args.vendorId,
    args.productId,
    args.payload,
    args.autoCut,
    args.openCashbox ?? false,
    args.mmFeedPaper,
    args.printerDpi,
    args.printerWidthMM,
    args.printerNbrCharactersPerLine,
  );
}
