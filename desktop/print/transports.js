/**
 * Desktop print transports.
 *
 * Android reaches printers through DantSu (Bluetooth / TCP / USB). Desktop has
 * no DantSu, so each transport is implemented here against Node APIs.
 *
 * Bluetooth is deliberately absent. On a desktop the printer is plugged in or
 * on the LAN; desktop Bluetooth ESC/POS means per-OS pairing stacks for a case
 * that does not occur in practice. `supports()` reports that honestly so the
 * UI can hide the option rather than offer something that cannot work.
 */

const net = require('net');

/** How long to wait for a TCP connect before giving up. */
const CONNECT_TIMEOUT_MS = 6000;
/**
 * Pause after the last byte is flushed, before closing the socket.
 *
 * This is the desktop counterpart of the KOT_END_FEED_MM problem documented in
 * services/printer.ts: closing while the printer is still draining its buffer
 * truncates the tail of long tickets. Here we can wait on a real flush
 * callback, so this is a small safety margin rather than a guess.
 */
const DRAIN_SETTLE_MS = 400;

// ── Network (raw TCP 9100) ───────────────────────────────────────────────────

function printTcp({ ip, port = 9100, data }) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (err) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      err ? reject(err) : resolve();
    };

    socket.setTimeout(CONNECT_TIMEOUT_MS, () => done(new Error('PRINTER_TIMEOUT')));
    socket.on('error', (err) => done(new Error(`PRINTER_NET_${err.code || 'ERROR'}`)));

    socket.connect(port, ip, () => {
      socket.setTimeout(0);
      // The write callback fires once the data is handed to the OS; the settle
      // pause covers the printer's own buffer.
      socket.write(data, () => setTimeout(() => done(null), DRAIN_SETTLE_MS));
    });
  });
}

/** Is something listening on the printer port? Used by the pairing screen. */
function probeTcp(ip, port = 9100, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const finish = (ok) => { socket.destroy(); resolve(ok); };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.on('error', () => finish(false));
    socket.connect(port, ip, () => finish(true));
  });
}

// ── USB ──────────────────────────────────────────────────────────────────────

/**
 * `usb` is an optional dependency with prebuilt binaries. If it is missing or
 * fails to load (an unsupported platform, a blocked postinstall), the shell
 * must still start with network printing working — so it is required lazily and
 * the failure is reported as "unsupported", not a crash.
 */
let _usb;
let _usbError = null;
function usbLib() {
  if (_usb === undefined) {
    try {
      _usb = require('usb');
    } catch (err) {
      _usb = null;
      _usbError = err.message;
    }
  }
  return _usb;
}

/** USB printer class, per the USB spec — how we tell a printer from a webcam. */
const USB_CLASS_PRINTER = 0x07;

function isPrinterDevice(device) {
  if (device.deviceDescriptor.bDeviceClass === USB_CLASS_PRINTER) return true;
  // Most ESC/POS printers declare the class per-interface, not per-device.
  try {
    return (device.configDescriptor?.interfaces || []).some((alts) =>
      alts.some((alt) => alt.bInterfaceClass === USB_CLASS_PRINTER));
  } catch {
    return false;
  }
}

function listUsb() {
  const usb = usbLib();
  if (!usb) return [];
  const devices = typeof usb.getDeviceList === 'function'
    ? usb.getDeviceList()
    : usb.usb.getDeviceList();
  return devices.filter(isPrinterDevice).map((d) => ({
    vendorId: d.deviceDescriptor.idVendor,
    productId: d.deviceDescriptor.idProduct,
    // A product string needs the device open, which we avoid during a scan —
    // the pairing screen shows the ids, which is what identifies the printer.
    deviceName: `USB ${d.deviceDescriptor.idVendor.toString(16).padStart(4, '0')}:${d.deviceDescriptor.idProduct.toString(16).padStart(4, '0')}`,
  }));
}

function printUsb({ vendorId, productId, data }) {
  return new Promise((resolve, reject) => {
    const usb = usbLib();
    if (!usb) return reject(new Error('PRINTER_USB_UNSUPPORTED'));

    const find = usb.findByIds || usb.usb.findByIds;
    const device = find(vendorId, productId);
    if (!device) return reject(new Error('PRINTER_USB_NOT_FOUND'));

    let claimed = null;
    const cleanup = () => {
      try {
        if (claimed) claimed.release(true, () => { try { device.close(); } catch {} });
        else device.close();
      } catch { /* the device may already be gone */ }
    };

    try {
      device.open();
      const iface = device.interfaces.find((i) =>
        i.descriptor.bInterfaceClass === USB_CLASS_PRINTER) || device.interfaces[0];
      if (!iface) throw new Error('PRINTER_USB_NO_INTERFACE');

      // Linux binds printers to usblp; we must take the device from the kernel.
      if (typeof iface.isKernelDriverActive === 'function' && iface.isKernelDriverActive()) {
        iface.detachKernelDriver();
      }
      iface.claim();
      claimed = iface;

      const endpoint = iface.endpoints.find((ep) => ep.direction === 'out');
      if (!endpoint) throw new Error('PRINTER_USB_NO_ENDPOINT');

      endpoint.transfer(data, (err) => {
        setTimeout(() => {
          cleanup();
          err ? reject(new Error(`PRINTER_USB_${err.errno || 'WRITE'}`)) : resolve();
        }, DRAIN_SETTLE_MS);
      });
    } catch (err) {
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

// ── Capabilities ─────────────────────────────────────────────────────────────

function supports() {
  return {
    network: true,
    usb: !!usbLib(),
    bluetooth: false, // see the module note
    usbError: _usbError,
  };
}

module.exports = { printTcp, probeTcp, printUsb, listUsb, supports };
