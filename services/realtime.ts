// Realtime layer for the crew app (hybrid with polling).
//
// Polling every 5s is still the source of truth — it never misses an event
// even after reconnects / app suspensions. This Ably layer fires the
// kitchen/waiter notification sound the *instant* the backend publishes,
// instead of waiting up to 5s for the next poll.
//
// Design: one Ably Realtime instance per (channel) subscription. The backend's
// `/api/v1/realtime/token` endpoint scopes a token request to one channel, so
// we keep it dead simple and create a fresh client per channel. Cook subscribes
// to `kitchen:{restaurantId}`, waiter to `waiter:{restaurantId}` — each role
// only needs one channel.

import { API_BASE_URL } from '../constants/env';

let _crewToken: string | null = null;
let _clientId: string | null = null;

export function setRealtimeAuth(crewToken: string | null, clientId: string | null): void {
	_crewToken = crewToken;
	_clientId = clientId;
}

async function fetchTokenRequest(channel: string): Promise<unknown> {
	if (!_crewToken || !_clientId) throw new Error('REALTIME_NOT_AUTHED');
	const res = await fetch(`${API_BASE_URL}/api/v1/realtime/token`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${_crewToken}` },
		body: JSON.stringify({ channel, clientId: _clientId }),
	});
	if (!res.ok) throw new Error(`REALTIME_TOKEN_${res.status}`);
	const body = await res.json();
	return body?.data?.tokenRequest ?? body?.tokenRequest;
}

async function loadAbly(): Promise<any> {
	try {
		// Dynamic require so a missing dependency (fresh checkout, no
		// `npm install` yet) doesn't crash the app — the cook/waiter just
		// fall back to polling-only.
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		return require('ably');
	} catch {
		return null;
	}
}

/**
 * Subscribe to a single Ably event on a channel. Returns an unsubscribe fn.
 *
 * Best-effort: returns a no-op if `ably` isn't installed or the auth handshake
 * fails. The caller's poll loop is still running, so we degrade gracefully.
 */
export function subscribeChannel(
	channelName: string,
	eventName: string,
	handler: (data: any) => void,
): () => void {
	let cancelled = false;
	let client: any = null;
	let channel: any = null;
	let listener: any = null;

	(async () => {
		try {
			const Ably = await loadAbly();
			if (!Ably || cancelled) return;

			const Realtime = Ably.Realtime ?? Ably.default?.Realtime;
			if (!Realtime) return;

			const tokenRequest = await fetchTokenRequest(channelName);
			if (cancelled) return;

			client = new Realtime({
				authCallback: (_data: any, cb: (err: Error | null, t: unknown) => void) => {
					// Re-fetch on token refresh — handshake might happen more than once
					// over the lifetime of the connection.
					fetchTokenRequest(channelName)
						.then((t) => cb(null, t))
						.catch((err) => cb(err as Error, null));
				},
				token: tokenRequest as any,
			});

			channel = client.channels.get(channelName);
			listener = (msg: any) => handler(msg?.data);
			channel.subscribe(eventName, listener);
		} catch {
			/* non-fatal — polling fallback covers us */
		}
	})();

	return () => {
		cancelled = true;
		try {
			if (channel && listener) channel.unsubscribe(eventName, listener);
		} catch {
			/* non-fatal */
		}
		try {
			client?.close?.();
		} catch {
			/* non-fatal */
		}
	};
}

export function disconnectRealtime(): void {
	setRealtimeAuth(null, null);
}
