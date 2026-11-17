/**
 * PujaGreeting — a one-time Durga Puja thank-you card for the crew.
 *
 * Shows once per staff member per device, inside the Puja window (Panchami
 * 16 Oct → Dashami 21 Oct 2026, IST), a beat after the screen has painted.
 * Any tap closes it. It must never stand between a steward and service, so:
 *   • it is marked seen the moment it shows (a killed app doesn't bring it back),
 *   • it renders BELOW the item-ready cards (the parent mounts it first),
 *   • a crash inside it renders nothing rather than taking the screen down.
 *
 * Same "Lal paar" look as the diner splash (cream card, red saree bands with
 * temple teeth, Maa's eyes). Built only from Animated (native driver: opacity
 * and transforms run on the UI thread), react-native-svg and expo-font — all
 * already bundled — so it ships OTA with no fingerprint change.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Font from 'expo-font';
import Svg, { Path, Rect } from 'react-native-svg';
import { useAuth } from '../../context/AuthContext';

const WINDOW_START = Date.parse('2026-10-16T00:00:00+05:30');
const WINDOW_END = Date.parse('2026-10-21T23:59:59+05:30');
const SEEN_KEY = (staffId: string) => `puja2026:greeting-seen:${staffId}`;
// Galada, subset to just "শুভ শারদীয়া" (7KB). SIL OFL.
const HEADLINE_FONT = 'GaladaPuja';

const LAAL = '#A3101F';
const MAROON = '#830313';
const CREAM = '#F6ECD6';
const EYES = require('../../assets/puja/maa-eyes.png');
const EYES_RATIO = 239 / 450;
const PETAL_COLORS = ['#F28C28', '#F6B53D', '#E8742A', '#FBC75A'];

class Quiet extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { /* decorative only — never surface */ }
  render() { return this.state.failed ? null : this.props.children; }
}

/** Solid band plus a row of temple-border teeth pointing into the card. */
function SareeBand({ width, edge }: { width: number; edge: 'top' | 'bottom' }) {
  const band = 34;
  const tooth = 12;
  const depth = 8;
  let teeth = '';
  for (let x = 0; x < width + tooth; x += tooth) {
    teeth += edge === 'top'
      ? `M${x} ${band} L${x + tooth} ${band} L${x + tooth / 2} ${band + depth} Z `
      : `M${x} ${depth} L${x + tooth} ${depth} L${x + tooth / 2} 0 Z `;
  }
  return (
    <Svg width={width} height={band + depth}>
      <Rect x={0} y={edge === 'top' ? 0 : depth} width={width} height={band} fill={LAAL} />
      <Path d={teeth} fill={LAAL} />
    </Svg>
  );
}

function Card({ firstName, onClose }: { firstName: string; onClose: () => void }) {
  const { width: screenW, height: screenH } = useWindowDimensions();
  const cardW = Math.min(screenW - 36, 380);
  const eyesW = 150;

  const scrim = useRef(new Animated.Value(0)).current;
  const card = useRef(new Animated.Value(0)).current;
  const bands = useRef(new Animated.Value(0)).current;
  const eyes = useRef(new Animated.Value(0)).current;
  const lines = useRef([0, 1, 2, 3, 4, 5].map(() => new Animated.Value(0))).current;
  const petals = useMemo(() => Array.from({ length: 14 }, (_, i) => ({
    v: new Animated.Value(0),
    left: 4 + Math.random() * 92,
    dx: -30 + Math.random() * 60,
    rot: 180 + Math.random() * 360,
    dur: 3200 + Math.random() * 2200,
    delay: 900 + Math.random() * 1600,
    color: PETAL_COLORS[i % PETAL_COLORS.length],
  })), []);
  const closing = useRef(false);

  useEffect(() => {
    const t = (v: Animated.Value, duration: number, delay: number) =>
      Animated.timing(v, { toValue: 1, duration, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true });
    Animated.parallel([
      t(scrim, 300, 0),
      Animated.spring(card, { toValue: 1, delay: 120, friction: 8, tension: 60, useNativeDriver: true }),
      t(bands, 700, 350),
      t(eyes, 1100, 600),
      ...lines.map((v, i) => t(v, 700, 1050 + i * 160)),
      ...petals.map(p => Animated.timing(p.v, { toValue: 1, duration: p.dur, delay: p.delay, easing: Easing.linear, useNativeDriver: true })),
    ]).start();
  }, [scrim, card, bands, eyes, lines, petals]);

  const close = () => {
    if (closing.current) return;
    closing.current = true;
    Animated.parallel([
      Animated.timing(card, { toValue: 0, duration: 260, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
      Animated.timing(scrim, { toValue: 0, duration: 300, easing: Easing.in(Easing.cubic), useNativeDriver: true }),
    ]).start(onClose);
  };

  const rise = (v: Animated.Value) => ({
    opacity: v,
    transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
  });

  return (
    <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityRole="button" accessibilityLabel="Close Puja greeting">
      <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, { opacity: scrim }]} />

      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {petals.map((p, i) => (
          <Animated.View
            key={i}
            style={[styles.petal, {
              left: `${p.left}%`,
              backgroundColor: p.color,
              opacity: p.v.interpolate({ inputRange: [0, 0.1, 0.85, 1], outputRange: [0, 0.95, 0.9, 0] }),
              transform: [
                { translateY: p.v.interpolate({ inputRange: [0, 1], outputRange: [0, screenH + 40] }) },
                { translateX: p.v.interpolate({ inputRange: [0, 1], outputRange: [0, p.dx] }) },
                { rotate: p.v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${p.rot}deg`] }) },
              ],
            }]}
          />
        ))}
      </View>

      <View style={styles.stage} pointerEvents="box-none">
        <Animated.View
          style={[styles.card, {
            width: cardW,
            opacity: card,
            transform: [
              { translateY: card.interpolate({ inputRange: [0, 1], outputRange: [46, 0] }) },
              { scale: card.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
            ],
          }]}
        >
          <Animated.View style={{ transform: [{ translateY: bands.interpolate({ inputRange: [0, 1], outputRange: [-44, 0] }) }] }}>
            <SareeBand width={cardW} edge="top" />
          </Animated.View>

          <View style={styles.body}>
            <Animated.Image
              source={EYES}
              style={{
                width: eyesW,
                height: eyesW * EYES_RATIO,
                opacity: eyes.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, 1, 1] }),
                // Opens like eyes (চক্ষুদান): a vertical squash, released.
                transform: [{ scaleY: eyes.interpolate({ inputRange: [0, 1], outputRange: [0.04, 1] }) }],
              }}
              resizeMode="contain"
            />
            <Animated.Text
              style={[styles.headline, Font.isLoaded(HEADLINE_FONT) && { fontFamily: HEADLINE_FONT }, rise(lines[0])]}
            >শুভ শারদীয়া</Animated.Text>
            <Animated.Text style={[styles.dear, rise(lines[1])]}>প্রিয় {firstName},</Animated.Text>
            <Animated.Text style={[styles.msg, rise(lines[2])]}>
              এই পুজোয় সবচেয়ে ব্যস্ত হাতগুলো আপনাদের। প্রতিটা অর্ডার, প্রতিটা হাসি — আপনাদের জন্যই Quinckle চলে।
            </Animated.Text>
            <Animated.Text style={[styles.en, rise(lines[3])]}>
              This Puja, the busiest hands are yours. Every order, every smile — Quinckle runs because of you.
            </Animated.Text>
            <Animated.Text style={[styles.sig, rise(lines[4])]}>— টিম Quinckle</Animated.Text>
            <Animated.View style={[styles.okWrap, rise(lines[5])]}>
              <Pressable onPress={close} style={({ pressed }) => [styles.ok, pressed && { opacity: 0.85 }]} accessibilityRole="button">
                <Text style={styles.okText}>ধন্যবাদ</Text>
              </Pressable>
            </Animated.View>
          </View>

          <Animated.View style={{ transform: [{ translateY: bands.interpolate({ inputRange: [0, 1], outputRange: [44, 0] }) }] }}>
            <SareeBand width={cardW} edge="bottom" />
          </Animated.View>
        </Animated.View>
      </View>
    </Pressable>
  );
}

function Gate() {
  const { staffInfo } = useAuth();
  const [show, setShow] = useState(false);
  const staffId = staffInfo?.id;

  useEffect(() => {
    if (!staffId) return;
    const now = Date.now();
    if (now < WINDOW_START || now > WINDOW_END) return;
    let cancelled = false;
    (async () => {
      // Dev builds ignore "seen" so the card can be re-tested on every reload.
      if (!__DEV__ && await AsyncStorage.getItem(SEEN_KEY(staffId)).catch(() => '1')) return;
      // The headline face, capped: a slow load falls back to the system Bengali
      // font rather than holding the card back.
      await Promise.race([
        Font.loadAsync({ [HEADLINE_FONT]: require('../../assets/puja/Galada-Puja.ttf') }).catch(() => {}),
        new Promise(r => setTimeout(r, 1500)),
      ]);
      // Let the floor screen paint and settle first.
      await new Promise(r => setTimeout(r, 900));
      if (cancelled) return;
      // Seen on show, not on close: once means once, even if the app is killed mid-card.
      void AsyncStorage.setItem(SEEN_KEY(staffId), String(Date.now())).catch(() => {});
      setShow(true);
    })();
    return () => { cancelled = true; };
  }, [staffId]);

  if (!show || !staffInfo) return null;
  const firstName = staffInfo.name.trim().split(/\s+/)[0] || staffInfo.name;
  return (
    <View style={styles.overlay}>
      <Card firstName={firstName} onClose={() => setShow(false)} />
    </View>
  );
}

export function PujaGreeting() {
  return (
    <Quiet>
      <Gate />
    </Quiet>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, zIndex: 900, elevation: 900 },
  scrim: { backgroundColor: 'rgba(12,6,6,0.58)' },
  stage: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: 26, overflow: 'hidden', backgroundColor: CREAM },
  body: { paddingHorizontal: 22, paddingTop: 18, paddingBottom: 14, alignItems: 'center' },
  // Galada is applied at render, once loaded; until then the system Bengali face.
  headline: { fontSize: 38, lineHeight: 50, color: MAROON, marginTop: 10, textAlign: 'center' },
  dear: { fontSize: 15, fontWeight: '600', color: MAROON, marginTop: 8, textAlign: 'center' },
  msg: { fontSize: 15, lineHeight: 24, color: '#4a2a1c', marginTop: 6, textAlign: 'center' },
  en: { fontSize: 12.5, lineHeight: 18, color: '#8a6a55', marginTop: 8, textAlign: 'center', fontStyle: 'italic' },
  sig: { fontSize: 13, color: '#6B3A1E', marginTop: 14, textAlign: 'center' },
  okWrap: { alignSelf: 'stretch', marginTop: 16 },
  ok: { height: 50, borderRadius: 14, backgroundColor: MAROON, alignItems: 'center', justifyContent: 'center' },
  okText: { color: '#FFF4E0', fontSize: 17, fontWeight: '600' },
  petal: { position: 'absolute', top: -16, width: 9, height: 12, borderRadius: 6 },
});
