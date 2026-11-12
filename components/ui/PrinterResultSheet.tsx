/**
 * PrinterResultSheet — the moment after a printer is added or removed.
 *
 * Green when a printer connects (with a test print one tap away, since that's
 * what everyone does next), red when one is removed or unpaired. Replaces the
 * 3-second toast, which was easy to miss across a busy counter.
 *
 * Built on the plain Animated API (no Reanimated), so it ships over the air.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { BottomSheet } from './BottomSheet';
import { QuinckleColors, Radius, Spacing, Typography } from '../../constants/Colors';

export type PrinterResult = {
  kind: 'connected' | 'removed';
  title: string;
  /** Printer name and details, e.g. "Kitchen · 80mm · Bluetooth". */
  detail: string;
  message: string;
};

interface Props {
  visible: boolean;
  result: PrinterResult | null;
  onClose: () => void;
  /** Connected only: print a test page on the printer just added. */
  onTestPrint?: () => void;
}

const CIRCLE = 84;

export function PrinterResultSheet({ visible, result, onClose, onTestPrint }: Props) {
  const ok = result?.kind === 'connected';
  const tone = ok ? QuinckleColors.success : QuinckleColors.danger;

  const circle = useRef(new Animated.Value(0)).current;
  const ring = useRef(new Animated.Value(0)).current;
  const badge = useRef(new Animated.Value(0)).current;
  const shake = useRef(new Animated.Value(0)).current;
  const text = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible || !result) return;
    [circle, ring, badge, shake, text].forEach((v) => v.setValue(0));
    void Haptics.notificationAsync(
      ok ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning,
    );

    const pop = (v: Animated.Value, delay: number) =>
      Animated.sequence([
        Animated.delay(delay),
        Animated.spring(v, { toValue: 1, friction: 5, tension: 140, useNativeDriver: true }),
      ]);

    Animated.parallel([
      pop(circle, 150),
      pop(badge, 550),
      Animated.sequence([
        Animated.delay(300),
        Animated.timing(text, { toValue: 1, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]),
      ok
        ? Animated.sequence([
            Animated.delay(350),
            Animated.timing(ring, { toValue: 1, duration: 1100, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          ])
        : Animated.sequence([
            Animated.delay(600),
            ...[-1, 1, -0.6, 0.6, 0].map((to) =>
              Animated.timing(shake, { toValue: to, duration: 80, useNativeDriver: true })),
          ]),
    ]).start();
  }, [visible, result]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!result) return null;

  const rise = (offset: number) => ({
    opacity: text,
    transform: [{ translateY: text.interpolate({ inputRange: [0, 1], outputRange: [10 + offset, 0] }) }],
  });

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={styles.body}>
        <View style={styles.iconBox}>
          {ok && (
            <Animated.View
              style={[
                styles.ring,
                { borderColor: tone },
                {
                  opacity: ring.interpolate({ inputRange: [0, 0.05, 1], outputRange: [0, 0.7, 0] }),
                  transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] }) }],
                },
              ]}
            />
          )}
          <Animated.View
            style={[
              styles.circle,
              ok ? styles.circleOk : styles.circleRemoved,
              { transform: [{ scale: circle }] },
            ]}
          >
            <Animated.View style={{ transform: [{ translateX: shake.interpolate({ inputRange: [-1, 1], outputRange: [-7, 7] }) }] }}>
              <Ionicons name="print-outline" size={38} color={tone} />
            </Animated.View>
          </Animated.View>
          <Animated.View style={[styles.badge, { backgroundColor: tone, transform: [{ scale: badge }] }]}>
            <Ionicons name={ok ? 'checkmark' : 'close'} size={16} color="#fff" />
          </Animated.View>
        </View>

        <Animated.Text style={[styles.title, rise(0)]}>{result.title}</Animated.Text>
        <Animated.Text style={[styles.detail, rise(4)]}>{result.detail}</Animated.Text>
        <Animated.Text style={[styles.message, rise(8)]}>{result.message}</Animated.Text>

        <Animated.View style={[styles.actions, rise(12)]}>
          {ok && onTestPrint && (
            <TouchableOpacity style={styles.primaryBtn} onPress={onTestPrint} activeOpacity={0.85}>
              <Ionicons name="print-outline" size={17} color="#fff" />
              <Text style={styles.primaryText}>Print test page</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.secondaryBtn} onPress={onClose} activeOpacity={0.8}>
            <Text style={styles.secondaryText}>Done</Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: {
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
  },
  iconBox: {
    width: CIRCLE,
    height: CIRCLE,
    marginBottom: Spacing.lg,
  },
  ring: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: CIRCLE / 2,
    borderWidth: 2,
  },
  circle: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: CIRCLE / 2,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleOk: { backgroundColor: QuinckleColors.successSoft, borderColor: QuinckleColors.successBorder },
  circleRemoved: { backgroundColor: QuinckleColors.dangerSoft, borderColor: QuinckleColors.dangerBorder },
  badge: {
    position: 'absolute',
    right: -2,
    bottom: 2,
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 3,
    borderColor: QuinckleColors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...Typography.subtitle,
    color: QuinckleColors.textPrimary,
    textAlign: 'center',
  },
  detail: {
    fontSize: 13,
    color: QuinckleColors.textSecondary,
    marginTop: 4,
    textAlign: 'center',
  },
  message: {
    fontSize: 13,
    color: QuinckleColors.textTertiary,
    marginTop: 6,
    textAlign: 'center',
  },
  actions: {
    alignSelf: 'stretch',
    gap: Spacing.sm,
    marginTop: Spacing.xl,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: 14,
    borderRadius: Radius.lg,
    backgroundColor: QuinckleColors.primary,
  },
  primaryText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  secondaryBtn: {
    alignItems: 'center',
    paddingVertical: 14,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: QuinckleColors.borderStrong,
  },
  secondaryText: { color: QuinckleColors.textPrimary, fontSize: 15, fontWeight: '600' },
});
