/**
 * ItemReadyToast — bottom-anchored "table ready" cards for the DUAL_CHANNEL flow.
 *
 * When the kitchen marks an item done, the staff screen drops one of these in at
 * the bottom of the floor view (above the navbar), plays a distinct chime, and
 * gives a light haptic. Cards coalesce per table — a second item going ready on
 * the same table bumps the count on the existing card instead of stacking a new
 * one. Each card:
 *   • taps through to that table's detail screen (to serve),
 *   • swipes left OR right to dismiss,
 *   • auto-expires after `duration` ms (reset whenever its count changes).
 *
 * Controlled: the parent owns the toast list and clears entries on dismiss/tap.
 * Uses Animated + PanGestureHandler (both already bundled) so it ships OTA — no
 * native module is added.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { PanGestureHandler, State, type PanGestureHandlerStateChangeEvent } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { QuinckleColors, Radius, Spacing, Typography } from '../../constants/Colors';

export interface ReadyToast {
  /** Table number — also the coalescing key (one card per table). */
  tableNumber: number;
  /** How many distinct items on this table have gone ready. */
  count: number;
  /** Bumped by the parent each time `count` changes, to re-arm the auto-expire. */
  nonce: number;
  /** Session to open on tap (captured when the card is raised). */
  sessionId?: string | null;
  /** Table DB id — enables transfer/extend on the detail screen. */
  tableDbId?: string | null;
}

interface Props {
  toasts: ReadyToast[];
  onPress: (t: ReadyToast) => void;
  onDismiss: (tableNumber: number) => void;
  /** Auto-expire delay per card (ms). Default 9s. */
  duration?: number;
}

const SWIPE_THRESHOLD = 90;   // px past which a horizontal drag dismisses
const MAX_VISIBLE = 3;        // cap stacked cards so they never eat the screen

export function ItemReadyToast({ toasts, onPress, onDismiss, duration = 9000 }: Props) {
  const insets = useSafeAreaInsets();
  if (toasts.length === 0) return null;

  // Newest last in the array → show the newest nearest the navbar (bottom).
  const visible = toasts.slice(-MAX_VISIBLE);

  return (
    <View
      pointerEvents="box-none"
      style={[styles.wrap, { bottom: insets.bottom + 72 }]}
    >
      {visible.map((t) => (
        <ToastCard
          key={t.tableNumber}
          toast={t}
          duration={duration}
          onPress={() => onPress(t)}
          onDismiss={() => onDismiss(t.tableNumber)}
        />
      ))}
    </View>
  );
}

function ToastCard({
  toast,
  duration,
  onPress,
  onDismiss,
}: {
  toast: ReadyToast;
  duration: number;
  onPress: () => void;
  onDismiss: () => void;
}) {
  const enter = useRef(new Animated.Value(0)).current;   // 0 hidden → 1 shown
  const translateX = useRef(new Animated.Value(0)).current;
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  // Entrance: rise + fade in once on mount.
  useEffect(() => {
    Animated.spring(enter, { toValue: 1, useNativeDriver: true, friction: 9, tension: 70 }).start();
  }, [enter]);

  // Auto-expire. Re-armed whenever the count changes (new item on this table),
  // so a busy table's card keeps itself alive rather than vanishing mid-rush.
  useEffect(() => {
    const timer = setTimeout(() => animateOut(1), duration);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast.count, toast.nonce, duration]);

  const animateOut = (dir: 1 | -1) => {
    Animated.timing(translateX, {
      toValue: dir * 500,
      duration: 180,
      easing: Easing.in(Easing.ease),
      useNativeDriver: true,
    }).start(() => dismissRef.current());
  };

  const onPan = Animated.event([{ nativeEvent: { translationX: translateX } }], { useNativeDriver: true });

  const onPanStateChange = (e: PanGestureHandlerStateChangeEvent) => {
    if (e.nativeEvent.state !== State.END) return;
    const { translationX, velocityX } = e.nativeEvent;
    if (Math.abs(translationX) > SWIPE_THRESHOLD || Math.abs(velocityX) > 800) {
      animateOut(translationX >= 0 ? 1 : -1);
    } else {
      Animated.spring(translateX, { toValue: 0, useNativeDriver: true, friction: 8, tension: 80 }).start();
    }
  };

  const translateY = enter.interpolate({ inputRange: [0, 1], outputRange: [80, 0] });
  const swipeFade = translateX.interpolate({
    inputRange: [-220, 0, 220],
    outputRange: [0, 1, 0],
    extrapolate: 'clamp',
  });

  return (
    <PanGestureHandler
      activeOffsetX={[-12, 12]}       // claim only horizontal drags; taps fall through
      onGestureEvent={onPan}
      onHandlerStateChange={onPanStateChange}
    >
      <Animated.View
        style={[
          styles.cardOuter,
          { opacity: Animated.multiply(enter, swipeFade), transform: [{ translateY }, { translateX }] },
        ]}
      >
        <TouchableOpacity activeOpacity={0.85} onPress={onPress} style={styles.card}>
          <View style={styles.accent} />
          <View style={styles.iconChip}>
            <Ionicons name="notifications" size={20} color={QuinckleColors.success} />
          </View>
          <View style={styles.body}>
            <Text style={styles.label}>READY · FROM KITCHEN</Text>
            <Text style={styles.table} numberOfLines={1}>Table {toast.tableNumber}</Text>
          </View>
          <View style={styles.countBlock}>
            <Text style={styles.count}>{toast.count}</Text>
            <Text style={styles.countLabel}>{toast.count === 1 ? 'ITEM' : 'ITEMS'}</Text>
          </View>
          <View style={styles.chevronChip}>
            <Ionicons name="chevron-forward" size={19} color="rgba(255,255,255,0.55)" />
          </View>
        </TouchableOpacity>
      </Animated.View>
    </PanGestureHandler>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    gap: Spacing.sm,
    zIndex: 1000,
  },
  cardOuter: {
    // Float above the floor grid.
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: QuinckleColors.surface,
    borderWidth: 0.5,
    borderColor: QuinckleColors.borderStrong,
    borderRadius: 20,
    paddingVertical: Spacing.md,
    paddingLeft: Spacing.md,
    paddingRight: Spacing.md,
  },
  accent: {
    width: 5,
    alignSelf: 'stretch',
    borderRadius: Radius.pill,
    backgroundColor: QuinckleColors.success,
  },
  iconChip: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: QuinckleColors.successSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  label: {
    ...Typography.micro,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: QuinckleColors.success,
  },
  table: {
    ...Typography.subtitle,
    color: QuinckleColors.textPrimary,
    marginTop: 3,
  },
  countBlock: {
    alignItems: 'center',
    paddingHorizontal: 2,
  },
  count: {
    fontSize: 22,
    fontWeight: '700',
    color: QuinckleColors.textPrimary,
    lineHeight: 24,
  },
  countLabel: {
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 0.5,
    color: QuinckleColors.textSecondary,
    marginTop: 2,
  },
  chevronChip: {
    width: 32,
    height: 32,
    borderRadius: 11,
    backgroundColor: QuinckleColors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
