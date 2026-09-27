/**
 * Starts a manual (counter/phone) takeaway session in the background, the same
 * idea as tableSessionStart.ts but for the '+' button on the Takeaway tab.
 *
 * Tapping '+' used to block on the create-session POST before the menu even
 * opened. Now the tap goes straight to the order menu — which never needed the
 * session to browse the menu or build a cart, only to preview the bill, adjust
 * it, or place the order — and the menu reads this module's progress once it
 * lands.
 *
 * Single-slot, not keyed like a table's: only one manual takeaway start can be
 * in flight from this device at a time (the '+' button is debounced against a
 * double tap the same way the table grid is), so there is nothing to key it by.
 */

import { useCallback, useSyncExternalStore } from 'react';
import { crewTakeaway } from './api';

export type TakeawaySessionState =
  | { phase: 'starting' }
  | { phase: 'ready'; sessionId: string; sessionRef: string | null }
  | { phase: 'failed'; message: string };

type Entry = { state: TakeawaySessionState; promise: Promise<{ sessionId: string; sessionRef: string | null }> };

let entry: Entry | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((cb) => cb());
}

function setEntry(next: Entry) {
  entry = next;
  emit();
}

async function run(): Promise<{ sessionId: string; sessionRef: string | null }> {
  const res = await crewTakeaway.createSession();
  const d = res.data;
  return { sessionId: d.session_id, sessionRef: d.session_ref ?? null };
}

/**
 * Begin a manual takeaway start. Resolves with the session id; a failure is
 * also recorded as state, so callers that only render the state can ignore
 * the rejection.
 */
export function startTakeawaySession(): Promise<{ sessionId: string; sessionRef: string | null }> {
  if (entry?.state.phase === 'starting') return entry.promise;

  const promise = run().then(
    (result) => {
      setEntry({ state: { phase: 'ready', ...result }, promise });
      return result;
    },
    (e: any) => {
      setEntry({ state: { phase: 'failed', message: e?.message ?? 'Could not start the order. Try again.' }, promise });
      throw e;
    },
  );
  // Rejections are surfaced through state; without this an unhandled-rejection
  // warning fires for callers that only watch the state.
  promise.catch(() => {});

  setEntry({ state: { phase: 'starting' }, promise });
  return promise;
}

/** Run the same start again after a failure. */
export function retryTakeawaySession(): Promise<{ sessionId: string; sessionRef: string | null }> {
  return startTakeawaySession();
}

export function isTakeawaySessionStarting(): boolean {
  return entry?.state.phase === 'starting';
}

/**
 * Resolves with the session id once it exists; rejects if the start failed.
 *
 * No entry means this module's memory was wiped while the menu was open — a
 * page reload, hot reload or app restart — because the route survives that
 * and the in-memory record does not. Start again: a fresh session is the
 * correct recovery (unlike a table, there is no existing takeaway session to
 * adopt).
 */
export function waitForTakeawaySession(): Promise<{ sessionId: string; sessionRef: string | null }> {
  return entry?.promise ?? startTakeawaySession();
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
};

const noopSubscribe = () => () => {};

/** Live state of the in-flight (or last) manual takeaway start, while `enabled`. */
export function useTakeawaySessionStart(enabled: boolean): TakeawaySessionState | undefined {
  const getSnapshot = useCallback(() => (enabled ? entry?.state : undefined), [enabled]);
  return useSyncExternalStore(enabled ? subscribe : noopSubscribe, getSnapshot, () => undefined);
}
