/**
 * Print service — the main-process half of the desktop printing path.
 *
 * The renderer (the crew app itself) never touches a socket or a USB handle.
 * It hands over the SAME markup string the Android path builds, plus the paper
 * profile, and this module turns that into bytes and puts it on the wire.
 *
 * Keeping the split here matters: all the logic worth trusting — de-duplication,
 * the durable ack outbox, retry — stays in services/printer.ts, shared with
 * Android. This side is deliberately dumb.
 */

const { render } = require('./markup');
const transports = require('./transports');

/**
 * @param {object} job
 * @param {'network'|'usb'} job.transport
 * @param {string} job.payload      DantSu markup from the shared templates
 * @param {object} job.profile      PaperProfile — charsPerLine, dpi, …
 * @param {boolean} [job.autoCut]
 * @param {boolean} [job.openCashbox]
 * @param {number} [job.mmFeedPaper]
 */
async function print(job) {
  const {
    transport, payload, profile,
    autoCut = true, openCashbox = false, mmFeedPaper = 40,
    ip, port, vendorId, productId,
  } = job || {};

  if (!payload) throw new Error('PRINTER_EMPTY_PAYLOAD');
  if (!profile) throw new Error('PRINTER_NO_PROFILE');

  const data = render(payload, profile, { autoCut, openCashbox, endFeedMM: mmFeedPaper });

  switch (transport) {
    case 'network':
      if (!ip) throw new Error('PRINTER_NO_IP');
      return transports.printTcp({ ip, port: port || 9100, data });
    case 'usb':
      return transports.printUsb({ vendorId, productId, data });
    case 'bluetooth':
      // Reachable only if a pairing made on an Android device is carried to
      // desktop. Fail with the code the UI already knows how to explain.
      throw new Error('PRINTER_TRANSPORT_UNSUPPORTED');
    default:
      throw new Error('PRINTER_NO_TRANSPORT');
  }
}

/** Register the IPC surface the preload bridge exposes. */
function register(ipcMain) {
  // Every handler returns {ok, …} rather than throwing across the IPC boundary,
  // so the renderer gets a printer error code instead of an opaque Electron one.
  const wrap = (fn) => async (_event, arg) => {
    try {
      return { ok: true, value: await fn(arg) };
    } catch (err) {
      return { ok: false, error: err?.message || 'PRINTER_UNKNOWN' };
    }
  };

  ipcMain.handle('printer:print', wrap(print));
  ipcMain.handle('printer:listUsb', wrap(async () => transports.listUsb()));
  ipcMain.handle('printer:probeNetwork', wrap(async ({ ip, port }) => transports.probeTcp(ip, port)));
  ipcMain.handle('printer:capabilities', wrap(async () => transports.supports()));
}

module.exports = { print, register };
