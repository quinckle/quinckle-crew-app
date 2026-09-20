/**
 * HTTP client — desktop (Electron) and web.
 *
 * Why this exists: the backend keeps an explicit CORS allowlist of website
 * origins, and a desktop window's origin is `app://local`, which is not one.
 * Chromium therefore discards every API response before the app sees it, which
 * the app reports as "Could not connect to server" — even though the request
 * succeeded and the server answered.
 *
 * The fix is to stop being a browser. In the Electron shell the request is
 * performed by the MAIN process, which is a native HTTP client and not subject
 * to CORS at all — the same position the Android app is in. Nothing is
 * bypassed or relaxed: no header is rewritten, and the backend's allowlist
 * keeps protecting actual websites exactly as before.
 *
 * Outside Electron (a plain browser tab) this falls back to the real fetch, so
 * the web build behaves normally.
 *
 * Ably is unaffected either way — its realtime transport is a WebSocket, which
 * CORS does not apply to. Only the token call goes through here.
 */

interface HttpBridge {
  request: (req: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
  }) => Promise<{
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: Uint8Array;
  }>;
}

function bridge(): HttpBridge | null {
  const q = (globalThis as any)?.quinckle;
  return q?.isDesktop && q.http ? (q.http as HttpBridge) : null;
}

/** Normalise the handful of RequestInit shapes this app actually uses. */
function toHeaders(init?: RequestInit): Record<string, string> {
  const out: Record<string, string> = {};
  const h = init?.headers;
  if (!h) return out;
  if (typeof Headers !== 'undefined' && h instanceof Headers) {
    h.forEach((value, key) => { out[key] = value; });
  } else if (Array.isArray(h)) {
    for (const [key, value] of h) out[key] = String(value);
  } else {
    for (const [key, value] of Object.entries(h as Record<string, string>)) out[key] = String(value);
  }
  return out;
}

export const httpFetch: typeof fetch = async (input, init) => {
  const b = bridge();
  if (!b) return fetch(input, init);

  const url = typeof input === 'string'
    ? input
    : input instanceof URL ? input.toString() : (input as Request).url;

  // The app only ever sends string bodies (JSON.stringify). Anything else is
  // handed to the real fetch rather than silently mangled.
  const body = init?.body;
  if (body != null && typeof body !== 'string') return fetch(input, init);

  const res = await b.request({
    url,
    method: (init?.method ?? 'GET').toUpperCase(),
    headers: toHeaders(init),
    body: body ?? undefined,
  });

  // A real Response, so callers keep using res.ok / res.status /
  // res.headers.get('content-type') / res.json() with no desktop branch.
  // Constructing a Response with a body is illegal for the null-body statuses
  // and throws a TypeError, so those pass null (a DELETE returning 204 does
  // reach here).
  const nullBody = res.status === 101 || res.status === 204 || res.status === 205 || res.status === 304;
  // Response wants an ArrayBuffer, not a view over one — slice to the exact
  // bytes so a pooled buffer can never leak trailing data into the body.
  const bytes = res.body;
  const buffer = nullBody
    ? null
    : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

  return new Response(buffer, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
};
