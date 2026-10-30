/**
 * Small shared sound-effect player (expo-av). Fire-and-forget: failures are
 * swallowed — a sound must never break a business flow.
 */

import { Platform } from 'react-native';
import { Audio } from 'expo-av';

export async function play(file: number): Promise<void> {
  try {
    // Without staysActiveInBackground, expo-av on Android refuses audio focus
    // once the app is minimised, so a new-order voice line pushed over Ably to
    // a backgrounded phone was silently dropped. iOS suspends JS in the
    // background anyway, so leave its audio session as it was.
    await Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: Platform.OS === 'android',
    });
    const { sound } = await Audio.Sound.createAsync(file);
    await sound.playAsync();
    sound.setOnPlaybackStatusUpdate((s) => {
      if (s.isLoaded && s.didJustFinish) void sound.unloadAsync();
    });
  } catch { /* non-fatal */ }
}

/** Warm two-note marimba tap (C5→G5) — payment collected. */
export function playPaymentSuccess(): void {
  void play(require('../assets/audio/payment_success.wav'));
}
