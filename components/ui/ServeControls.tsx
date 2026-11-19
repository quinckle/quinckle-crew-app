/**
 * The serve controls on a table-screen order row.
 *
 * ServeRing — one arc per unit ("1/3"). Tap serves one more, hold serves the
 * rest (the same rule the old "Serve 1 · hold for 3" button had). The last arc
 * fills the circle green and draws a tick.
 *
 * UndoButton — a small round button beside the ring that takes the last serve
 * back. An amber ring around it drains over the server's 2-minute window; once
 * it runs out the button greys out and a tap shakes it (the screen shows why).
 * It spins one full turn backwards when it does undo.
 *
 * Only RN Animated + react-native-svg (both already in the native build), so
 * this ships over OTA.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View, type ViewStyle } from 'react-native';
import Svg, { Circle, Path, Text as SvgText } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { QuinckleColors } from '../../constants/Colors';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedPath = Animated.createAnimatedComponent(Path);

const GREEN = '#639922';
const GREEN_LIGHT = '#97C459';
const AMBER = QuinckleColors.warning;
const IDLE = 'rgba(255,255,255,0.28)';

/** How long a press must last to count as a hold — same as the old button. */
export const HOLD_MS = 350;
const SPIN_MS = 600;

const haptic = (fn: () => Promise<void>) => { fn().catch(() => {}); };

// ── ServeRing ────────────────────────────────────────────────────────────────

const R = 13;
const C = 2 * Math.PI * R;
const HOLD_R = 14;
const HOLD_C = 2 * Math.PI * HOLD_R;
const TICK_LEN = 20;

export function ServeRing({
  qty,
  servedQty,
  onServeOne,
  onServeRest,
  accessibilityLabel,
}: {
  qty: number;
  servedQty: number;
  onServeOne: () => void;
  onServeRest: () => void;
  accessibilityLabel: string;
}) {
  const full = servedQty >= qty;
  const fill = useRef(new Animated.Value(full ? 1 : 0)).current;
  const hold = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(1)).current;
  const prevServed = useRef(servedQty);

  useEffect(() => {
    Animated.spring(fill, { toValue: full ? 1 : 0, useNativeDriver: false, speed: 18, bounciness: 9 }).start();
  }, [full, fill]);

  // A small pop whenever a unit goes out.
  useEffect(() => {
    if (servedQty > prevServed.current) {
      pop.setValue(1);
      Animated.sequence([
        Animated.timing(pop, { toValue: 1.12, duration: 110, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(pop, { toValue: 1, duration: 140, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]).start();
    }
    prevServed.current = servedQty;
  }, [servedQty, pop]);

  const holdAnim = useRef<Animated.CompositeAnimation | null>(null);
  const startHold = () => {
    if (full || qty - servedQty < 2) return; // nothing extra a hold would do
    hold.setValue(0);
    holdAnim.current = Animated.timing(hold, { toValue: 1, duration: HOLD_MS, easing: Easing.linear, useNativeDriver: false });
    holdAnim.current.start();
  };
  const endHold = () => {
    holdAnim.current?.stop();
    Animated.timing(hold, { toValue: 0, duration: 120, useNativeDriver: false }).start();
  };

  const serveOne = () => {
    if (full) return;
    haptic(() => (servedQty + 1 >= qty
      ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)));
    onServeOne();
  };
  const serveRest = () => {
    if (full) return;
    haptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
    onServeRest();
  };

  // Round caps add half the stroke width at each end of an arc, so the gap
  // in the dash pattern has to be wider than the gap you see.
  const seg = C / qty;
  const gap = qty > 1 ? Math.min(2.5 + 3, seg * 0.5) : 0;
  const len = seg - gap;

  return (
    <Pressable
      onPress={serveOne}
      onLongPress={serveRest}
      delayLongPress={HOLD_MS}
      onPressIn={startHold}
      onPressOut={endHold}
      disabled={full}
      hitSlop={6}
      style={styles.ringHit}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={full ? undefined : qty - servedQty > 1 ? 'Tap to serve one, hold to serve all' : 'Tap to serve'}
    >
      <Animated.View style={{ transform: [{ scale: pop }] }}>
        <Svg width={32} height={32} viewBox="0 0 32 32">
          {qty === 1 ? (
            <Circle cx={16} cy={16} r={R} fill="none" strokeWidth={2.5} stroke={servedQty >= 1 ? GREEN : IDLE} />
          ) : (
            Array.from({ length: qty }, (_, j) => (
              <Circle
                key={j}
                cx={16}
                cy={16}
                r={R}
                fill="none"
                strokeWidth={3}
                strokeLinecap="round"
                stroke={j < servedQty ? GREEN : IDLE}
                strokeDasharray={`${len} ${C - len}`}
                strokeDashoffset={-(j * seg) - gap / 2}
                transform="rotate(-90 16 16)"
              />
            ))
          )}
          <AnimatedCircle
            cx={16}
            cy={16}
            r={HOLD_R}
            fill="none"
            stroke={GREEN_LIGHT}
            strokeWidth={3}
            strokeDasharray={`${HOLD_C}`}
            strokeDashoffset={hold.interpolate({ inputRange: [0, 1], outputRange: [HOLD_C, 0] })}
            transform="rotate(-90 16 16)"
          />
          {/* Grows past the arcs' outer edge so the gaps between them don't
              show as notches round a fully served ring. */}
          <AnimatedCircle cx={16} cy={16} r={fill.interpolate({ inputRange: [0, 1], outputRange: [0, R + 1.6] })} fill={GREEN} />
          <AnimatedPath
            d="M10 16.5l4 4 8-9"
            fill="none"
            stroke="#fff"
            strokeWidth={2.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={`${TICK_LEN}`}
            strokeDashoffset={fill.interpolate({ inputRange: [0, 0.55, 1], outputRange: [TICK_LEN, TICK_LEN, 0], extrapolate: 'clamp' })}
          />
          {qty > 1 && !full ? (
            <SvgText x={16} y={19.5} fontSize={9.5} fontWeight="600" fill={QuinckleColors.textTertiary} textAnchor="middle">
              {`${servedQty}/${qty}`}
            </SvgText>
          ) : null}
        </Svg>
      </Animated.View>
    </Pressable>
  );
}

// ── UndoButton ───────────────────────────────────────────────────────────────

const UR = 12.5;
const UC = 2 * Math.PI * UR;

export function UndoButton({
  visible,
  deadlineAt,
  windowMs,
  busy,
  onUndo,
  onExpiredPress,
}: {
  /** There is a serve that can (or, after the window, could have) been undone. */
  visible: boolean;
  /** Epoch ms the undo window closes, on THIS phone's clock. */
  deadlineAt: number | null;
  windowMs: number;
  /** A serve or undo for this row is still on its way — ignore taps. */
  busy?: boolean;
  onUndo: () => void;
  onExpiredPress: () => void;
}) {
  const appear = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const spin = useRef(new Animated.Value(0)).current;
  const shake = useRef(new Animated.Value(0)).current;
  const drain = useRef(new Animated.Value(1)).current;
  const [expired, setExpired] = useState(() => deadlineAt != null && deadlineAt <= Date.now());
  const spinningUntil = useRef(0);

  // Slide in from behind the ring once the tick has drawn; slide back out
  // after any spin in progress has finished.
  useEffect(() => {
    const wait = visible ? 200 : Math.max(0, spinningUntil.current - Date.now());
    const anim = Animated.timing(appear, {
      toValue: visible ? 1 : 0,
      duration: visible ? 500 : 280,
      delay: wait,
      easing: visible ? Easing.bezier(0.2, 0.9, 0.25, 1) : Easing.bezier(0.4, 0, 0.2, 1),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [visible, appear]);

  // The amber ring drains continuously to the deadline.
  useEffect(() => {
    if (deadlineAt == null) return;
    const left = deadlineAt - Date.now();
    if (left <= 0) {
      drain.setValue(0);
      setExpired(true);
      return;
    }
    setExpired(false);
    drain.setValue(Math.min(1, left / windowMs));
    const anim = Animated.timing(drain, { toValue: 0, duration: left, easing: Easing.linear, useNativeDriver: false });
    anim.start();
    const t = setTimeout(() => setExpired(true), left);
    return () => { anim.stop(); clearTimeout(t); };
  }, [deadlineAt, windowMs, drain]);

  const press = () => {
    if (!visible || busy || spinningUntil.current > Date.now()) return;
    if (expired || (deadlineAt != null && deadlineAt <= Date.now())) {
      setExpired(true);
      haptic(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
      shake.setValue(0);
      Animated.timing(shake, { toValue: 1, duration: 400, easing: Easing.linear, useNativeDriver: true }).start();
      onExpiredPress();
      return;
    }
    haptic(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium));
    spinningUntil.current = Date.now() + SPIN_MS;
    spin.setValue(0);
    Animated.timing(spin, { toValue: 1, duration: SPIN_MS, easing: Easing.bezier(0.4, 0.1, 0.3, 1), useNativeDriver: true }).start();
    onUndo();
  };

  const wrapStyle: Animated.WithAnimatedObject<ViewStyle> = {
    opacity: appear,
    transform: [
      { translateX: appear.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) },
      { scale: appear.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) },
    ],
  };

  return (
    <View style={styles.undoSlot} pointerEvents={visible ? 'auto' : 'none'}>
      <Animated.View style={wrapStyle}>
        <Pressable
          onPress={press}
          hitSlop={{ top: 8, bottom: 8, left: 4, right: 2 }}
          style={styles.undoHit}
          accessibilityRole="button"
          accessibilityLabel={expired ? 'Undo time limit passed' : 'Undo the last serve'}
          accessibilityState={{ disabled: expired }}
        >
          {!expired ? (
            <Svg width={28} height={28} viewBox="0 0 28 28" style={StyleSheet.absoluteFill}>
              <AnimatedCircle
                cx={14}
                cy={14}
                r={UR}
                fill="none"
                stroke={AMBER}
                strokeWidth={1.75}
                strokeLinecap="round"
                strokeDasharray={`${UC}`}
                strokeDashoffset={drain.interpolate({ inputRange: [0, 1], outputRange: [UC, 0] })}
                transform="rotate(-90 14 14)"
              />
            </Svg>
          ) : null}
          <Animated.View
            style={[
              styles.undoFace,
              expired && styles.undoFaceExpired,
              {
                transform: [
                  { rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-360deg'] }) },
                  { translateX: shake.interpolate({ inputRange: [0, 0.2, 0.4, 0.6, 0.8, 1], outputRange: [0, -3, 3, -3, 3, 0] }) },
                ],
              },
            ]}
          >
            {/* Drawn, not an icon font: centred on its own circle, so the
                spin turns it in place, and it renders the same on web. */}
            <Svg width={13} height={13} viewBox="0 0 24 24">
              <Path
                d="M19.95 11a8 8 0 1 0 -.5 4m.5 5v-5h-5"
                fill="none"
                stroke={expired ? QuinckleColors.textMuted : QuinckleColors.textPrimary}
                strokeWidth={2.4}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
          </Animated.View>
        </Pressable>
      </Animated.View>
    </View>
  );
}

// ── DimView — served rows fade instead of snapping ───────────────────────────

export function DimView({ dim, style, children }: { dim: boolean; style?: ViewStyle | ViewStyle[]; children: React.ReactNode }) {
  const o = useRef(new Animated.Value(dim ? 0.45 : 1)).current;
  useEffect(() => {
    Animated.timing(o, { toValue: dim ? 0.45 : 1, duration: 320, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [dim, o]);
  return <Animated.View style={[style as ViewStyle, { opacity: o }]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  ringHit: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  undoSlot: { width: 34, height: 44, alignItems: 'center', justifyContent: 'center' },
  undoHit: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  undoFace: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: QuinckleColors.surfaceElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  undoFaceExpired: { backgroundColor: QuinckleColors.surface, borderColor: QuinckleColors.border },
});
