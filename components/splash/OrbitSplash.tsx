/**
 * Orbit — the crew app's launch animation (same family as the partner app).
 *
 * Two orange→red arcs spin in and collapse to the centre, the Q mark pops,
 * then slides left while "uinckle" wipes out beside it and "Crew" fades up.
 * ~1.8s. Built from RN Animated + react-native-svg only, so it needs no new
 * native code.
 *
 * The wordmark is one image split into three windows (Q / uinckle / Crew) with
 * overflow:hidden instead of clip-path.
 */

import { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, RadialGradient, Stop } from 'react-native-svg';

const WORDMARK = require('../../assets/images/logo/quinckle-crew-wordmark.png');
const ASPECT = 415 / 1280;
// Fractions of the wordmark image: where the Q ends, where "uinckle" ends
// vertically, and where "Crew" sits.
const Q_W = 0.272;
const WORD_H = 0.69;
const SUB_X = 0.75;
const SUB_Y = 0.71;

/** Total length; the caller can navigate once this has passed. */
export const ORBIT_SPLASH_MS = 1850;

const ease = Easing.bezier(0.5, 0, 0.2, 1);
const snap = Easing.bezier(0.7, 0, 0.2, 1);
const pop = Easing.bezier(0.2, 1.6, 0.4, 1);

function Arc({ size, radius, stroke, dash }: { size: number; radius: number; stroke: number; dash: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <LinearGradient id="orbitArc" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor="#EF4444" stopOpacity="0" />
          <Stop offset="1" stopColor="#F35D3B" />
        </LinearGradient>
      </Defs>
      <Circle cx="50" cy="50" r={radius} fill="none" stroke="url(#orbitArc)" strokeWidth={stroke}
        strokeLinecap="round" strokeDasharray={dash} />
    </Svg>
  );
}

export function OrbitSplash() {
  const { width: screenW } = useWindowDimensions();
  const W = Math.min(260, screenW * 0.64);
  const H = W * ASPECT;
  const k = W / 190; // the concept was drawn on a 190px-wide logo

  const orbit = useRef(new Animated.Value(0)).current;
  const mark = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(0)).current;
  const wipe = useRef(new Animated.Value(0)).current;
  const sub = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const at = (ms: number, a: Animated.CompositeAnimation) => Animated.sequence([Animated.delay(ms), a]);
    const anim = Animated.parallel([
      Animated.timing(orbit, { toValue: 1, duration: 850, easing: ease, useNativeDriver: true }),
      at(730, Animated.timing(mark, { toValue: 1, duration: 400, easing: pop, useNativeDriver: true })),
      at(700, Animated.timing(glow, { toValue: 1, duration: 700, easing: Easing.out(Easing.quad), useNativeDriver: true })),
      at(1000, Animated.timing(slide, { toValue: 1, duration: 540, easing: snap, useNativeDriver: true })),
      // Width can't run on the native driver; it's one short tween.
      at(1080, Animated.timing(wipe, { toValue: 1, duration: 540, easing: snap, useNativeDriver: false })),
      at(1430, Animated.timing(sub, { toValue: 1, duration: 400, easing: Easing.out(Easing.quad), useNativeDriver: true })),
    ]);
    anim.start();
    return () => { anim.stop(); };
  }, [orbit, mark, glow, slide, wipe, sub]);

  const orbStyle = (size: number, turns: [string, string, string], scales: [number, number, number]) => ({
    position: 'absolute' as const,
    width: size, height: size,
    opacity: orbit.interpolate({ inputRange: [0, 0.15, 0.8, 1], outputRange: [0, 1, 1, 0] }),
    transform: [
      { rotate: orbit.interpolate({ inputRange: [0, 0.8, 1], outputRange: turns }) },
      { scale: orbit.interpolate({ inputRange: [0, 0.8, 1], outputRange: scales }) },
    ],
  });

  const o1 = 150 * k;
  const o2 = 96 * k;
  const g = 320 * k;

  return (
    <View style={styles.stage} pointerEvents="none">
      {/* Glow burst behind the mark */}
      <Animated.View style={{
        position: 'absolute', width: g, height: g,
        opacity: glow.interpolate({ inputRange: [0, 0.35, 1], outputRange: [0, 1, 0.35] }),
        transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1.1] }) }],
      }}>
        <Svg width={g} height={g}>
          <Defs>
            <RadialGradient id="orbitGlow" cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor="#F35D3B" stopOpacity="0.35" />
              <Stop offset="0.4" stopColor="#EF4444" stopOpacity="0.08" />
              <Stop offset="0.65" stopColor="#EF4444" stopOpacity="0" />
            </RadialGradient>
          </Defs>
          <Circle cx={g / 2} cy={g / 2} r={g / 2} fill="url(#orbitGlow)" />
        </Svg>
      </Animated.View>

      <Animated.View style={orbStyle(o1, ['0deg', '540deg', '620deg'], [1.4, 0.42, 0.36])}>
        <Arc size={o1} radius={46} stroke={3} dash="110 300" />
      </Animated.View>
      <Animated.View style={orbStyle(o2, ['0deg', '-500deg', '-580deg'], [1.6, 0.4, 0.34])}>
        <Arc size={o2} radius={44} stroke={4} dash="90 300" />
      </Animated.View>

      <View style={{ width: W, height: H }}>
        {/* Starts with the Q centred, then slides left to make room */}
        <Animated.View style={[StyleSheet.absoluteFill, {
          transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [W * (0.5 - Q_W / 2), 0] }) }],
        }]}>
          <Animated.View style={{
            position: 'absolute', left: 0, top: 0, width: W * Q_W, height: H, overflow: 'hidden',
            opacity: mark.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1] }),
            transform: [{ scale: mark.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
          }}>
            <Image source={WORDMARK} style={{ width: W, height: H }} />
          </Animated.View>

          <Animated.View style={{
            position: 'absolute', left: W * Q_W, top: 0, height: H * WORD_H, overflow: 'hidden',
            width: wipe.interpolate({ inputRange: [0, 1], outputRange: [0, W * (1 - Q_W)] }),
          }}>
            <Image source={WORDMARK} style={{ position: 'absolute', left: -W * Q_W, top: 0, width: W, height: H }} />
          </Animated.View>

          <Animated.View style={{
            position: 'absolute', left: W * SUB_X, top: H * SUB_Y, width: W * (1 - SUB_X), height: H * (1 - SUB_Y), overflow: 'hidden',
            opacity: sub,
            transform: [{ translateY: sub.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }],
          }}>
            <Image source={WORDMARK} style={{ position: 'absolute', left: -W * SUB_X, top: -H * SUB_Y, width: W, height: H }} />
          </Animated.View>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
});
