/**
 * Payment success — "Liquid" (design H, chosen 2026-11-21).
 *
 * Green rises from the bottom with a moving wave → a big white tick is drawn
 * and settles with a spring (the app's existing payment sound plays on it) →
 * amount + how it was paid → small chips for what else happened (table freed,
 * handed over, e-bill sending/sent) → Done, whose light fill drains over 4 s
 * and then closes the screen by itself. Tapping Done closes it at once.
 *
 * Chips appear only for things that actually happened. The e-bill chip follows
 * `ebill` live: 'sending' → 'sent' | 'failed'. Closing never waits on it.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { playPaymentSuccess } from '../../services/sound';

const AnimatedPath = Animated.createAnimatedComponent(Path);

export type EbillChipState = 'sending' | 'sent' | 'already' | 'failed';

export interface LiquidSuccessInfo {
  /** "Table T03", "TK-23", … */
  locationLabel: string;
  total: number;
  splits: { method: string; amount: number }[];
  freed?: boolean;
  freeFailed?: boolean;
  handedOver?: boolean;
  handoverFailed?: boolean;
  ebill?: EbillChipState | null;
  ebillError?: string | null;
}

const AUTO_CLOSE_MS = 4000;
const TICK_LEN = 120;
const inr = (n: number) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

function paidLine(splits: LiquidSuccessInfo['splits']): { title: string; line: string } {
  const by = (m: string) => splits.find(s => s.method === m);
  const cash = by('CASH');
  const upi = by('UPI_DIRECT');
  const due = by('DUE');
  const parts = [cash, upi, due].filter(Boolean);
  if (due && parts.length === 1) return { title: 'Recorded', line: 'On khata (pay later)' };
  if (parts.length > 1) {
    return {
      title: due ? 'Recorded' : 'Paid',
      line: [cash && `${inr(cash.amount)} cash`, upi && `${inr(upi.amount)} UPI`, due && `${inr(due.amount)} khata`].filter(Boolean).join(' · '),
    };
  }
  return { title: 'Paid', line: upi ? 'Paid by UPI' : 'Paid in cash' };
}

/** "Table T03" → "T03"; takeaway labels pass through. */
const shortLabel = (label: string) => label.replace(/^Table\s+/i, '');

function Wave({ width, color, opacity, duration, reverse, top }: { width: number; color: string; opacity: number; duration: number; reverse?: boolean; top: number }) {
  const x = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(x, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [x, duration]);
  const tx = x.interpolate({ inputRange: [0, 1], outputRange: reverse ? [-width, 0] : [0, -width] });
  const w2 = width * 2;
  const q = width / 4;
  // Four humps per screen width, drawn twice so the loop is seamless.
  let d = `M0 12`;
  for (let i = 0; i < 8; i++) d += ` Q${q * i + q / 2} ${i % 2 ? 24 : 0} ${q * (i + 1)} 12`;
  d += ` V24 H0 Z`;
  return (
    <Animated.View style={{ position: 'absolute', left: 0, top, width: w2, height: 24, opacity, transform: [{ translateX: tx }] }} pointerEvents="none">
      <Svg width={w2} height={24} viewBox={`0 0 ${w2} 24`} preserveAspectRatio="none">
        <Path d={d} fill={color} />
      </Svg>
    </Animated.View>
  );
}

function Chip({ show, filled, icon, spinning, label, tone }: {
  show: Animated.Value; filled: boolean; icon?: React.ComponentProps<typeof Ionicons>['name']; spinning?: boolean; label: string; tone?: 'warn';
}) {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!spinning) return;
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 700, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [spinning, spin]);
  const rot = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const fg = filled ? '#15803D' : '#fff';
  return (
    <Animated.View
      style={[
        st.chip,
        filled ? st.chipFilled : st.chipOutline,
        tone === 'warn' && st.chipWarn,
        { opacity: show, transform: [{ translateY: show.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] },
      ]}
    >
      {spinning ? (
        <Animated.View style={[st.chipSpin, { transform: [{ rotate: rot }] }]} />
      ) : icon ? (
        <Ionicons name={icon} size={15} color={tone === 'warn' ? '#7C2D12' : fg} />
      ) : null}
      <Text style={[st.chipText, { color: tone === 'warn' ? '#7C2D12' : fg }]} numberOfLines={1}>{label}</Text>
    </Animated.View>
  );
}

export function PaymentSuccessLiquid({ info, onDone }: { info: LiquidSuccessInfo; onDone: () => void }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const rise = useRef(new Animated.Value(0)).current;
  const tick = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(0.9)).current;
  const tickOpacity = useRef(new Animated.Value(0)).current;
  const text = useRef(new Animated.Value(0)).current;
  const chip1 = useRef(new Animated.Value(0)).current;
  const chip2 = useRef(new Animated.Value(0)).current;
  const chip3 = useRef(new Animated.Value(0)).current;
  const done = useRef(new Animated.Value(0)).current;
  const drain = useRef(new Animated.Value(1)).current;
  const [interactive, setInteractive] = useState(false);
  const closedRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const close = () => {
    if (closedRef.current) return;
    closedRef.current = true;
    onDoneRef.current();
  };

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    // 1. Liquid rises (≈1 s)
    Animated.timing(rise, { toValue: 1, duration: 1000, easing: Easing.bezier(0.55, 0, 0.25, 1), useNativeDriver: true }).start();
    // 2. Tick draws, then settles with a spring; the app's sound lands on it.
    timers.push(setTimeout(() => {
      tickOpacity.setValue(1);
      playPaymentSuccess();
      Animated.timing(tick, { toValue: 1, duration: 480, easing: Easing.bezier(0.65, 0, 0.35, 1), useNativeDriver: false }).start();
      Animated.sequence([
        Animated.delay(260),
        Animated.spring(pop, { toValue: 1, friction: 4, tension: 120, useNativeDriver: true }),
      ]).start();
    }, 900));
    // 3. Amount + method
    timers.push(setTimeout(() => {
      Animated.timing(text, { toValue: 1, duration: 520, easing: Easing.bezier(0.22, 1, 0.36, 1), useNativeDriver: true }).start();
    }, 1300));
    // 4. Chips, one after another
    [chip1, chip2, chip3].forEach((c, i) => timers.push(setTimeout(() => {
      Animated.spring(c, { toValue: 1, friction: 7, tension: 90, useNativeDriver: true }).start();
    }, 1700 + i * 150)));
    // 5. Done, then the 4 s drain → close
    timers.push(setTimeout(() => {
      setInteractive(true);
      Animated.timing(done, { toValue: 1, duration: 400, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
      Animated.timing(drain, { toValue: 0, duration: AUTO_CLOSE_MS, delay: 350, easing: Easing.linear, useNativeDriver: true })
        .start(({ finished }) => { if (finished) close(); });
    }, 2150));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { title, line } = paidLine(info.splits);
  const loc = shortLabel(info.locationLabel);
  const lift = rise.interpolate({ inputRange: [0, 1], outputRange: [height * 1.15, -height * 0.12] });
  const dashoffset = tick.interpolate({ inputRange: [0, 1], outputRange: [TICK_LEN, 0] });

  type ChipSpec = { key: string; filled: boolean; icon?: React.ComponentProps<typeof Ionicons>['name']; spinning?: boolean; label: string; tone?: 'warn' };
  const chips: ChipSpec[] = [];
  if (info.freed) chips.push({ key: 'free', filled: true, icon: 'checkmark', label: `${loc} free` });
  if (info.freeFailed) chips.push({ key: 'free-x', filled: true, tone: 'warn', icon: 'alert-circle', label: `Free ${loc} from the floor` });
  if (info.handedOver) chips.push({ key: 'ho', filled: true, icon: 'checkmark', label: `${loc} handed over` });
  if (info.handoverFailed) chips.push({ key: 'ho-x', filled: true, tone: 'warn', icon: 'alert-circle', label: 'Hand over from Takeaway' });
  if (info.ebill === 'sending') chips.push({ key: 'eb', filled: false, spinning: true, label: 'E-bill sending' });
  if (info.ebill === 'sent' || info.ebill === 'already') chips.push({ key: 'eb', filled: true, icon: 'logo-whatsapp', label: info.ebill === 'already' ? 'E-bill already sent' : 'E-bill sent' });
  if (info.ebill === 'failed') chips.push({ key: 'eb', filled: true, tone: 'warn', icon: 'alert-circle', label: 'E-bill not sent' });
  const chipShows = [chip1, chip2, chip3];

  return (
    <View style={st.screen} pointerEvents="auto">
      <Animated.View style={[st.liquid, { height: height * 1.3, transform: [{ translateY: lift }] }]} pointerEvents="none">
        <Wave width={width} color="#27C25F" opacity={1} duration={1600} top={-22} />
        <Wave width={width} color="#7BE3A0" opacity={0.55} duration={2300} reverse top={-16} />
      </Animated.View>

      <View style={[st.body, { paddingTop: insets.top, paddingBottom: insets.bottom + 24 }]} pointerEvents="box-none">
        <View style={st.mid}>
          <Animated.View style={{ opacity: tickOpacity, transform: [{ scale: pop }] }}>
            <Svg width={150} height={150} viewBox="0 0 100 100">
              <Path d="M24 57l17 17 37-40" stroke="#063d18" strokeOpacity={0.18} strokeWidth={13} strokeLinecap="round" strokeLinejoin="round" fill="none" />
              <AnimatedPath
                d="M24 53l17 17 37-40"
                stroke="#fff"
                strokeWidth={12}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
                strokeDasharray={`${TICK_LEN}`}
                strokeDashoffset={dashoffset}
              />
            </Svg>
          </Animated.View>
          <Animated.View style={{ alignItems: 'center', opacity: text, transform: [{ translateY: text.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }] }}>
            <Text style={st.amount}>{inr(info.total)}</Text>
            <Text style={st.meta}>{title === 'Paid' ? line : `${title} · ${line}`} · {info.locationLabel}</Text>
          </Animated.View>
        </View>

        {chips.length > 0 && (
          <View style={st.chips}>
            {chips.slice(0, 3).map((c, i) => (
              <Chip key={c.key} show={chipShows[i]} filled={c.filled} icon={c.icon} spinning={c.spinning} label={c.label} tone={c.tone} />
            ))}
          </View>
        )}
        {info.ebill === 'failed' && !!info.ebillError && (
          <Animated.Text style={[st.ebillErr, { opacity: chip3 }]} numberOfLines={2}>{info.ebillError} · resend from the bill</Animated.Text>
        )}

        <Animated.View style={{ opacity: done, transform: [{ translateY: done.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }] }}>
          <TouchableOpacity style={st.done} onPress={close} disabled={!interactive} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel="Done">
            <Animated.View style={[StyleSheet.absoluteFill, st.drain, { transform: [{ scaleX: drain }] }]} />
            <Text style={st.doneText}>Done</Text>
          </TouchableOpacity>
          <Text style={st.closing}>Closes automatically</Text>
        </Animated.View>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  screen: { ...StyleSheet.absoluteFillObject, zIndex: 999, backgroundColor: 'transparent', overflow: 'hidden' },
  liquid: { position: 'absolute', left: 0, right: 0, top: 0, backgroundColor: '#17A04A' },
  body: { flex: 1, paddingHorizontal: 24 },
  mid: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 20 },
  amount: { color: '#fff', fontSize: 60, fontWeight: '800', letterSpacing: -2.5, marginTop: 10, fontVariant: ['tabular-nums'] },
  meta: { color: 'rgba(255,255,255,0.88)', fontSize: 15, fontWeight: '500', marginTop: 8, textAlign: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginBottom: 12 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingLeft: 11, paddingRight: 14, borderRadius: 17 },
  chipFilled: { backgroundColor: '#fff' },
  chipOutline: { borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.75)' },
  chipWarn: { backgroundColor: '#FDE68A' },
  chipSpin: { width: 13, height: 13, borderRadius: 7, borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)', borderTopColor: '#fff' },
  chipText: { fontSize: 13.5, fontWeight: '700' },
  ebillErr: { color: 'rgba(255,255,255,0.85)', fontSize: 12.5, textAlign: 'center', marginBottom: 10 },
  done: { height: 54, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.2)', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginTop: 10 },
  drain: { backgroundColor: 'rgba(255,255,255,0.2)', transformOrigin: 'left' },
  doneText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  closing: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontWeight: '500', textAlign: 'center', marginTop: 8 },
});
