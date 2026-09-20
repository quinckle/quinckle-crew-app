/**
 * Preload bridge.
 *
 * Runs with contextIsolation on, so the crew app's JS never sees Node. It sees
 * exactly the surface below and nothing else — no fs, no child_process, no
 * ipcRenderer. This is the security boundary for a program that will run on
 * venue machines, so the surface stays this small on purpose.
 *
 * services/printTransport.web.ts is the only consumer.
 */

const { contextBridge, ipcRenderer } = require('electron');

/** Unwrap the {ok, value|error} envelope the main process returns. */
const call = async (channel, arg) => {
  const res = await ipcRenderer.invoke(channel, arg);
  if (!res?.ok) throw new Error(res?.error || 'IPC_FAILED');
  return res.value;
};

contextBridge.exposeInMainWorld('quinckle', {
  isDesktop: true,
  platform: process.platform,
  version: process.env.QUINCKLE_VERSION || '0.0.0',

  /**
   * Outbound HTTP performed by the main process — see desktop/http.js for why
   * the renderer does not make these calls itself.
   */
  http: {
    request: (req) => call('http:request', req),
  },

  printer: {
    print: (job) => call('printer:print', job),
    listUsb: () => call('printer:listUsb'),
    probeNetwork: (ip, port) => call('printer:probeNetwork', { ip, port }),
    capabilities: () => call('printer:capabilities'),
  },
});
