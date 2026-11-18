/**
 * What staff see while a pushed (OTA) update installs.
 *
 * Before this, the app downloaded silently and then reloaded — the screen went
 * blank for a moment and the app reopened, which looked like a crash. Now:
 *   • downloading → full-screen "Updating Quinckle Crew" with a progress bar
 *   • restarting  → "Almost done…", then the native reload screen takes over
 *   • after boot  → a short "Quinckle Crew updated" toast
 * Phases come from services/otaUpdate.ts. Mounted once, above everything, in
 * the root layout.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Updates from 'expo-updates';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { QuinckleColors, Radius, Spacing, Typography } from '@/constants/Colors';
import { JUST_UPDATED_KEY, useOtaPhase } from '@/services/otaUpdate';

const LOGO = require('@/assets/images/logo/quinckle crew logo dark.webp');
/** A toast older than this belongs to some other launch — don't show it. */
const TOAST_FRESH_MS = 3 * 60_000;

export function OtaUpdateOverlay() {
  const phase = useOtaPhase();
  const { downloadProgress } = Updates.useUpdates();
  const visible = phase !== 'idle';

  const fade = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (visible) setMounted(true);
    Animated.timing(fade, { toValue: visible ? 1 : 0, duration: 220, useNativeDriver: true }).start(({ finished }) => {
      if (finished && !visible) setMounted(false);
    });
  }, [visible, fade]);

  return (
    <>
      {mounted && (
        <Animated.View style={[StyleSheet.absoluteFill, styles.screen, { opacity: fade }]} pointerEvents={visible ? 'auto' : 'none'}>
          <Image source={LOGO} style={styles.logo} resizeMode="contain" />
          <Text style={styles.title}>{phase === 'restarting' ? 'Almost done…' : 'Updating Quinckle Crew'}</Text>
          <Text style={styles.body}>
            {phase === 'restarting'
              ? 'Opening the new version.'
              : 'Getting the latest version. This takes a few seconds — please keep the app open.'}
          </Text>
          <ProgressBar progress={phase === 'restarting' ? 1 : downloadProgress} />
          <Text style={styles.note}>Your data is safe. Nothing you saved is affected.</Text>
        </Animated.View>
      )}
      <UpdatedToast />
    </>
  );
}

/** Real progress when the native side reports it; a sweeping bar until then. */
function ProgressBar({ progress }: { progress?: number }) {
  const [w, setW] = useState(0);
  const sweep = useRef(new Animated.Value(0)).current;
  const known = typeof progress === 'number' && progress > 0;

  useEffect(() => {
    if (known) return;
    const loop = Animated.loop(
      Animated.timing(sweep, { toValue: 1, duration: 1100, easing: Easing.inOut(Easing.ease), useNativeDriver: true })
    );
    loop.start();
    return () => {
      loop.stop();
      sweep.setValue(0);
    };
  }, [known, sweep]);

  return (
    <View style={styles.track} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
      {known ? (
        <View style={[styles.fill, { width: `${Math.round(Math.min(1, progress!) * 100)}%` }]} />
      ) : (
        <Animated.View
          style={[
            styles.fill,
            { width: '35%', transform: [{ translateX: sweep.interpolate({ inputRange: [0, 1], outputRange: [-w * 0.35, w] }) }] },
          ]}
        />
      )}
    </View>
  );
}

/** "Quinckle Crew updated" for a few seconds after the app reopens on a new version. */
function UpdatedToast() {
  const insets = useSafeAreaInsets();
  const [show, setShow] = useState(false);
  const y = useRef(new Animated.Value(-80)).current;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    AsyncStorage.getItem(JUST_UPDATED_KEY)
      .then((v) => {
        if (!v) return;
        void AsyncStorage.removeItem(JUST_UPDATED_KEY);
        if (Date.now() - Number(v) > TOAST_FRESH_MS) return;
        setShow(true);
        Animated.spring(y, { toValue: 0, useNativeDriver: true, damping: 18 }).start();
        timer = setTimeout(() => {
          Animated.timing(y, { toValue: -80, duration: 250, useNativeDriver: true }).start(() => setShow(false));
        }, 3500);
      })
      .catch(() => {});
    return () => timer && clearTimeout(timer);
  }, [y]);

  if (!show) return null;
  return (
    <Animated.View pointerEvents="none" style={[styles.toast, { top: insets.top + Spacing.sm, transform: [{ translateY: y }] }]}>
      <Ionicons name="checkmark-circle" size={18} color={QuinckleColors.success} />
      <Text style={styles.toastText}>Quinckle Crew updated — you are on the latest version</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  screen: {
    zIndex: 9999,
    elevation: 9999,
    backgroundColor: QuinckleColors.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xxl,
  },
  logo: { width: 180, height: 56, marginBottom: Spacing.xxl },
  title: { ...Typography.bodyStrong, fontSize: 20, color: QuinckleColors.textPrimary, textAlign: 'center' },
  body: { ...Typography.caption, color: QuinckleColors.textSecondary, textAlign: 'center', marginTop: Spacing.sm, lineHeight: 19 },
  track: {
    alignSelf: 'stretch',
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: QuinckleColors.borderSubtle,
    overflow: 'hidden',
    marginTop: Spacing.xl,
    marginHorizontal: Spacing.xl,
  },
  fill: { height: '100%', borderRadius: Radius.pill, backgroundColor: QuinckleColors.primary },
  note: { ...Typography.micro, color: QuinckleColors.textMuted, textAlign: 'center', marginTop: Spacing.lg },
  toast: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    zIndex: 9999,
    elevation: 9999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: QuinckleColors.successBorder,
    backgroundColor: QuinckleColors.surface,
  },
  toastText: { ...Typography.caption, color: QuinckleColors.textPrimary, flexShrink: 1 },
});
