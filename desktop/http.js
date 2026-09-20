/**
 * Outbound HTTP for the renderer.
 *
 * The crew app's page lives on the private `app://local` origin, which is not
 * on the backend's CORS allowlist — so in the renderer every API response is
 * discarded by Chromium before the app can read it. Performing the request here
 * instead puts the desktop build in the same position as the Android app: a
 * native HTTP client, where CORS simply does not apply.
 *
 * Nothing is relaxed to achieve that. No response header is rewritten and the
 * server's allowlist still governs real browsers. The requests themselves are
 * unchanged — same URL, method, headers and body the app already sends.
 *
 * Scope is deliberately narrow: only the hosts in ALLOWED_HOSTS, only https,
 * and no redirect to anywhere else. A compromised renderer therefore gains
 * nothing it could not already reach.
 */

const ALLOWED_HOSTS = new Set(
  (process.env.QUINCKLE_API_HOSTS || 'api.quinckle.com,main.quinckle.com')
    .split(',').map((h) => h.trim()).filter(Boolean),
);

/** Requests that hang forever would wedge a till mid-service. */
const TIMEOUT_MS = 30_000;

/** Headers the renderer may not set — these belong to the transport. */
const FORBIDDEN = new Set(['host', 'origin', 'referer', 'cookie', 'content-length', 'connection']);

function assertAllowed(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('HTTP_BAD_URL');
  }
  // localhost over http is permitted so a desktop build can be pointed at a
  // backend running on the same machine during development.
  const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(isLocal && url.protocol === 'http:')) {
    throw new Error('HTTP_INSECURE_URL');
  }
  if (!ALLOWED_HOSTS.has(url.hostname) && !isLocal) throw new Error('HTTP_HOST_NOT_ALLOWED');
  return url;
}

async function request({ url, method = 'GET', headers = {}, body } = {}) {
  assertAllowed(url);

  const safeHeaders = {};
  for (const [name, value] of Object.entries(headers || {})) {
    if (!FORBIDDEN.has(String(name).toLowerCase())) safeHeaders[name] = String(value);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method,
      headers: safeHeaders,
      body: body ?? undefined,
      redirect: 'follow',
      signal: controller.signal,
    });

    // A redirect that left the allowlist means we are no longer talking to the
    // backend; do not hand the renderer that body.
    assertAllowed(res.url || url);

    const outHeaders = {};
    res.headers.forEach((value, name) => { outHeaders[name] = value; });

    return {
      status: res.status,
      statusText: res.statusText,
      headers: outHeaders,
      // Bytes rather than text, so JSON and any binary payload both survive.
      body: new Uint8Array(await res.arrayBuffer()),
    };
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error('HTTP_TIMEOUT');
    // Keep the shape the app already understands for a dead network.
    throw new Error(err?.message || 'HTTP_FAILED');
  } finally {
    clearTimeout(timer);
  }
}

function register(ipcMain) {
  ipcMain.handle('http:request', async (_event, arg) => {
    try {
      return { ok: true, value: await request(arg) };
    } catch (err) {
      return { ok: false, error: err?.message || 'HTTP_FAILED' };
    }
  });
}

module.exports = { register, request, ALLOWED_HOSTS };
