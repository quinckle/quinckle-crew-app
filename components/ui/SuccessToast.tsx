/**
 * SuccessToast — top-anchored confirmation that drops in over a screen that
 * is already navigating, and clears itself. No card to hold, no button to
 * dismiss: it exists to confirm something just landed, not to ask for
 * attention.
 *
 * Paired with an immediate navigation (see order-menu.tsx's confirmAndPlace):
 * the destination screen mounts right away and drops this in on top, rather
 * than the previous screen holding the crew on a "success" card before
 * moving them along. Style follows HintToast (bottom, informational) as its
 * top/success counterpart — same controlled API, same OTA-only Animated
 * implementation.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { QuinckleColors, Radius, Spacing, Typography } from '../../constants/Colors';

interface Props {
  /** The message to show. Null/empty hides the toast. */
  message: string | null;
  /** Called on auto-dismiss so the parent can clear its message. */
  onDismiss: () => void;
  /** Auto-dismiss delay (ms). Short — this confirms, it doesn't explain. */
  duration?: number;
}

export function SuccessToast({ message, onDismiss, duration = 2200 }: Props) {
  const insets = useSafeAreaInsets();
  const slide = useRef(new Animated.Value(0)).current; // 0 hidden (above) → 1 shown
  const visible = !!message;
  const wasVisible = useRef(false);

  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (visible && !wasVisible.current) {
      wasVisible.current = true;
      slide.setValue(0);
      Animated.spring(slide, { toValue: 1, useNativeDriver: true, friction: 9, tension: 70 }).start();
    } else if (!visible && wasVisible.current) {
      wasVisible.current = false;
      Animated.timing(slide, { toValue: 0, duration: 160, easing: Easing.in(Easing.ease), useNativeDriver: true }).start();
    }
  }, [visible, slide]);

  useEffect(() => {
    if (!visible) return undefined;
    const t = setTimeout(() => dismissRef.current(), duration);
    return () => clearTimeout(t);
  }, [visible, message, duration]);

  const translateY = slide.interpolate({ inputRange: [0, 1], outputRange: [-80, 0] });

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={[
        styles.wrap,
        { top: insets.top + Spacing.sm, opacity: slide, transform: [{ translateY }] },
      ]}
    >
      <View style={styles.bar}>
        <View style={styles.iconWrap}>
          <Ionicons name="checkmark" size={13} color="#fff" />
        </View>
        <Text style={styles.msg} numberOfLines={2}>{message}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: Spacing.lg, zIndex: 50 },
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    maxWidth: 420, paddingVertical: 9, paddingHorizontal: 14,
    borderRadius: Radius.pill,
    backgroundColor: QuinckleColors.surfaceElevated,
    borderWidth: 1, borderColor: QuinckleColors.successBorder,
    ...(Platform.OS === 'web'
      ? ({ boxShadow: '0 8px 24px rgba(0,0,0,0.45)' } as any)
      : { shadowColor: '#000', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 14, elevation: 10 }),
  },
  iconWrap: {
    width: 20, height: 20, borderRadius: 10, backgroundColor: QuinckleColors.success,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  msg: { ...Typography.caption, color: QuinckleColors.textPrimary, fontWeight: '600', flexShrink: 1 },
});
