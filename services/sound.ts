/**
 * Small shared sound-effect player (expo-av). Fire-and-forget: failures are
 * swallowed — a sound must never break a business flow.
 */

import { Audio } from 'expo-av';

async function play(file: number): Promise<void> {
  try {
    await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
    const { sound } = await Audio.Sound.createAsync(file);
    await sound.playAsync();
    sound.setOnPlaybackStatusUpdate((s) => {
      if (s.isLoaded && s.didJustFinish) void sound.unloadAsync();
    });
  } catch { /* non-fatal */ }
}

/** Ascending G5→C6→E6 chime — payment collected (UPI-soundbox style). */
export function playPaymentSuccess(): void {
  void play(require('../assets/audio/payment_success.wav'));
}
