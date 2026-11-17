/**
 * Spoken new-order alerts ("New takeaway order received").
 *
 * Per DEVICE, not per staff member: a floor phone near the pass may want the
 * voice while the cashier's phone beside it stays quiet, whoever is logged in.
 * Off by default, so a phone behaves exactly as before until someone opts in.
 *
 * Pre-recorded clips, not on-device TTS: they ship in an OTA (no new native
 * module) and sound identical on every phone, cheap Androids included.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { normalizeChannel, type Channel } from '../constants/channel';
import { play } from './sound';

export type VoiceAlertSetting = 'off' | 'female' | 'male';

const KEY_VOICE_ALERTS = 'voiceAlerts';

const CLIPS: Record<Exclude<VoiceAlertSetting, 'off'>, Record<Channel, number>> = {
  female: {
    DINE_IN: require('../assets/audio/voice/en_female_dine_in.mp3'),
    TAKEAWAY: require('../assets/audio/voice/en_female_takeaway.mp3'),
    DELIVERY: require('../assets/audio/voice/en_female_delivery.mp3'),
  },
  male: {
    DINE_IN: require('../assets/audio/voice/en_male_dine_in.mp3'),
    TAKEAWAY: require('../assets/audio/voice/en_male_takeaway.mp3'),
    DELIVERY: require('../assets/audio/voice/en_male_delivery.mp3'),
  },
};

// A burst of orders gets one line, not a pile-up of overlapping clips.
const MIN_GAP_MS = 2500;
// Realtime pushes and list refreshes both report the same order; say it once.
const MAX_REMEMBERED = 200;

let _setting: VoiceAlertSetting = 'off';
let _lastSpokenAt = 0;
const _spokenOrderIds = new Set<string>();

const _loaded = (async () => {
  try {
    const stored = await AsyncStorage.getItem(KEY_VOICE_ALERTS);
    if (stored === 'female' || stored === 'male') _setting = stored;
  } catch { /* stays off */ }
})();

export async function getVoiceAlertSetting(): Promise<VoiceAlertSetting> {
  await _loaded;
  return _setting;
}

export async function setVoiceAlertSetting(value: VoiceAlertSetting): Promise<void> {
  _setting = value;
  try {
    await AsyncStorage.setItem(KEY_VOICE_ALERTS, value);
  } catch { /* in-memory value still applies this session */ }
}

/**
 * True for a new-order notification this phone already speaks aloud, so the
 * foreground handler can show the banner without its sound talking over the
 * voice. Backend pushes carry `type: 'new_order'`; the crew-placed fallback
 * push (crew/orders.service) only has its "🛎 New Order/Takeaway" title.
 */
export function isSpokenNewOrderNotification(content: { title?: string | null; data?: unknown }): boolean {
  if (_setting === 'off') return false;
  const data = content.data as { type?: unknown } | null | undefined;
  return data?.type === 'new_order' || /^🛎 New (Order|Takeaway)/.test(content.title ?? '');
}

/** Plays the dine-in line in the given voice — the settings preview. */
export function previewVoice(voice: Exclude<VoiceAlertSetting, 'off'>): void {
  void play(CLIPS[voice].DINE_IN);
}

/**
 * Announces new orders in this device's chosen voice.
 *
 * Returns false when voice alerts are off, so the caller plays its usual
 * chime instead. Returns true when voice is on — including when the line was
 * skipped as a repeat — so the chime never doubles up on a voice phone.
 *
 * Mixed channels: dine-in wins, then takeaway, then delivery.
 *
 * `quiet` records the orders as already announced without speaking — for the
 * list the app finds on open, which is not news to anyone.
 */
export function announceNewOrders(
  orders: { id?: string | null; channel?: unknown }[],
  opts: { quiet?: boolean } = {},
): boolean {
  if (_setting === 'off') return false;

  const fresh = orders.filter(o => !o.id || !_spokenOrderIds.has(o.id));
  for (const o of fresh) if (o.id) _spokenOrderIds.add(o.id);
  if (_spokenOrderIds.size > MAX_REMEMBERED) {
    const overflow = _spokenOrderIds.size - MAX_REMEMBERED;
    let i = 0;
    for (const id of _spokenOrderIds) {
      if (i++ >= overflow) break;
      _spokenOrderIds.delete(id);
    }
  }
  if (fresh.length === 0 || opts.quiet) return true;

  const now = Date.now();
  if (now - _lastSpokenAt < MIN_GAP_MS) return true;
  _lastSpokenAt = now;

  const channels = new Set(fresh.map(o => normalizeChannel(o.channel)));
  const channel: Channel = channels.has('DINE_IN') ? 'DINE_IN' : channels.has('TAKEAWAY') ? 'TAKEAWAY' : 'DELIVERY';
  void play(CLIPS[_setting][channel]);
  return true;
}
