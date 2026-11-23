/**
 * openSheets — how many BottomSheets are on screen right now.
 *
 * BottomSheet is drawn inside the screen, but a few overlays (the Off shift
 * pill) are drawn by the layout above every screen, so they would float over
 * an open sheet. Those overlays read this and step aside while any sheet is
 * mounted, including its closing animation.
 */

import { useSyncExternalStore } from 'react';

let count = 0;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

function getSnapshot() {
  return count > 0;
}

/** Call when a sheet mounts; call the returned function when it unmounts. */
export function registerOpenSheet(): () => void {
  count += 1;
  emit();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    count = Math.max(0, count - 1);
    emit();
  };
}

/** React hook: is any BottomSheet on screen? */
export function useAnySheetOpen(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
