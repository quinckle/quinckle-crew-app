/**
 * PrintProgressOverlay — full-screen progress feedback for the tap-to-paper
 * wait on manual KOT / invoice prints. Replaces the old "Printed — OK" and
 * "Print Failed" dialogs: success auto-dismisses (no tap), failure offers a
 * Retry inline.
 *
 * Phases map to real await boundaries in the calling handler, so the overlay
 * never claims progress that isn't happening:
 *   preparing → server calls before the print (invoice finalize / branding)
 *   printing  → the Bluetooth/TCP write on THIS device
 *   sending   → Ably round-trip to a printer paired on ANOTHER device
 *   done      → printed here; auto-dismisses
 *   sent      → accepted by the remote device (can't confirm paper-out); auto-dismisses
 *   failed    → sticky; shows message + Retry / Close
 */

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { QuinckleColors, Radius, Spacing, Typography } from '../../constants/Colors';

export type PrintJobPhase = 'preparing' | 'printing' | 'sending' | 'done' | 'sent' | 'failed';

export interface PrintJob {
  phase: PrintJobPhase;
  /** What is being printed — "KOT" | "Invoice". Used in the phase text. */
  label: string;
  /** Failure detail shown under the title (failed phase only). */
  message?: string;
  /** Re-runs the print that failed (failed phase only). */
  onRetry?: () => void;
}

interface Props {
  job: PrintJob | null;
  /** Clears the job — called on auto-dismiss (done/sent) and Close (failed). */
  onDismiss: () => void;
}

const AUTO_DISMISS_DONE_MS = 900;
const AUTO_DISMISS_SENT_MS = 1400;
const PAPER_LOOP_MS = 1300;
// The native print write has no JS-side timeout — a dead TCP target can stall
// for the full OS connect timeout. After this long in a busy phase, surface a
// Close button so the crew is never trapped behind the modal. Closing only
// hides the UI; the in-flight print still resolves (or fails) in background.
const STUCK_AFTER_MS = 15_000;
// Fast prints (printBill resolves right after the BT write, no ack round-trip
// like printKot) can finish inside one paper-loop cycle, cutting the animation
// off mid-rise. Hold the busy visual until at least one full cycle has played
// before showing success — cosmetic only, the paper is already out. Failures
// are never delayed.
const MIN_BUSY_MS = PAPER_LOOP_MS + 250;

const PAPER_W = 68;
const PAPER_H = 78;
const WINDOW_H = 58;

/** The looping "receipt sliding out of the printer" graphic. */
function PrinterGraphic({ phase }: { phase: PrintJobPhase }) {
  const paper = useRef(new Animated.Value(0)).current; // 0 = hidden in slot, 1 = fully out
  const led = useRef(new Animated.Value(0)).current;

  const animating = phase === 'printing' || phase === 'sending';

  useEffect(() => {
    // LED blinks in every busy phase — the "device is alive" cue.
    const blink = Animated.loop(
      Animated.sequence([
        Animated.timing(led, { toValue: 1, duration: 420, useNativeDriver: true }),
        Animated.timing(led, { toValue: 0.2, duration: 420, useNativeDriver: true }),
      ]),
    );
    blink.start();
    return () => blink.stop();
  }, [led]);

  useEffect(() => {
    if (!animating) {
      paper.setValue(0);
      return;
    }
    // Paper emerges, holds a beat, then the next receipt starts — a deliberate
    // loop rather than a spinner, so the wait reads as "the printer is working".
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(paper, {
          toValue: 1,
          duration: PAPER_LOOP_MS,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.delay(220),
        Animated.timing(paper, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [animating, paper]);

  const paperTranslate = paper.interpolate({
    inputRange: [0, 1],
    outputRange: [PAPER_H, 6],
  });

  return (
    <View style={g.stage}>
      {/* Masked window above the slot — paper rises into view through it. */}
      <View style={g.paperWindow}>
        <Animated.View style={[g.paper, { transform: [{ translateY: paperTranslate }] }]}>
          <View style={[g.paperLine, { width: '78%' }]} />
          <View style={[g.paperLine, { width: '62%' }]} />
          <View style={[g.paperLine, { width: '70%' }]} />
          <View style={[g.paperLine, { width: '46%' }]} />
          <View style={g.paperDivider} />
          <View style={[g.paperLine, { width: '58%' }]} />
        </Animated.View>
      </View>
      {/* Printer body */}
      <View style={g.printerBody}>
        <View style={g.slot} />
        <Animated.View style={[g.led, { opacity: led }]} />
      </View>
    </View>
  );
}

/** Spring-in result badge for the terminal phases. */
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

function phaseTitle(job: PrintJob): string {
  switch (job.phase) {
    case 'preparing': return `Preparing ${job.label.toLowerCase()}…`;
    case 'printing': return `Printing ${job.label.toLowerCase()}…`;
    case 'sending': return 'Sending to kitchen printer…';
    case 'done': return `${job.label} printed`;
    case 'sent': return 'Sent to kitchen printer';
    case 'failed': return 'Print failed';
  }
}

function phaseSubtitle(job: PrintJob): string | null {
  switch (job.phase) {
    case 'preparing': return 'Getting the latest bill details';
    case 'printing': return 'Keep the printer nearby and powered on';
    case 'sending': return 'The paired device will print it';
    case 'sent': return 'It prints there in a moment';
    case 'failed': return job.message ?? 'Check the printer and try again.';
    default: return null;
  }
}

const isBusy = (p?: PrintJobPhase) =>
  p === 'preparing' || p === 'printing' || p === 'sending';

export function PrintProgressOverlay({ job, onDismiss }: Props) {
  const shake = useRef(new Animated.Value(0)).current;
  // True once a busy phase has overstayed STUCK_AFTER_MS — unlocks Close.
  const [stuck, setStuck] = React.useState(false);

  // What the card actually renders. Lags `job` only in one case: a success
  // arriving before MIN_BUSY_MS of busy time has played, so the paper loop
  // completes instead of being cut off mid-rise. Failures are never delayed.
  const [shown, setShown] = React.useState<PrintJob | null>(job);
  const busyStart = useRef(0);
  const prevPhase = useRef<PrintJobPhase | undefined>(job?.phase);

  useEffect(() => {
    const prev = prevPhase.current;
    prevPhase.current = job?.phase;
    if (!job) {
      setShown(null);
      return;
    }
    if (isBusy(job.phase)) {
      if (!isBusy(prev)) busyStart.current = Date.now();
      setShown(job);
      return;
    }
    if ((job.phase === 'done' || job.phase === 'sent') && isBusy(prev)) {
      const wait = Math.max(0, MIN_BUSY_MS - (Date.now() - busyStart.current));
      if (wait > 0) {
        const t = setTimeout(() => setShown(job), wait);
        return () => clearTimeout(t);
      }
    }
    setShown(job);
  }, [job]);

  const phase = shown?.phase;

  // Watchdog: the busy phases await native calls with no JS-side timeout, so
  // after STUCK_AFTER_MS offer an escape hatch rather than trapping the crew.
  useEffect(() => {
    setStuck(false);
    if (phase !== 'preparing' && phase !== 'printing' && phase !== 'sending') return;
    const t = setTimeout(() => setStuck(true), STUCK_AFTER_MS);
    return () => clearTimeout(t);
  }, [phase]);

  // Haptics + auto-dismiss on terminal phases; card shake on failure.
  useEffect(() => {
    if (!phase) return;
    if (phase === 'printing' || phase === 'sending') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      return;
    }
    if (phase === 'done' || phase === 'sent') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      const t = setTimeout(onDismiss, phase === 'done' ? AUTO_DISMISS_DONE_MS : AUTO_DISMISS_SENT_MS);
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

  const terminal = shown.phase === 'done' || shown.phase === 'sent' || shown.phase === 'failed';
  const subtitle = phaseSubtitle(shown);

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      // Back button: never cancel a print in flight (it would double-print on
      // retry confusion); only a failed or stuck job can be dismissed.
      onRequestClose={() => { if (shown.phase === 'failed' || stuck) onDismiss(); }}
    >
      <View style={styles.backdrop}>
        <Animated.View style={[styles.card, { transform: [{ translateX: shake }] }]}>
          {terminal
            ? <ResultBadge ok={shown.phase !== 'failed'} />
            : <PrinterGraphic phase={shown.phase} />}

          <Text style={styles.title}>{phaseTitle(shown)}</Text>
          {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}

          {stuck && !terminal && (
            <View style={styles.stuckBlock}>
              <Text style={styles.stuckHint}>
                Taking longer than usual — you can close this; the print will still
                finish if the printer responds.
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

const g = StyleSheet.create({
  stage: {
    alignItems: 'center',
    height: WINDOW_H + 44,
    justifyContent: 'flex-end',
  },
  paperWindow: {
    width: PAPER_W,
    height: WINDOW_H,
    overflow: 'hidden',
    justifyContent: 'flex-end',
    // Pull the paper visually into the slot so it emerges from the body.
    marginBottom: -6,
    zIndex: 0,
  },
  paper: {
    width: PAPER_W,
    height: PAPER_H,
    backgroundColor: '#FAFAFA',
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    paddingTop: 10,
    paddingHorizontal: 10,
    gap: 7,
  },
  paperLine: {
    height: 3.5,
    borderRadius: 2,
    backgroundColor: 'rgba(0,0,0,0.22)',
  },
  paperDivider: {
    height: 1,
    alignSelf: 'stretch',
    backgroundColor: 'rgba(0,0,0,0.14)',
  },
  printerBody: {
    width: 104,
    height: 36,
    borderRadius: Radius.sm,
    backgroundColor: QuinckleColors.surfaceMutedHover,
    borderWidth: 1,
    borderColor: QuinckleColors.borderStrong,
    alignItems: 'center',
    paddingTop: 6,
    zIndex: 1,
  },
  slot: {
    width: 76,
    height: 5,
    borderRadius: 3,
    backgroundColor: QuinckleColors.background,
  },
  led: {
    position: 'absolute',
    right: 10,
    bottom: 9,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: QuinckleColors.primary,
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
