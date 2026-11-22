/**
 * NewAppSheet — tells crew on the old 1.0 app that the new Crew app is out,
 * and sends them to quinckle.com/download/crew to install it.
 *
 * Shown on every launch and whenever the app comes back after being away for
 * a few minutes. "Not now" (or a swipe down / backdrop tap) closes it until the
 * next open. Short trips out of the app — sending a bill on WhatsApp, a phone
 * call — don't bring it back mid-service.
 *
 * Only ever renders on the 1.0 line: this file ships in OTAs for runtime
 * c85f8b34 (the 1.0.0 APK), and the version check below keeps it silent if it
 * ever reaches a 1.1+ build. OTA-safe: no new native modules.
 */

import React, { useEffect, useRef, useState } from 'react';
import { AppState, Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheet } from './BottomSheet';
import { useAuth } from '../../context/AuthContext';
import { QuinckleColors } from '../../constants/Colors';

const DOWNLOAD_URL = 'https://quinckle.com/download/crew';
/** Wait after launch so the splash and table screen settle first. */
const LAUNCH_DELAY_MS = 1200;
/** Back after at least this long in the background counts as a fresh open. */
const AWAY_MS = 5 * 60 * 1000;

const PHOTO = require('../../assets/images/new-app/crew-photo.webp');
const Q_MARK = require('../../assets/images/new-app/crew-q.png');

const isOldApp = (Constants.expoConfig?.version ?? '').startsWith('1.0');

export function NewAppSheet() {
  const { isRestoring } = useAuth();
  const [open, setOpen] = useState(false);
  const backgroundedAt = useRef<number | null>(null);

  // Every launch, once the saved sign-in has been restored.
  useEffect(() => {
    if (!isOldApp || isRestoring) return;
    const t = setTimeout(() => setOpen(true), LAUNCH_DELAY_MS);
    return () => clearTimeout(t);
  }, [isRestoring]);

  // Coming back after a real break counts as opening the app again.
  useEffect(() => {
    if (!isOldApp) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        backgroundedAt.current = Date.now();
      } else if (state === 'active' && backgroundedAt.current != null) {
        const away = Date.now() - backgroundedAt.current;
        backgroundedAt.current = null;
        if (away >= AWAY_MS) setOpen(true);
      }
    });
    return () => sub.remove();
  }, []);

  if (!isOldApp) return null;

  const download = () => {
    setOpen(false);
    Linking.openURL(DOWNLOAD_URL).catch(() => { /* no browser: nothing useful to do */ });
  };

  return (
    <BottomSheet visible={open} onClose={() => setOpen(false)} maxWidth={460}>
      <View style={styles.photoWrap}>
        <Image source={PHOTO} style={styles.photo} resizeMode="cover" />
        <LinearGradient
          colors={['rgba(20,20,22,0)', QuinckleColors.surface]}
          locations={[0.45, 1]}
          style={StyleSheet.absoluteFill}
        />
      </View>

      <View style={styles.body}>
        <View style={styles.appRow}>
          <View style={styles.icon}>
            <Image source={Q_MARK} style={styles.q} resizeMode="contain" />
          </View>
          <View>
            <Text style={styles.appName}>Quinckle Crew</Text>
            <Text style={styles.appSub}>New app · Android</Text>
          </View>
        </View>

        <Text style={styles.title}>For the hands that run the house.</Text>
        <Text style={styles.text}>
          The new Crew app is ready. Download it in a minute and pick up right where you left off.
        </Text>

        <Pressable
          onPress={download}
          style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Download the new Crew app"
        >
          <Ionicons name="download-outline" size={18} color="#fff" />
          <Text style={styles.primaryText}>Download the new app</Text>
        </Pressable>

        <Pressable
          onPress={() => setOpen(false)}
          style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <Text style={styles.secondaryText}>Not now</Text>
        </Pressable>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  photoWrap: {
    height: 172,
    marginHorizontal: 12,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: QuinckleColors.surfaceElevated,
  },
  photo: { width: '100%', height: '100%' },
  body: { paddingHorizontal: 20, marginTop: -22 },
  appRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  q: { width: 22, height: 22 },
  appName: { color: QuinckleColors.textPrimary, fontSize: 15, fontWeight: '700' },
  appSub: { color: QuinckleColors.textSecondary, fontSize: 12, marginTop: 1 },
  title: {
    color: QuinckleColors.textPrimary,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.5,
    lineHeight: 27,
    marginTop: 16,
  },
  text: { color: QuinckleColors.textSecondary, fontSize: 14, lineHeight: 20, marginTop: 6 },
  primary: {
    marginTop: 20,
    height: 50,
    borderRadius: 14,
    backgroundColor: QuinckleColors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  secondary: { height: 44, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  secondaryText: { color: QuinckleColors.textSecondary, fontSize: 14, fontWeight: '600' },
  pressed: { opacity: 0.75 },
});
