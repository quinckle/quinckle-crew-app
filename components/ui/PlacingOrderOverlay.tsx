/**
 * PlacingOrderOverlay — full-screen feedback while an order is being placed
 * from the order menu, so the wait reads as progress instead of a spinning
 * button.
 *
 * The graphic is the Orbit from the app splash: three dots circle a dashed
 * ring while the place-order call is in flight. When the server answers, the
 * dots pull into the centre and become a disc carrying the real token (or the
 * table). For Place & Collect the disc stays up, its ring turning, while the
 * payment is recorded; `done` pops a check onto it.
 *
 * Nothing here is decorative timing: every phase change comes from the caller
 * reacting to a real response. A failure clears the job, and the menu shows
 * its usual error with the cart intact.
 */

import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Modal, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { QuinckleColors, Radius, Spacing, Typography } from '../../constants/Colors';

export type PlacingOrderPhase = 'placing' | 'collecting' | 'done';

export interface PlacingOrderJob {
  phase: PlacingOrderPhase;
  title: string;
  subtitle?: string;
  /** What the disc shows once the order exists — e.g. TOKEN / TK-27, TABLE / T04. */
  disc?: { caption: string; value: string } | null;
}

/** After this long without an answer the subtitle says the connection is slow. */
const SLOW_AFTER_MS = 3000;

const SIZE = 132;
const R = SIZE / 2;
const DISC = 88;
// Lead dot plus two trailing, smaller and fainter — the splash's comet tail.
const DOTS = [
  { angle: 0, size: 14, opacity: 1 },
  { angle: 120, size: 11, opacity: 0.7 },
  { angle: 240, size: 8, opacity: 0.45 },
].map((d) => {
  const rad = (d.angle * Math.PI) / 180;
  return { ...d, x: R + R * Math.sin(rad), y: R - R * Math.cos(rad) };
});

function OrbitGraphic({ job, reduceMotion }: { job: PlacingOrderJob; reduceMotion: boolean }) {
  const spin = useRef(new Animated.Value(0)).current;
  const ringSpin = useRef(new Animated.Value(0)).current;
  const breathe = useRef(new Animated.Value(0)).current;
  const gather = useRef(new Animated.Value(0)).current; // 0 = orbiting, 1 = pulled into the centre
  const disc = useRef(new Animated.Value(0)).current;
  const check = useRef(new Animated.Value(0)).current;

  const hasOrder = job.phase !== 'placing';

  // Orbit + breathing ring while the order call is out.
  useEffect(() => {
    if (hasOrder || reduceMotion) return;
    spin.setValue(0);
    breathe.setValue(0);
    const orbit = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 1300, easing: Easing.linear, useNativeDriver: true }),
    );
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: 800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    orbit.start();
    pulse.start();
    return () => { orbit.stop(); pulse.stop(); };
  }, [hasOrder, reduceMotion, spin, breathe]);

  // Order exists: dots collapse, disc springs in carrying the token.
  useEffect(() => {
    if (!hasOrder) { gather.setValue(0); disc.setValue(0); return; }
    if (reduceMotion) { gather.setValue(1); disc.setValue(1); return; }
    Animated.sequence([
      Animated.timing(gather, { toValue: 1, duration: 380, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.spring(disc, { toValue: 1, friction: 5, tension: 140, useNativeDriver: true }),
    ]).start();
  }, [hasOrder, reduceMotion, gather, disc]);

  // Collecting payment: the ring keeps turning slowly around the disc.
  useEffect(() => {
    if (job.phase !== 'collecting' || reduceMotion) return;
    ringSpin.setValue(0);
    const loop = Animated.loop(
      Animated.timing(ringSpin, { toValue: 1, duration: 2400, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [job.phase, reduceMotion, ringSpin]);

  useEffect(() => {
    if (job.phase !== 'done') { check.setValue(0); return; }
    if (reduceMotion) { check.setValue(1); return; }
    Animated.spring(check, { toValue: 1, friction: 4, tension: 160, useNativeDriver: true }).start();
  }, [job.phase, reduceMotion, check]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const ringRotate = ringSpin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const ringScale = breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 0.94] });
  const ringOpacity = job.phase === 'done' ? 0 : 1;

  return (
    <View style={o.stage}>
      <Animated.View
        style={[o.ring, { opacity: ringOpacity, transform: [{ scale: ringScale }, { rotate: ringRotate }] }]}
      />
      <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ rotate }] }]}>
        {DOTS.map((d, i) => (
          <Animated.View
            key={i}
            style={[
              o.dot,
              {
                width: d.size,
                height: d.size,
                borderRadius: d.size / 2,
                left: d.x - d.size / 2,
                top: d.y - d.size / 2,
                opacity: gather.interpolate({ inputRange: [0, 0.8, 1], outputRange: [d.opacity, d.opacity, 0] }),
                transform: [
                  { translateX: gather.interpolate({ inputRange: [0, 1], outputRange: [0, R - d.x] }) },
                  { translateY: gather.interpolate({ inputRange: [0, 1], outputRange: [0, R - d.y] }) },
                ],
              },
            ]}
          />
        ))}
      </Animated.View>
      {job.disc && (
        <Animated.View style={[o.disc, { opacity: disc, transform: [{ scale: disc }] }]}>
          <Text style={o.discCaption}>{job.disc.caption}</Text>
          <Text style={o.discValue} numberOfLines={1} adjustsFontSizeToFit>{job.disc.value}</Text>
        </Animated.View>
      )}
      <Animated.View style={[o.check, { opacity: check, transform: [{ scale: check }] }]}>
        <Ionicons name="checkmark" size={18} color="#fff" />
      </Animated.View>
    </View>
  );
}

export function PlacingOrderOverlay({ job }: { job: PlacingOrderJob | null }) {
  const [slow, setSlow] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const phase = job?.phase;
  const active = !!job;

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion).catch(() => {});
  }, []);

  // The slow hint is about the server, so it restarts with each wait.
  useEffect(() => {
    setSlow(false);
    if (phase !== 'placing' && phase !== 'collecting') return;
    const t = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    if (phase === 'placing') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    if (phase === 'done') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  }, [phase]);

  if (!active || !job) return null;

  const subtitle = slow && job.phase !== 'done'
    ? 'Slow connection, still sending. Stay on this screen.'
    : job.subtitle;

  return (
    // Back is swallowed: leaving mid-call can't cancel an order the server may
    // already have taken.
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
      <View style={styles.backdrop}>
        <View style={styles.card} accessibilityLiveRegion="polite">
          <OrbitGraphic job={job} reduceMotion={reduceMotion} />
          <Text style={styles.title}>{job.title}</Text>
          {!!subtitle && (
            <Text style={[styles.subtitle, slow && job.phase !== 'done' && styles.subtitleSlow]}>{subtitle}</Text>
          )}
        </View>
      </View>
    </Modal>
  );
}

const o = StyleSheet.create({
  stage: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  ring: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: R,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: 'rgba(243,93,59,0.45)',
  },
  dot: {
    position: 'absolute',
    backgroundColor: QuinckleColors.primary,
  },
  disc: {
    position: 'absolute',
    width: DISC,
    height: DISC,
    borderRadius: DISC / 2,
    backgroundColor: QuinckleColors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  discCaption: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.4,
    marginBottom: 2,
  },
  discValue: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '800',
  },
  check: {
    position: 'absolute',
    right: R - DISC / 2 - 2,
    bottom: R - DISC / 2 - 2,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: QuinckleColors.success,
    borderWidth: 3,
    borderColor: QuinckleColors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xxl,
  },
  card: {
    width: '100%',
    maxWidth: 320,
    backgroundColor: QuinckleColors.surfaceElevated,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    alignItems: 'center',
    paddingVertical: Spacing.xxl,
    paddingHorizontal: Spacing.xl,
    gap: Spacing.xs,
  },
  title: {
    ...Typography.subtitle,
    color: QuinckleColors.textPrimary,
    textAlign: 'center',
  },
  subtitle: {
    ...Typography.caption,
    color: QuinckleColors.textSecondary,
    textAlign: 'center',
  },
  subtitleSlow: {
    color: QuinckleColors.primary,
  },
});
