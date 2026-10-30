/**
 * "Hand over after payment" for takeaway collects.
 *
 * Per DEVICE, like voice alerts: a counter phone that serves ready food (tea,
 * snacks) turns it on once and keeps it, while a phone whose takeaways wait on
 * the kitchen never hands anything over by surprise. Off by default — a
 * handed-over order leaves the kitchen queue at once, so a phone behaves
 * exactly as before until someone opts in.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_HANDOVER_ON_COLLECT = 'takeawayHandoverOnCollect';

let _enabled = false;

const _loaded = (async () => {
  try {
    _enabled = (await AsyncStorage.getItem(KEY_HANDOVER_ON_COLLECT)) === '1';
  } catch { /* stays off */ }
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
