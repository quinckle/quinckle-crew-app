#!/usr/bin/env node
/**
 * Live mode: Metro's dev server + the Electron shell pointed at it, so saving a
 * source file updates the desktop window in place — no `npm run export`, no
 * reload.
 *
 *   cd desktop && npm run live
 *
 * Extra arguments go to Electron, e.g. `npm run live -- --user-data-dir=/tmp/p`
 * for a second profile that does not clash with a running instance.
 *
 * Quit any running Quinckle Crew window first. The shell allows one instance per
 * machine (two would mean two print sinks and double KOTs), so a second launch
 * just focuses the first and exits.
 *
 * The login now persists (OS-encrypted, see secureStore.js), so a reload keeps
 * you signed in. Note that live mode runs on its own origin (http://localhost),
 * so the per-origin staff profile is separate from the exported build's: sign in
 * once in each mode.
 */

const path = require('path');
const { spawn } = require('child_process');
const { applySingleOutput } = require('./singleOutput');

const APP_ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.QUINCKLE_LIVE_PORT || 8099);
const URL_ = `http://localhost:${PORT}/`;
const READY_TIMEOUT_MS = 180_000;

const children = [];
// 'exit' also fires for signals (singleOutput maps them to process.exit), so
// this is the one place Metro is stopped.
process.on('exit', () => children.forEach((c) => { try { c.kill('SIGTERM'); } catch { /* gone */ } }));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function isUp() {
  try { return (await fetch(URL_)).ok; } catch { return false; }
}

async function waitForMetro(metro) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (metro.exitCode !== null) throw new Error('Metro exited before it was ready.');
    if (await isUp()) return;
    await sleep(1000);
  }
  throw new Error(`Metro was not ready after ${READY_TIMEOUT_MS / 1000}s.`);
}

/**
 * Metro compiles the bundle on first request, which takes a while on a cold
 * cache. Ask for it now so the window opens onto a page that is ready rather
 * than onto a blank one.
 */
async function warmBundle() {
  try {
    const html = await (await fetch(URL_)).text();
    const src = /<script[^>]+src="([^"]+)"/.exec(html)?.[1];
    if (src) await (await fetch(new URL(src, URL_))).arrayBuffer();
  } catch { /* the window will trigger the build itself */ }
}

async function main() {
  if (await isUp()) {
    console.error(`\n  Something is already listening on ${URL_}\n  Stop it, or set QUINCKLE_LIVE_PORT to another port.\n`);
    process.exit(1);
  }

  // Static output would server-render every route in Node, where the shell's
  // preload bridge does not exist — a phone-layout page that hydrates into the
  // desktop one and mismatches. Same override the export uses.
  applySingleOutput();

  console.log(`\n  Starting Metro on ${URL_} …\n`);
  const metro = spawn('npx', ['expo', 'start', '--web', '--port', String(PORT)], {
    cwd: APP_ROOT,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, BROWSER: 'none' }, // don't also open a browser tab
  });
  children.push(metro);

  await waitForMetro(metro);
  console.log('  Metro is up — warming the bundle …');
  await warmBundle();

  console.log('  Opening Quinckle Crew.\n');
  const started = Date.now();
  const electron = spawn(require('electron'), ['.', ...process.argv.slice(2)], {
    cwd: __dirname,
    stdio: 'inherit',
    env: { ...process.env, QUINCKLE_DEV_URL: URL_ },
  });
  children.push(electron);

  electron.on('exit', (code) => {
    if (Date.now() - started < 4000) {
      console.error('\n  The window closed straight away — another Quinckle Crew is probably already running. Quit it (Cmd+Q) and try again.\n');
    }
    process.exit(code ?? 0);
  });
}

main().catch((err) => {
  console.error(`\n  ${err.message}\n`);
  process.exit(1);
});
