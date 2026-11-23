import { useEffect } from 'react';

import { subscribeChannel } from '../services/realtime';
import { refreshMyClock, resetMyClock } from '../stores/myClock';
import { refreshOffShift, resetOffShift } from '../stores/offShift';
import { useResyncOnReturn } from './useResyncOnReturn';

/**
 * Keep the off-shift and clock stores current while a role's screens are mounted: on
 * open, when someone clocks in or out at the station (Ably `shift_changed`),
 * and when the app comes back to the front. Event-driven, no polling.
 *
 * `channel` is the role's live channel — `waiter:<id>` or `kitchen:<id>`.
 */
export function useOffShiftSync(channel: string | null): void {
  useEffect(() => {
    if (!channel) return;
    const refresh = () => { void refreshOffShift(); void refreshMyClock(); };
    refresh();
    const off = subscribeChannel(channel, 'shift_changed', refresh);
    return () => { off(); resetOffShift(); resetMyClock(); };
  }, [channel]);

  useResyncOnReturn(channel, () => { void refreshOffShift(); void refreshMyClock(); });
}
