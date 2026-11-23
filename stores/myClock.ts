/**
 * myClock — this staffer's clock state for the header fingerprint icon and the
 * Attendance sheet (swipe to clock in/out from the phone).
 *
 * Mirrors GET /api/crew/me/clock. `enabled` is false until the venue turns on
 * "Clock in from phone" (and has a location), and on any error or an older
 * backend — then the icon simply doesn't show.
 */

import { useSyncExternalStore } from 'react';
import { crewMyClock, type MyClock } from '../services/api';

const OFF: MyClock = { enabled: false, clockedInSince: null, workedMinutesToday: 0, lastPunch: null };

let state: MyClock = OFF;
const listeners = new Set<() => void>();
const emit = () => { for (const l of listeners) l(); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const getSnapshot = () => state;

export function useMyClock(): MyClock {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Replace the state with a fresh answer (e.g. the POST /clock response). */
export function setMyClock(next: MyClock): void {
  state = next;
  emit();
}

let inFlight: Promise<void> | null = null;
export function refreshMyClock(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const res = await crewMyClock.get();
      if (res?.success && res.data) setMyClock(res.data);
    } catch {
      // keep the last answer
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export function resetMyClock(): void {
  state = OFF;
  emit();
}
