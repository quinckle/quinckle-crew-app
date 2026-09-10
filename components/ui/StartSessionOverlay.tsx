/**
 * StartSessionOverlay — full-screen progress feedback for opening a table.
 * Tapping a free table now starts the session immediately (no confirm
 * modal); this overlay is the only feedback while the create-session call is
 * in flight. The graphic is the literal reverse of FreeTableOverlay's
 * TableClearGraphic: instead of plates flying off a table that tints green
 * ("available"), a warm sweep loops across an empty table while the call is
 * in flight, then the plates fly IN and land, and the surface tints to the
 * app's "occupied" orange once it resolves — same shapes, same quality,
 * opposite direction, since opening a table is literally the inverse of
 * freeing one.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { QuinckleColors, Radius, Spacing, Typography } from '../../constants/Colors';

export type StartSessionPhase = 'starting' | 'done' | 'failed';

export interface StartSessionJob {
  phase: StartSessionPhase;
  /** e.g. "T04" — used in the phase text. */
  tableLabel: string;
  /** Failure detail shown under the title (failed phase only). */
  message?: string;
  /** Re-runs the start that failed (failed phase only). */
  onRetry?: () => void;
}

interface Props {
  job: StartSessionJob | null;
  /** Clears the job — called on auto-dismiss (done) and Close (failed). */
  onDismiss: () => void;
}

const AUTO_DISMISS_DONE_MS = 500;
const STUCK_AFTER_MS = 10_000;
// Plates-land (300ms) + tint (220ms) run sequentially on success — give that
// long before swapping to the checkmark badge, so it lands after the table
// actually looks "set" rather than cutting the flourish short.
const FINISH_MS = 520;

/** The "set the table" graphic — literal reverse of FreeTableOverlay's
 * TableClearGraphic. Busy: a warm sweep loops across an empty table (the
 * "still working" cue, standing in for the printer's LED blink). Finishing:
 * the plates fly IN and land, one settling sweep passes, and the surface
 * tints from neutral to the app's "occupied" orange (QuinckleColors.primary
 * — the same color STATUS_META uses for occupied tables), mirroring how
 * FreeTableOverlay tints to "available" green. */
function TableSetGraphic({ complete }: { complete: boolean }) {
  const sweep = useRef(new Animated.Value(0)).current;
  const plates = useRef(new Animated.Value(0)).current; // 0 = off table (busy) → 1 = landed (done)
  const tint = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (complete) return;
    sweep.setValue(0);
    const loop = Animated.loop(
      Animated.timing(sweep, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [complete, sweep]);

  useEffect(() => {
    if (!complete) return;
    sweep.stopAnimation();
    plates.setValue(0);
    tint.setValue(0);
    Animated.sequence([
      Animated.timing(plates, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(tint, { toValue: 1, duration: 220, useNativeDriver: false }),
    ]).start();
  }, [complete, sweep, plates, tint]);

  const sweepX = sweep.interpolate({ inputRange: [0, 1], outputRange: [-58, 58] });
  const sweepOpacity = sweep.interpolate({ inputRange: [0, 0.2, 0.8, 1], outputRange: [0, 1, 1, 0] });
  const plateLift = plates.interpolate({ inputRange: [0, 1], outputRange: [-26, 0] });
  const plateDrift = plates.interpolate({ inputRange: [0, 1], outputRange: [16, 0] });
  const plateScale = plates.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1] });
  const surfaceBg = tint.interpolate({ inputRange: [0, 1], outputRange: ['#26232a', 'rgba(243,93,59,0.12)'] });
  const surfaceBorder = tint.interpolate({ inputRange: [0, 1], outputRange: ['rgba(255,255,255,0.10)', 'rgba(243,93,59,0.40)'] });

  return (
    <View style={g.stage}>
      <Animated.View style={[g.table, { backgroundColor: surfaceBg, borderColor: surfaceBorder }]}>
        {/* plates + bill fly in and land */}
        <Animated.View
          style={[g.plate, g.p1, { opacity: plates, transform: [{ translateY: plateLift }, { translateX: plateDrift }, { scale: plateScale }] }]}
        />
        <Animated.View
          style={[g.plate, g.p2, { opacity: plates, transform: [{ translateY: plateLift }, { translateX: plateDrift }, { scale: plateScale }] }]}
        />
        <Animated.View
          style={[g.bill, { opacity: plates, transform: [{ translateY: plateLift }, { translateX: plateDrift }, { scale: plateScale }] }]}
        />
        {/* warm sweep highlight */}
        <Animated.View style={[g.sweep, { opacity: sweepOpacity, transform: [{ translateX: sweepX }, { skewX: '-18deg' }] }]} />
      </Animated.View>
    </View>
  );
}

/** Spring-in result badge for the terminal phases — same treatment as PrintProgressOverlay. */
function ResultBadge({ ok }: { ok: boolean }) {
  const scale = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    Animated.spring(scale, { toValue: 1, friction: 5, tension: 120, useNativeDriver: true }).start();
  }, [scale]);
  return (
    <Animated.View
      style={[
        g.resultBadge,
        ok ? g.resultBadgeOk : g.resultBadgeFail,
        { transform: [{ scale }] },
      ]}
    >
      <Ionicons
        name={ok ? 'checkmark' : 'close'}
        size={34}
        color={ok ? QuinckleColors.success : QuinckleColors.danger}
      />
    </Animated.View>
  );
}

function phaseTitle(job: StartSessionJob): string {
  switch (job.phase) {
    case 'starting': return `Opening ${job.tableLabel}…`;
    case 'done': return `${job.tableLabel} is open`;
    case 'failed': return "Couldn't start session";
  }
}

function phaseSubtitle(job: StartSessionJob): string | null {
  switch (job.phase) {
    case 'starting': return 'Starting a new session';
    case 'failed': return job.message ?? 'Check your connection and try again.';
    default: return null;
  }
}

export function StartSessionOverlay({ job, onDismiss }: Props) {
  const shake = useRef(new Animated.Value(0)).current;
  const [stuck, setStuck] = React.useState(false);

  // What the card actually renders. Lags `job` only when success arrives
  // while the pin is still hovering: `finishing` plays the pin's bounce-land
  // animation, and the checkmark swaps in FINISH_MS later — always onto a
  // pin that's actually landed, never an abrupt cut. Failures are never delayed.
  const [shown, setShown] = React.useState<StartSessionJob | null>(job);
  const [finishing, setFinishing] = React.useState(false);
  const prevPhase = useRef<StartSessionPhase | undefined>(job?.phase);

  useEffect(() => {
    const prev = prevPhase.current;
    prevPhase.current = job?.phase;
    if (!job) {
      setFinishing(false);
      setShown(null);
      return;
    }
    if (job.phase === 'starting') {
      setFinishing(false);
      setShown(job);
      return;
    }
    if (job.phase === 'done' && prev === 'starting') {
      setFinishing(true);
      const t = setTimeout(() => { setFinishing(false); setShown(job); }, FINISH_MS);
      return () => clearTimeout(t);
    }
    setFinishing(false);
    setShown(job);
  }, [job]);

  const phase = shown?.phase;

  useEffect(() => {
    setStuck(false);
    if (phase !== 'starting') return;
    const t = setTimeout(() => setStuck(true), STUCK_AFTER_MS);
    return () => clearTimeout(t);
  }, [phase]);

  useEffect(() => {
    if (!phase) return;
    if (phase === 'starting') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      return;
    }
    if (phase === 'done') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      const t = setTimeout(onDismiss, AUTO_DISMISS_DONE_MS);
      return () => clearTimeout(t);
    }
    if (phase === 'failed') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      shake.setValue(0);
      Animated.sequence(
        [10, -10, 7, -7, 4, 0].map((x) =>
          Animated.timing(shake, { toValue: x, duration: 55, useNativeDriver: true }),
        ),
      ).start();
    }
  }, [phase, onDismiss, shake]);

  if (!shown) return null;

  const terminal = shown.phase === 'done' || shown.phase === 'failed';
  const subtitle = phaseSubtitle(shown);

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => { if (shown.phase === 'failed' || stuck) onDismiss(); }}
    >
      <View style={styles.backdrop}>
        <Animated.View style={[styles.card, { transform: [{ translateX: shake }] }]}>
          {terminal
            ? <ResultBadge ok={shown.phase !== 'failed'} />
            : <TableSetGraphic complete={finishing} />}

          <Text style={styles.title}>{phaseTitle(shown)}</Text>
          {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}

          {stuck && !terminal && (
            <View style={styles.stuckBlock}>
              <Text style={styles.stuckHint}>
                Taking longer than usual — you can close this and try again.
              </Text>
              <TouchableOpacity
                style={[styles.btn, styles.btnGhost]}
                onPress={onDismiss}
                activeOpacity={0.8}
              >
                <Text style={styles.btnGhostText}>Close</Text>
              </TouchableOpacity>
            </View>
          )}

          {shown.phase === 'failed' && (
            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.btn, styles.btnGhost]}
                onPress={onDismiss}
                activeOpacity={0.8}
              >
                <Text style={styles.btnGhostText}>Close</Text>
              </TouchableOpacity>
              {shown.onRetry && (
                <TouchableOpacity
                  style={[styles.btn, styles.btnPrimary]}
                  onPress={() => { const r = shown.onRetry; onDismiss(); r?.(); }}
                  activeOpacity={0.8}
                >
                  <Ionicons name="refresh" size={16} color="#fff" />
                  <Text style={styles.btnPrimaryText}>Retry</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

// Same shapes/dimensions as FreeTableOverlay's `g` — same physical table,
// just re-tinted and reversed.
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
  resultBadge: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    marginBottom: Spacing.sm,
  },
  resultBadgeOk: {
    backgroundColor: QuinckleColors.successSoft,
    borderColor: QuinckleColors.successBorder,
  },
  resultBadgeFail: {
    backgroundColor: QuinckleColors.dangerSoft,
    borderColor: QuinckleColors.dangerBorder,
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
    marginTop: Spacing.md,
    textAlign: 'center',
  },
  subtitle: {
    ...Typography.caption,
    color: QuinckleColors.textSecondary,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.lg,
    alignSelf: 'stretch',
  },
  stuckBlock: {
    gap: Spacing.sm,
    marginTop: Spacing.lg,
    alignSelf: 'stretch',
  },
  stuckHint: {
    ...Typography.caption,
    color: QuinckleColors.textTertiary,
    textAlign: 'center',
  },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
  },
  btnGhost: {
    backgroundColor: QuinckleColors.surfaceMutedHover,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
  },
  btnGhostText: {
    ...Typography.bodyStrong,
    color: QuinckleColors.textPrimary,
  },
  btnPrimary: {
    backgroundColor: QuinckleColors.primary,
  },
  btnPrimaryText: {
    ...Typography.bodyStrong,
    color: '#fff',
  },
});
