/**
 * FreeTableOverlay — celebratory "table cleared" confirmation for a single
 * whole-table free. The counterpart to PrintProgressOverlay: instead of a
 * receipt rising from a printer, a laid table is swept clean and reset for the
 * next guests.
 *
 * Timeline (all cosmetic — the free already happened optimistically):
 *   sweep        a warm highlight passes across the table
 *   clear        the plates + bill fly off
 *   reset        the surface tints green, a check springs in
 *   settle       title / subtitle / Undo fade up; a countdown bar = the Undo
 *                window, after which it auto-dismisses
 *
 * Undo lives ON the card (the snackbar is only used for the batch/in-card path).
 * Tapping the backdrop accepts the free and dismisses early.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { QuinckleColors, Radius, Spacing, Typography } from '../../constants/Colors';
import type { ClosedSessionInfo } from '../../services/api';

export interface FreeJob {
  tableNumber: number;
  sessions: ClosedSessionInfo[];
}

interface Props {
  job: FreeJob | null;
  /** Reopen the freed sessions. */
  onUndo: () => void;
  /** Clears the job — auto-dismiss or backdrop tap. */
  onDismiss: () => void;
  /** True while the reopen is inflight — pauses auto-dismiss, shows "Undoing…". */
  busy?: boolean;
  /** How long the card lingers (= the on-card Undo window). Default 3.8s. */
  duration?: number;
}

/** The laid table being swept clean, top-down. */
function TableClearGraphic() {
  const sweep = useRef(new Animated.Value(0)).current;
  const plates = useRef(new Animated.Value(0)).current; // 0 on table → 1 flown off
  const green = useRef(new Animated.Value(0)).current;
  const badge = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.timing(sweep, { toValue: 1, duration: 600, delay: 250, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(plates, { toValue: 1, duration: 340, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(green, { toValue: 1, duration: 260, useNativeDriver: false }),
      Animated.spring(badge, { toValue: 1, friction: 5, tension: 130, useNativeDriver: true }),
    ]).start();
  }, [sweep, plates, green, badge]);

  const sweepX = sweep.interpolate({ inputRange: [0, 1], outputRange: [-58, 58] });
  const sweepOpacity = sweep.interpolate({ inputRange: [0, 0.2, 0.8, 1], outputRange: [0, 1, 1, 0] });
  const plateOpacity = plates.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const plateLift = plates.interpolate({ inputRange: [0, 1], outputRange: [0, -26] });
  const plateDrift = plates.interpolate({ inputRange: [0, 1], outputRange: [0, 16] });
  const plateScale = plates.interpolate({ inputRange: [0, 1], outputRange: [1, 0.4] });
  const surfaceBg = green.interpolate({ inputRange: [0, 1], outputRange: ['#26232a', 'rgba(34,197,94,0.12)'] });
  const surfaceBorder = green.interpolate({ inputRange: [0, 1], outputRange: ['rgba(255,255,255,0.10)', 'rgba(34,197,94,0.40)'] });

  return (
    <View style={g.stage}>
      <Animated.View style={[g.table, { backgroundColor: surfaceBg, borderColor: surfaceBorder }]}>
        {/* plates + bill */}
        <Animated.View
          style={[g.plate, g.p1, { opacity: plateOpacity, transform: [{ translateY: plateLift }, { translateX: plateDrift }, { scale: plateScale }] }]}
        />
        <Animated.View
          style={[g.plate, g.p2, { opacity: plateOpacity, transform: [{ translateY: plateLift }, { translateX: plateDrift }, { scale: plateScale }] }]}
        />
        <Animated.View
          style={[g.bill, { opacity: plateOpacity, transform: [{ translateY: plateLift }, { translateX: plateDrift }, { scale: plateScale }] }]}
        />
        {/* warm sweep highlight */}
        <Animated.View style={[g.sweep, { opacity: sweepOpacity, transform: [{ translateX: sweepX }, { skewX: '-18deg' }] }]} />
      </Animated.View>

      {/* check badge lands on the cleared surface */}
      <Animated.View style={[g.badge, { transform: [{ scale: badge }] }]}>
        <Ionicons name="checkmark" size={26} color={QuinckleColors.success} />
      </Animated.View>
    </View>
  );
}

export function FreeTableOverlay({ job, onUndo, onDismiss, busy = false, duration = 3800 }: Props) {
  const enter = useRef(new Animated.Value(0)).current;
  const bar = useRef(new Animated.Value(1)).current;
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  // Card entrance + success haptic (once per job).
  useEffect(() => {
    if (!job) return;
    enter.setValue(0);
    Animated.spring(enter, { toValue: 1, friction: 7, tension: 80, useNativeDriver: true }).start();
    const h = setTimeout(() => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }, 800);
    return () => clearTimeout(h);
  }, [job, enter]);

  // Countdown bar + auto-dismiss (paused while undoing).
  useEffect(() => {
    if (!job || busy) return undefined;
    bar.setValue(1);
    Animated.timing(bar, { toValue: 0, duration, delay: 1000, easing: Easing.linear, useNativeDriver: false }).start();
    const t = setTimeout(() => dismissRef.current(), duration + 1000);
    return () => {
      clearTimeout(t);
      bar.stopAnimation();
    };
  }, [job, busy, duration, bar]);

  if (!job) return null;

  const scale = enter.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] });
  const barWidth = bar.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onDismiss}>
      <Pressable style={styles.backdrop} onPress={onDismiss}>
        {/* Swallow taps on the card itself so only the backdrop dismisses. */}
        <Pressable onPress={() => {}}>
          <Animated.View style={[styles.card, { opacity: enter, transform: [{ scale }] }]}>
            {/* Keyed by table so a rapid second free re-runs the clear animation. */}
            <TableClearGraphic key={job.tableNumber} />

            <Text style={styles.title}>Table {String(job.tableNumber).padStart(2, '0')} cleared</Text>
            <Text style={styles.subtitle}>Ready for the next guests</Text>

            <TouchableOpacity
              style={[styles.undoBtn, busy && { opacity: 0.6 }]}
              onPress={onUndo}
              disabled={busy}
              activeOpacity={0.75}
            >
              <Ionicons name="arrow-undo-outline" size={16} color={QuinckleColors.primary} />
              <Text style={styles.undoText}>{busy ? 'Undoing…' : 'Undo'}</Text>
            </TouchableOpacity>

            <View style={styles.track}>
              <Animated.View style={[styles.fill, { width: barWidth }]} />
            </View>
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const g = StyleSheet.create({
  stage: {
    width: 96,
    height: 84,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  table: {
    width: 78,
    height: 78,
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
  },
  plate: {
    position: 'absolute',
    borderRadius: 999,
    backgroundColor: '#F0EFE9',
    borderWidth: 3,
    borderColor: 'rgba(0,0,0,0.10)',
  },
  p1: { width: 24, height: 24, left: 12, top: 16 },
  p2: { width: 18, height: 18, right: 12, top: 14 },
  bill: {
    position: 'absolute',
    width: 20,
    height: 14,
    borderRadius: 3,
    backgroundColor: '#FAFAFA',
    left: 29,
    bottom: 12,
  },
  sweep: {
    position: 'absolute',
    top: '-10%',
    left: '30%',
    width: '32%',
    height: '120%',
    backgroundColor: QuinckleColors.primary,
    opacity: 0.5,
  },
  badge: {
    position: 'absolute',
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: QuinckleColors.successSoft,
    borderWidth: 1.5,
    borderColor: QuinckleColors.successBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xxl,
  },
  card: {
    width: 240,
    backgroundColor: QuinckleColors.surfaceElevated,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    alignItems: 'center',
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.lg,
    paddingHorizontal: Spacing.xl,
  },
  title: {
    ...Typography.subtitle,
    color: QuinckleColors.textPrimary,
    marginTop: Spacing.sm,
    textAlign: 'center',
  },
  subtitle: {
    ...Typography.caption,
    color: QuinckleColors.textSecondary,
    textAlign: 'center',
    marginTop: 2,
  },
  undoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: Spacing.lg,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.md,
    backgroundColor: QuinckleColors.surfaceMutedHover,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
  },
  undoText: {
    ...Typography.bodyStrong,
    color: QuinckleColors.primary,
    fontWeight: '700',
  },
  track: {
    marginTop: Spacing.lg,
    width: 150,
    height: 3,
    borderRadius: 2,
    backgroundColor: QuinckleColors.surfaceMuted,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    backgroundColor: QuinckleColors.primary,
  },
});
