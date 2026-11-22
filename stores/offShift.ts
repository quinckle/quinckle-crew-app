/**
 * offShift — is this phone's staffer off shift right now?
 *
 * When the venue ties crew alerts to the attendance station (partner app →
 * Settings → Attendance), clocking OUT at the station puts the phone "off
 * shift": the backend stops sending it order / call / payment pushes, and this
 * store tells the app to keep quiet too — no sounds, voice lines, banners or
 * Call Staff rings from the live Ably feed while it's open. Clocking IN brings
 * everything back. The backend decides; this only mirrors GET /api/crew/me/shift.
 *
 * Fails open: until the first answer, and on any error, the phone is ON shift.
 */

import { useSyncExternalStore } from 'react';
import { crewMyShift, type MyShift } from '../services/api';

const ON_SHIFT: MyShift = { followsAttendance: false, onShift: true, since: null, alertsMuted: false };

let state: MyShift = ON_SHIFT;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

function getSnapshot() {
  return state;
}

/** React hook: this phone's current shift state. */
export function useOffShift(): MyShift {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** For non-React code (notification handler, sound helpers): stay quiet? */
export function alertsMuted(): boolean {
  return state.alertsMuted;
}

let inFlight: Promise<void> | null = null;

/** Re-read the shift state from the backend. Keeps the last answer on error. */
export function refreshOffShift(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const res = await crewMyShift.get();
      if (res?.success && res.data) {
        const next = res.data;
        if (
          next.alertsMuted !== state.alertsMuted
          || next.onShift !== state.onShift
          || next.followsAttendance !== state.followsAttendance
          || next.since !== state.since
        ) {
          state = next;
          emit();
        }
      }
    } catch {
      // Older backend (404) or offline: keep what we had — ON shift by default.
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Forget the state on logout so the next person starts on shift. */
export function resetOffShift(): void {
  state = ON_SHIFT;
  emit();
}
