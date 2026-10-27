/**
 * PrinterSkeleton — first-paint placeholder for app/printer.tsx.
 * Mirrors the real screen's shape (PRINTERS / THIS DEVICE / ACTIONS cards) so
 * the layout doesn't jump when data lands — same phone/desktop split the
 * real screen uses (see hooks/useResponsive.ts's isWide).
 */

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';
import { ShimmerBlock } from './TableSkeleton';

const SHIMMER_DURATION_MS = 1500;
const SWEEP_DISTANCE = 350;

function PrinterRowSkeleton({ translateX, last }: { translateX: Animated.AnimatedInterpolation<number>; last?: boolean }) {
  return (
    <View style={[styles.printerRow, last && { borderBottomWidth: 0 }]}>
      <ShimmerBlock translateX={translateX} width={140} height={15} radius={4} style={{ marginBottom: 6 }} />
      <ShimmerBlock translateX={translateX} width={180} height={12} radius={4} style={{ marginBottom: 6 }} />
      <ShimmerBlock translateX={translateX} width={120} height={12} radius={4} style={{ marginBottom: 10 }} />
      <View style={{ flexDirection: 'row', gap: Spacing.sm }}>
        <ShimmerBlock translateX={translateX} width={64} height={26} radius={Radius.md} />
        <ShimmerBlock translateX={translateX} width={54} height={26} radius={Radius.md} />
        <ShimmerBlock translateX={translateX} width={68} height={26} radius={Radius.md} />
      </View>
    </View>
  );
}

export function PrinterSkeleton({ isWide }: { isWide: boolean }) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: SHIMMER_DURATION_MS,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [progress]);

  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [-SWEEP_DISTANCE, SWEEP_DISTANCE] });

  const printersCard = (
    <View style={styles.card}>
      <ShimmerBlock translateX={translateX} width={64} height={10} radius={4} style={{ marginBottom: Spacing.md }} />
      <PrinterRowSkeleton translateX={translateX} />
      <PrinterRowSkeleton translateX={translateX} last />
    </View>
  );

  const statusCard = (
    <View style={styles.card}>
      <ShimmerBlock translateX={translateX} width={88} height={10} radius={4} style={{ marginBottom: Spacing.md }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.md }}>
        <ShimmerBlock translateX={translateX} width={10} height={10} radius={5} />
        <ShimmerBlock translateX={translateX} width={150} height={15} radius={4} />
      </View>
      {[0, 1].map((i) => (
        <View key={i} style={styles.toggleRow}>
          <View style={{ flex: 1 }}>
            <ShimmerBlock translateX={translateX} width={130} height={13} radius={4} style={{ marginBottom: 6 }} />
            <ShimmerBlock translateX={translateX} width={190} height={11} radius={4} />
          </View>
          <ShimmerBlock translateX={translateX} width={44} height={24} radius={12} />
        </View>
      ))}
    </View>
  );

  const actionsCard = (
    <View style={[styles.card, { paddingVertical: Spacing.sm }]}>
      {[0, 1, 2].map((i) => (
        <View key={i} style={[styles.actionRow, i === 2 && { borderBottomWidth: 0 }]}>
          <ShimmerBlock translateX={translateX} width={18} height={18} radius={4} />
          <ShimmerBlock translateX={translateX} width={120} height={14} radius={4} />
        </View>
      ))}
    </View>
  );

  if (isWide) {
    return (
      <View style={styles.wideRow}>
        <View style={styles.wideLeftPane}>{printersCard}</View>
        <View style={styles.wideDivider} />
        <View style={styles.wideRightRail}>
          {statusCard}
          {actionsCard}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.scroll}>
      {printersCard}
      {statusCard}
      {actionsCard}
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  card: {
    backgroundColor: QuinckleColors.surface,
    borderRadius: Radius.lg,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.lg,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
  },
  printerRow: {
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: QuinckleColors.border,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: QuinckleColors.border,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: QuinckleColors.border,
  },
  wideRow: { flex: 1, flexDirection: 'row' },
  wideLeftPane: { flex: 1 },
  wideDivider: { width: 1, backgroundColor: QuinckleColors.border, flexGrow: 0, flexShrink: 0 },
  wideRightRail: { width: 560, flexGrow: 0, flexShrink: 0 },
});
