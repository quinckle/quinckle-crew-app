import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { watchConnection } from '../services/realtime';

// A shorter trip away is a glance at another app. The socket usually survives
// it, and when it doesn't, the reconnect trigger below still fires.
const MIN_AWAY_MS = 30_000;
// Coming back to the foreground and the socket reconnecting land within about
// a second of each other; one reload covers both.
const COALESCE_MS = 1_000;

/**
 * Reload a screen's data whenever it may have missed live events.
 *
 * Screens load once on mount and then rely on Ably pushes. Any event
 * published while the phone was locked, backgrounded or between networks is
 * lost once Ably can't resume the connection, and nothing reloaded
 * afterwards — the floor stayed stale until someone pulled to refresh or
 * restarted the app. This fires `onResync` when the app returns to the
 * foreground after MIN_AWAY_MS, and when `channelName`'s socket reconnects
 * after a drop.
 *
 * Event-driven, not a poll: an idle, open app never calls the server.
 */
export function useResyncOnReturn(channelName: string | null, onResync: () => void): void {
  // Latest callback without re-subscribing when a screen passes an inline one.
  const onResyncRef = useRef(onResync);
  useEffect(() => { onResyncRef.current = onResync; });

  useEffect(() => {
    if (!channelName) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; onResyncRef.current(); }, COALESCE_MS);
    };

    let backgroundedAt: number | null = null;
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        backgroundedAt = Date.now();
      } else if (state === 'active') {
        if (backgroundedAt !== null && Date.now() - backgroundedAt >= MIN_AWAY_MS) schedule();
        backgroundedAt = null;
      }
    });

    // The first connect is covered by the screen's mount load; only a connect
    // that follows a drop can have missed anything.
    let hasConnected = false;
    let dropped = false;
    const unwatchConn = watchConnection(channelName, (connected) => {
      if (connected) {
        if (hasConnected && dropped) schedule();
        hasConnected = true;
        dropped = false;
      } else if (hasConnected) {
        dropped = true;
      }
    });

    return () => {
      if (timer) clearTimeout(timer);
      appStateSub.remove();
      unwatchConn();
    };
  }, [channelName]);
}
