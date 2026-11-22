import { useEffect } from 'react';

import { subscribeChannel } from '../services/realtime';
import { refreshOffShift, resetOffShift } from '../stores/offShift';
import { useResyncOnReturn } from './useResyncOnReturn';

/**
 * Keep the off-shift store current while a role's screens are mounted: on
 * open, when someone clocks in or out at the station (Ably `shift_changed`),
 * and when the app comes back to the front. Event-driven, no polling.
 *
 * `channel` is the role's live channel — `waiter:<id>` or `kitchen:<id>`.
 */
export function useOffShiftSync(channel: string | null): void {
  useEffect(() => {
    if (!channel) return;
    void refreshOffShift();
    const off = subscribeChannel(channel, 'shift_changed', () => { void refreshOffShift(); });
    return () => { off(); resetOffShift(); };
  }, [channel]);

  useResyncOnReturn(channel, () => { void refreshOffShift(); });
}
