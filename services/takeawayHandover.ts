/**
 * "Hand over after payment" for takeaway collects.
 *
 * Per DEVICE, like voice alerts. ON by default (2026-11-20, owner's call:
 * most counter takeaways are paid and handed over in one go). A phone whose
 * takeaways wait on the kitchen switches it off once and keeps that — note a
 * handed-over order is marked served and leaves the kitchen queue at once.
 * Only an explicit choice is stored, so a never-touched phone follows this
 * default.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_HANDOVER_ON_COLLECT = 'takeawayHandoverOnCollect';

const DEFAULT_ON = true;

let _enabled = DEFAULT_ON;

const _loaded = (async () => {
  try {
    const stored = await AsyncStorage.getItem(KEY_HANDOVER_ON_COLLECT);
    _enabled = stored === null ? DEFAULT_ON : stored === '1';
  } catch { /* keeps the default */ }
})();

export async function getHandoverOnCollect(): Promise<boolean> {
  await _loaded;
  return _enabled;
}

export async function setHandoverOnCollect(value: boolean): Promise<void> {
  _enabled = value;
  try {
    await AsyncStorage.setItem(KEY_HANDOVER_ON_COLLECT, value ? '1' : '0');
  } catch { /* in-memory value still applies this session */ }
}
