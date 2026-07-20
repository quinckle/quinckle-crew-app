/**
 * itemReadyToast — a tiny global store for the DUAL_CHANNEL "item ready" cards.
 *
 * Why this exists: the toast is produced by the staff floor screen
 * (`app/(staff)/index.tsx`, which diffs the pickup list to detect items the
 * kitchen just marked done), but it must stay VISIBLE on every staff route —
 * including the table-detail screen the steward taps into to serve. Those are
 * separate native screens in a Stack navigator, so a card rendered *inside*
 * index is trapped behind whatever screen is pushed on top of it (no z-index
 * can lift a view above a sibling native screen).
 *
 * The fix: index stays the *producer* (detection logic unchanged), but the
 * card is *rendered* once at the staff layout level, above the whole Stack, by
 * subscribing to this store. No external state lib — a module-level list with
 * useSyncExternalStore is all this needs.
 */

import { useSyncExternalStore } from 'react';
import type { ReadyToast } from '../components/ui/ItemReadyToast';

let toasts: ReadyToast[] = [];
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

function getSnapshot() {
  return toasts;
}

/** React hook: the current list of item-ready cards. */
export function useItemReadyToasts() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Navigation params captured for a table at the moment its card is raised. */
export interface ReadyNav {
  sessionId?: string | null;
  tableDbId?: string | null;
}

/**
 * Coalesce newly-ready items onto each table's card (creating the card if the
 * table has none yet, bumping the count + re-arming its auto-expire otherwise),
 * then drop any card whose table is no longer active. Mirrors the old in-index
 * setReadyToasts logic exactly.
 */
export function addReady(
  readyByTable: Map<number, number>,
  navByTable: Map<number, ReadyNav>,
  activeTables: Set<number>,
) {
  const map = new Map(toasts.map(t => [t.tableNumber, t]));
  for (const [tableNumber, added] of readyByTable) {
    const ex = map.get(tableNumber);
    const nav = navByTable.get(tableNumber);
    map.set(tableNumber, ex
      ? { ...ex, count: ex.count + added, nonce: ex.nonce + 1, ...nav }
      : { tableNumber, count: added, nonce: 0, sessionId: nav?.sessionId ?? null, tableDbId: nav?.tableDbId ?? null });
  }
  toasts = [...map.values()].filter(t => activeTables.has(t.tableNumber));
  emit();
}

/** Prune cards for tables that are no longer active. No re-render if unchanged. */
export function pruneToActive(activeTables: Set<number>) {
  if (toasts.length === 0) return;
  const next = toasts.filter(t => activeTables.has(t.tableNumber));
  if (next.length === toasts.length) return;
  toasts = next;
  emit();
}

/** Remove one table's card (tap-through or swipe-dismiss). */
export function dismissReady(tableNumber: number) {
  const next = toasts.filter(t => t.tableNumber !== tableNumber);
  if (next.length === toasts.length) return;
  toasts = next;
  emit();
}

/** Drop every card (e.g. on logout / role switch). */
export function clearReady() {
  if (toasts.length === 0) return;
  toasts = [];
  emit();
}
