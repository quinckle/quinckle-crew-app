/**
 * UndoSnackbar — bottom-anchored "X freed · Undo" toast.
 *
 * Mirrors the dashboard khata "written off + Undo" pattern: an optimistic action
 * fires immediately, this toast gives a short window to reverse it, then it
 * auto-dismisses. Controlled — the parent owns the payload (what to undo) and
 * clears it on dismiss. A thin progress bar counts the window down so the wait
 * is legible.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { QuinckleColors, Radius, Spacing, Typography } from '../../constants/Colors';

interface Props {
  visible: boolean;
  message: string;
  /** Called when the user taps Undo. */
  onUndo: () => void;
  /** Called on auto-dismiss OR after Undo, so the parent can clear its payload. */
  onDismiss: () => void;
  /** Auto-dismiss delay (ms). Kept under the server reopen window. Default 5s. */
  duration?: number;
  /** Disables Undo + shows a spinner label while the reopen request is inflight. */
  busy?: boolean;
}

export function UndoSnackbar({ visible, message, onUndo, onDismiss, duration = 5000, busy = false }: Props) {
  const insets = useSafeAreaInsets();
  const slide = useRef(new Animated.Value(0)).current;   // 0 hidden → 1 shown
  const progress = useRef(new Animated.Value(1)).current; // 1 full → 0 empty
  const wasVisible = useRef(false);
  // Keep the latest onDismiss without re-arming the effect each render.
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  // Slide in/out only on a real visibility change — never on a `busy` flip, so
  // tapping Undo doesn't re-trigger the entrance animation.
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

  // Countdown bar + auto-dismiss. Pauses while a reopen is inflight (busy).
  useEffect(() => {
    if (!visible || busy) return undefined;
    progress.setValue(1);
    Animated.timing(progress, { toValue: 0, duration, easing: Easing.linear, useNativeDriver: false }).start();
    const t = setTimeout(() => dismissRef.current(), duration);
    return () => {
      clearTimeout(t);
      progress.stopAnimation();
    };
  }, [visible, busy, duration, progress]);

  const translateY = slide.interpolate({ inputRange: [0, 1], outputRange: [120, 0] });
  const width = progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <Animated.View
      pointerEvents={visible ? 'box-none' : 'none'}
      style={[
        styles.wrap,
        { bottom: insets.bottom + 72, opacity: slide, transform: [{ translateY }] },
      ]}
    >
      <View style={styles.bar}>
        <View style={styles.left}>
          <Ionicons name="checkmark-circle" size={18} color={QuinckleColors.success} />
          <Text style={styles.msg} numberOfLines={2}>{message}</Text>
        </View>
        <TouchableOpacity
          style={styles.undoBtn}
          onPress={onUndo}
          disabled={busy}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Text style={styles.undoText}>{busy ? 'Undoing…' : 'Undo'}</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.track}>
        <Animated.View style={[styles.fill, { width }]} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    zIndex: 1000,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    backgroundColor: QuinckleColors.surfaceElevated,
    borderWidth: 1,
    borderColor: QuinckleColors.borderStrong,
    borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    // Float above the floor grid.
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  left: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  msg: {
    ...Typography.bodyStrong,
    color: QuinckleColors.textPrimary,
    flexShrink: 1,
  },
  undoBtn: {
    paddingVertical: 4,
    paddingHorizontal: Spacing.sm,
  },
  undoText: {
    ...Typography.bodyStrong,
    color: QuinckleColors.primary,
    fontWeight: '700',
  },
  track: {
    height: 3,
    backgroundColor: QuinckleColors.surfaceMuted,
    borderBottomLeftRadius: Radius.lg,
    borderBottomRightRadius: Radius.lg,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    backgroundColor: QuinckleColors.primary,
  },
});
