/**
 * Starts a table's session in the background so the screen that needs it can
 * open first.
 *
 * Opening a free table used to block on the create-session POST, then a ~1s
 * success animation, then a navigation, then a bill fetch. On desktop the tap
 * now goes straight to the order menu, which never needed the session to browse
 * or build a cart — only to preview the bill and place the order, by which time
 * this has long since finished. The menu reads its progress from here.
 *
 * One entry per table, keyed by the table's DB id. A start that is still in
 * flight is shared by every caller, so a double tap cannot POST twice. That
 * matters on shared-seating venues in particular: the server's slot index stops
 * a duplicate on single-party tables, but a second party would slip through.
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { crewSessions, crewTables } from './api';

export type TableSessionState =
  | { phase: 'starting' }
  | { phase: 'ready'; sessionId: string }
  | { phase: 'failed'; message: string };

type Entry = {
  state: TableSessionState;
  promise: Promise<string>;
  onSettled?: () => void;
};

const entries = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();

function emit(tableId: string) {
  listeners.get(tableId)?.forEach((cb) => cb());
}

function setEntry(tableId: string, entry: Entry) {
  entries.set(tableId, entry);
  emit(tableId);
}

/**
 * Another device — or a diner scanning the QR — started this table between the
 * tap and our POST. That is not a failure: the table is open, so take its
 * session. Only possible when the table has exactly one live party; with
 * several there is no way to know which one this crew member means.
 */
async function adoptExistingSession(tableId: string): Promise<string> {
  const res = await crewTables.list();
  const table = (res?.tables ?? []).find((t) => t.table_id === tableId);
  const parties = table?.groups?.length ?? (table?.session_id ? 1 : 0);
  if (table?.session_id && parties <= 1) return table.session_id;
  throw new Error('This table was just opened on another device. Open it from the table grid.');
}

const isAlreadyOccupied = (e: any) =>
  e?.code === 'TABLE_ALREADY_OCCUPIED' || String(e?.message ?? '').includes('TABLE_ALREADY_OCCUPIED');

async function run(tableId: string): Promise<string> {
  try {
    return (await crewSessions.start(tableId)).session_id;
  } catch (e: any) {
    if (isAlreadyOccupied(e)) return adoptExistingSession(tableId);
    throw e;
  }
}

/**
 * Begin (or join) the start for a table. Resolves with the session id; a failure
 * is also recorded as state, so callers that only render the state can ignore
 * the rejection.
 */
export function startTableSession(tableId: string, opts?: { onSettled?: () => void }): Promise<string> {
  const existing = entries.get(tableId);
  if (existing?.state.phase === 'starting') return existing.promise;

  const promise = run(tableId).then(
    (sessionId) => {
      setEntry(tableId, { state: { phase: 'ready', sessionId }, promise, onSettled: opts?.onSettled });
      opts?.onSettled?.();
      return sessionId;
    },
    (e: any) => {
      setEntry(tableId, {
        state: { phase: 'failed', message: e?.message ?? 'Could not open the table. Try again.' },
        promise,
        onSettled: opts?.onSettled,
      });
      throw e;
    },
  );
  // Rejections are surfaced through state; without this an unhandled-rejection
  // warning fires for callers that only watch the state.
  promise.catch(() => {});

  setEntry(tableId, { state: { phase: 'starting' }, promise, onSettled: opts?.onSettled });
  return promise;
}

/** Run the same start again after a failure. */
export function retryTableSession(tableId: string): Promise<string> {
  return startTableSession(tableId, { onSettled: entries.get(tableId)?.onSettled });
}

export function isTableSessionStarting(tableId: string): boolean {
  return entries.get(tableId)?.state.phase === 'starting';
}

/**
 * Resolves with the session id once it exists; rejects if the start failed.
 *
 * No entry means this module's memory was wiped while the menu was open — a page
 * reload, hot reload or app restart — because the route (and its pendingStart
 * flag) survives that and the in-memory record does not. Start again: the server
 * answers 409 if the earlier attempt had already landed, and that is adopted.
 */
export function waitForTableSession(tableId: string): Promise<string> {
  return entries.get(tableId)?.promise ?? startTableSession(tableId);
}

const subscribeTo = (tableId: string) => (cb: () => void) => {
  let subs = listeners.get(tableId);
  if (!subs) listeners.set(tableId, (subs = new Set()));
  subs.add(cb);
  return () => { subs!.delete(cb); };
};

const noopSubscribe = () => () => {};

/**
 * Live state of a table's background start, or undefined when `tableId` is
 * undefined or nothing has been started for it.
 */
export function useTableSessionStart(tableId: string | undefined): TableSessionState | undefined {
  const subscribe = useMemo(() => (tableId ? subscribeTo(tableId) : noopSubscribe), [tableId]);
  const getSnapshot = useCallback(() => (tableId ? entries.get(tableId)?.state : undefined), [tableId]);
  return useSyncExternalStore(subscribe, getSnapshot, () => undefined);
}
