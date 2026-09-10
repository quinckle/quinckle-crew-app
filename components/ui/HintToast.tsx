/**
 * HintToast — bottom-anchored, non-blocking "here's why" message.
 *
 * For explaining a disabled control the moment someone taps it. A dialog would
 * be wrong here: the staff member hasn't made a mistake and there is nothing to
 * confirm, so the answer should arrive without stealing focus or needing a
 * dismiss tap.
 *
 * Distinct from UndoSnackbar, which is a success confirmation with a reversible
 * action attached. This one carries no action and never blocks.
 *
 * Controlled: the parent owns the message and clears it via onDismiss. Setting a
 * new message while one is showing re-arms the timer, so rapid taps on different
 * disabled cards always show the latest reason for its full duration.
 *
 * Animated only — no native module, so it ships over-the-air.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { QuinckleColors, Radius, Spacing, Typography } from '../../constants/Colors';

interface Props {
  /** The reason to show. Null/empty hides the toast. */
  message: string | null;
  /** Called on auto-dismiss so the parent can clear its message. */
  onDismiss: () => void;
  /** Auto-dismiss delay (ms). Long enough to read a sentence. */
  duration?: number;
  /** Extra bottom offset — raise it above a docked total bar. */
  bottomOffset?: number;
}

export function HintToast({ message, onDismiss, duration = 3200, bottomOffset = 0 }: Props) {
  const insets = useSafeAreaInsets();
  const slide = useRef(new Animated.Value(0)).current; // 0 hidden → 1 shown
  const visible = !!message;
  const wasVisible = useRef(false);

  // Keep the latest onDismiss without re-arming the effect every render.
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

  // `message` is in the dep list on purpose: replacing one reason with another
  // restarts the countdown instead of letting the first timer cut it short.
  useEffect(() => {
    if (!visible) return undefined;
    const t = setTimeout(() => dismissRef.current(), duration);
    return () => clearTimeout(t);
  }, [visible, message, duration]);

  const translateY = slide.interpolate({ inputRange: [0, 1], outputRange: [120, 0] });

  return (
    <Animated.View
      // Never intercept touches — the screen underneath stays fully usable.
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={[
        styles.wrap,
        { bottom: insets.bottom + bottomOffset, opacity: slide, transform: [{ translateY }] },
      ]}
    >
      <View style={styles.bar}>
        <Ionicons name="information-circle-outline" size={17} color={QuinckleColors.textSecondary} />
        <Text style={styles.msg} numberOfLines={3}>{message}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: Spacing.lg, right: Spacing.lg, zIndex: 60 },
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    backgroundColor: QuinckleColors.surfaceMuted,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  msg: { ...Typography.caption, color: QuinckleColors.textPrimary, flex: 1, lineHeight: 17 },
});
