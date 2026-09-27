/**
 * Quinckle Crew — desktop shell (Electron main process).
 *
 * The crew app is exported to web by Metro (`npm run desktop:export`) and this
 * process serves that build over a private `app://` scheme, then owns the one
 * thing a web page cannot do: talking to a thermal printer.
 *
 * Why a custom scheme rather than file:// — the app fetches api.quinckle.com,
 * and a file:// page has a null origin, which fails CORS on every request. A
 * registered standard scheme gives the page a stable, real origin.
 */

const { app, BrowserWindow, protocol, ipcMain, powerSaveBlocker, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const printService = require('./print/service');
const httpService = require('./http');
const secureStore = require('./secureStore');

const SCHEME = 'app';
const WEB_DIST = process.env.QUINCKLE_WEB_DIST || path.join(__dirname, 'web-build');
const IS_DEV = !app.isPackaged;

/**
 * Live mode (`npm run live`): load the Metro dev server instead of the static
 * export, so saving a file updates the window without an export + reload.
 *
 * Unpackaged builds only, and localhost only — an env var must never be able to
 * point a shipped till at some other site.
 */
function resolveDevUrl(raw) {
  if (!raw || app.isPackaged) return null;
  try {
    const url = new URL(raw);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    return url.protocol === 'http:' && local ? url.origin + '/' : null;
  } catch {
    return null;
  }
}
const DEV_URL = resolveDevUrl(process.env.QUINCKLE_DEV_URL);

/**
 * Hidden mode, for automated checks (QUINCKLE_HIDDEN=1): no window, no DevTools,
 * no dock icon, so a test run does not flash windows over whatever you are
 * doing. The page still renders and answers the debugger; throttling is off so
 * timers and animation frames keep running. Unpackaged builds only.
 */
const HIDDEN = process.env.QUINCKLE_HIDDEN === '1' && !app.isPackaged;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.ttf': 'font/ttf', '.otf': 'font/otf', '.woff': 'font/woff', '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.tflite': 'application/octet-stream',
  '.map': 'application/json',
};

// Must run before 'ready'. `standard` gives us a real origin; `supportFetchAPI`
// lets the bundle fetch its own assets; `secure` keeps us in a secure context,
// which the app needs for crypto and for Ably's WebSocket.
protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}]);

/** Only one till per machine — two windows means two print sinks and double KOTs. */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
}

let mainWindow = null;
let keepAwakeId = null;

async function serve(request) {
  const url = new URL(request.url);
  const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');

  // Never let a crafted path escape the build directory.
  const target = path.resolve(WEB_DIST, rel);
  const root = path.resolve(WEB_DIST);
  const safe = target === root || target.startsWith(root + path.sep);

  const candidates = safe
    ? [target, `${target}.html`, path.join(target, 'index.html'), path.join(root, 'index.html')]
    : [path.join(root, 'index.html')];

  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (!stat.isFile()) continue;
      const body = await fs.readFile(candidate);
      return new Response(body, {
        status: 200,
        headers: { 'content-type': MIME[path.extname(candidate).toLowerCase()] || 'application/octet-stream' },
      });
    } catch { /* try the next candidate */ }
  }
  return new Response('Not found', { status: 404 });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#09090b', // matches the app's splash so there is no white flash
    show: false,
    title: 'Quinckle Crew',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: !HIDDEN,
      sandbox: false, // the preload needs require(); the renderer stays sandboxed by contextIsolation
    },
  });

  mainWindow.once('ready-to-show', () => { if (!HIDDEN) mainWindow.show(); });
  if (HIDDEN) app.dock?.hide();

  // A till should not sleep mid-service, and the KOT sink must keep its socket.
  // This replaces expo-keep-awake, which is a no-op off native.
  keepAwakeId = powerSaveBlocker.start('prevent-display-sleep');

  // Anything that is not the app itself opens in the real browser, not in a
  // chrome-less Electron window the staff cannot navigate out of.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const isApp = url.startsWith(`${SCHEME}://`) || (DEV_URL && url.startsWith(DEV_URL));
    if (!isApp) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });

  // Renderer console in the terminal — the fastest way to diagnose a
  // desktop-only problem, since the app's own error paths log there.
  if (IS_DEV) {
    mainWindow.webContents.on('console-message', (event) => {
      console.log(`[renderer:${event.level ?? 'log'}] ${event.message ?? ''}`);
    });
  }

  mainWindow.loadURL(DEV_URL || `${SCHEME}://local/`);
  if (IS_DEV && !HIDDEN) mainWindow.webContents.openDevTools({ mode: 'detach' });

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  if (!DEV_URL && !fsSync.existsSync(WEB_DIST)) {
    // A clear message beats a blank window when the export step was skipped.
    console.error(`\n  No web build at ${WEB_DIST}\n  Run: npm run desktop:export\n`);
  }

  protocol.handle(SCHEME, serve);
  httpService.register(ipcMain);
  secureStore.register(ipcMain, {
    safeStorage,
    filePath: path.join(app.getPath('userData'), 'secure-store.json'),
  });
  printService.register(ipcMain);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (keepAwakeId !== null && powerSaveBlocker.isStarted(keepAwakeId)) {
    powerSaveBlocker.stop(keepAwakeId);
  }
  if (process.platform !== 'darwin') app.quit();
});
