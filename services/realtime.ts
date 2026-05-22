// Realtime layer for the crew app — pure Ably push, no polling.
//
// Key design: one Ably Realtime connection per unique channel name, shared
// across all subscribeChannel calls on that channel. This means:
//
//   7 × subscribeChannel(`waiter:${id}`, ...) → 1 Ably connection
//   3 × subscribeChannel(`kitchen:${id}`, ...) → 1 Ably connection
//
// Without this pool, each call opened its own connection, burning through
// Ably's free-tier 200-connection limit at ~12 connections per open screen.

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
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		return require('ably');
	} catch {
		return null;
	}
}

// ── Shared channel pool ──────────────────────────────────────────────────────

interface PoolEntry {
	client: any;     // Ably.Realtime instance
	channel: any;    // Ably channel object
	refCount: number; // active subscription count; client closes when 0
}

const pool = new Map<string, PoolEntry>();
// In-flight connection promises so concurrent subscribes wait rather than
// each starting their own connection.
const poolInit = new Map<string, Promise<PoolEntry | null>>();

async function getOrCreateEntry(channelName: string): Promise<PoolEntry | null> {
	// Already connected — return immediately
	const existing = pool.get(channelName);
	if (existing) return existing;

	// Another call already started connecting — wait for it
	const inflight = poolInit.get(channelName);
	if (inflight) return inflight;

	const promise = (async (): Promise<PoolEntry | null> => {
		try {
			const Ably = await loadAbly();
			if (!Ably) return null;
			const Realtime = Ably.Realtime ?? Ably.default?.Realtime;
			if (!Realtime) return null;

			const tokenRequest = await fetchTokenRequest(channelName);

			const client = new Realtime({
				authCallback: (_data: any, cb: (err: Error | null, t: unknown) => void) => {
					fetchTokenRequest(channelName)
						.then((t) => cb(null, t))
						.catch((err) => cb(err as Error, null));
				},
				token: tokenRequest as any,
			});

			const channel = client.channels.get(channelName);
			const entry: PoolEntry = { client, channel, refCount: 0 };
			pool.set(channelName, entry);
			return entry;
		} catch {
			return null;
		} finally {
			poolInit.delete(channelName);
		}
	})();

	poolInit.set(channelName, promise);
	return promise;
}

function releaseEntry(channelName: string, entry: PoolEntry): void {
	entry.refCount -= 1;
	if (entry.refCount <= 0) {
		pool.delete(channelName);
		try { entry.client?.close?.(); } catch { /* non-fatal */ }
	}
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Subscribe to a single event on a channel.
 *
 * Reuses a shared Ably connection for the channel — calling this 7 times on
 * `waiter:xxx` still opens only 1 connection.
 *
 * Returns an unsubscribe function. Call it in useEffect cleanup.
 */
export function subscribeChannel(
	channelName: string,
	eventName: string,
	handler: (data: any) => void,
): () => void {
	// Cleanup fn set by the async block once the subscription is live.
	// If the component unmounts before async completes, isCancelled = true
	// and the async block calls cleanupFn itself.
	let isCancelled = false;
	let cleanupFn: (() => void) | null = null;

	(async () => {
		try {
			const entry = await getOrCreateEntry(channelName);
			if (!entry) return;

			entry.refCount += 1;
			const listener = (msg: any) => handler(msg?.data);
			entry.channel.subscribe(eventName, listener);

			const doCleanup = () => {
				try { entry.channel.unsubscribe(eventName, listener); } catch { /* non-fatal */ }
				releaseEntry(channelName, entry);
			};

			if (isCancelled) {
				// Component already unmounted — clean up immediately
				doCleanup();
			} else {
				cleanupFn = doCleanup;
			}
		} catch {
			/* non-fatal — component will re-subscribe on next render if needed */
		}
	})();

	return () => {
		isCancelled = true;
		if (cleanupFn) {
			cleanupFn();
			cleanupFn = null;
		}
	};
}

/** Call on logout to close all pooled connections. */
export function disconnectRealtime(): void {
	for (const [, entry] of pool) {
		try { entry.client?.close?.(); } catch { /* non-fatal */ }
	}
	pool.clear();
	poolInit.clear();
	setRealtimeAuth(null, null);
}
