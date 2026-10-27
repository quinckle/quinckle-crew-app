/**
 * OrderPlacedCurtain — full-panel reveal for the desktop table panel right
 * after an order is placed from it (order-menu's isWide
 * router.back() path; see services/orderPlacedSignal.ts). TableDetailScreen
 * is already mounted underneath, fetching its own data, while this plays on
 * top: a green "confirming" beat, a checkmark, then the sheet lifts away
 * like a curtain going up, revealing the order details that were already
 * sitting there the whole time. Self-contained — mounts, plays once, calls
 * onDone, the parent unmounts it.
 */

import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { QuinckleColors, Spacing, Typography } from '../../constants/Colors';

const LOADING_MS = 360;
const CHECK_HOLD_MS = 430;
const LIFT_MS = 380;
// Slides well past any realistic panel height — no need to measure it.
const LIFT_DISTANCE = 1200;

export function OrderPlacedCurtain({
  onDone,
  label = 'Order placed',
  // The action (e.g. a handover that already round-tripped the network) can
  // be done before this even mounts — skip the loading beat and go straight
  // to the checkmark instead of faking a wait for something already true.
  skipLoading = false,
}: {
  onDone: () => void;
  label?: string;
  skipLoading?: boolean;
}) {
  const [phase, setPhase] = useState<'loading' | 'check'>(skipLoading ? 'check' : 'loading');
  const checkScale = useRef(new Animated.Value(skipLoading ? 1 : 0.4)).current;
  const lift = useRef(new Animated.Value(0)).current; // 0 = covering, 1 = lifted clear

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const scheduleLift = (delay: number) => {
      timers.push(setTimeout(() => {
        Animated.timing(lift, {
          toValue: 1, duration: LIFT_MS, easing: Easing.in(Easing.cubic), useNativeDriver: true,
        }).start(({ finished }) => { if (finished) onDone(); });
      }, delay));
    };
    if (skipLoading) {
      Animated.spring(checkScale, { toValue: 1, friction: 5, tension: 140, useNativeDriver: true }).start();
      scheduleLift(CHECK_HOLD_MS);
    } else {
      timers.push(setTimeout(() => {
        setPhase('check');
        Animated.spring(checkScale, { toValue: 1, friction: 5, tension: 140, useNativeDriver: true }).start();
      }, LOADING_MS));
      scheduleLift(LOADING_MS + CHECK_HOLD_MS);
    }
    return () => timers.forEach(clearTimeout);
    // Plays once per mount — the parent mounts a fresh instance per reveal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const translateY = lift.interpolate({ inputRange: [0, 1], outputRange: [0, -LIFT_DISTANCE] });

  return (
    <Animated.View style={[styles.curtain, { transform: [{ translateY }] }]} pointerEvents="none">
      {phase === 'loading' ? (
        <ActivityIndicator color="#fff" size="large" />
      ) : (
        <Animated.View style={[styles.checkBadge, { transform: [{ scale: checkScale }] }]}>
          <Ionicons name="checkmark" size={30} color={QuinckleColors.success} />
        </Animated.View>
      )}
      <Text style={styles.label}>{phase === 'loading' ? 'Placing order…' : label}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  curtain: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: QuinckleColors.success,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    zIndex: 10,
  },
  checkBadge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { ...Typography.bodyStrong, color: '#fff' },
});
