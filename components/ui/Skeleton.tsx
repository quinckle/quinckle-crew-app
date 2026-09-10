/**
 * Skeleton — pulsing loading placeholders.
 * Mirrors the partner app's Skeleton.tsx exactly.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, ViewStyle } from 'react-native';
import { QuinckleColors, Radius } from '../../constants/Colors';

// ── Pulse hook ────────────────────────────────────────────────────────────────

function usePulse() {
  const opacity = useRef(new Animated.Value(0.35)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.75, duration: 700, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.35, duration: 700, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [opacity]);
  return opacity;
}

// ── Base block ────────────────────────────────────────────────────────────────

interface SkeletonProps {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: ViewStyle;
}

export function Skeleton({ width, height = 14, radius = Radius.sm, style }: SkeletonProps) {
  const opacity = usePulse();
  return (
    <Animated.View
      style={[
        { width, height, borderRadius: radius, backgroundColor: QuinckleColors.surfaceElevated },
        { opacity },
        style,
      ]}
    />
  );
}

// ── Card container ────────────────────────────────────────────────────────────

export function SkeletonCard({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return (
    <View style={[skStyles.card, style]}>
      {children}
    </View>
  );
}

// ── One row inside a card (label left, value right) ───────────────────────────

export function SkeletonRow({
  labelWidth = 90,
  valueWidth = 60,
  last = false,
}: {
  labelWidth?: number;
  valueWidth?: number;
  last?: boolean;
}) {
  return (
    <>
      <View style={skStyles.row}>
        <Skeleton width={labelWidth} height={13} />
        <Skeleton width={valueWidth} height={13} />
      </View>
      {!last && <View style={skStyles.sep} />}
    </>
  );
}

// ── Section label above a card ────────────────────────────────────────────────

export function SkeletonLabel({ style }: { style?: ViewStyle }) {
  return <Skeleton width={72} height={10} radius={4} style={{ marginBottom: 10, ...style }} />;
}

const skStyles = StyleSheet.create({
  card: {
    backgroundColor: QuinckleColors.surface,
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  sep: {
    height: 0.5,
    backgroundColor: QuinckleColors.borderSubtle,
    marginLeft: 16,
  },
});
