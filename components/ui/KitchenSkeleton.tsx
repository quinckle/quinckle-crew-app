/**
 * KitchenSkeleton — shimmer placeholder for the cook ticket list.
 * Three placeholder cards matching the real KitchenTicketCard footprint.
 *
 * Same shimmer recipe as TableSkeleton — single animated sweep driven by
 * the native driver, no setState churn after mount.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { ShimmerBlock } from './TableSkeleton';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';

const SHIMMER_DURATION_MS = 1500;
const CARD_COUNT          = 3;
const SWEEP_DISTANCE      = 260;

function TicketSkeletonCard({
  translateX,
}: {
  translateX: Animated.AnimatedInterpolation<number>;
}) {
  return (
    <View style={styles.card}>
      {/* Left accent strip */}
      <View style={styles.accent} />
      <View style={styles.body}>
        {/* Header */}
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <ShimmerBlock translateX={translateX} width={42}  height={22} radius={6} />
            <ShimmerBlock translateX={translateX} width={38}  height={20} radius={Radius.sm} style={{ marginLeft: Spacing.sm }} />
          </View>
          <ShimmerBlock translateX={translateX} width={66} height={22} radius={Radius.sm} />
        </View>

        {/* Progress row */}
        <View style={styles.progressRow}>
          <ShimmerBlock translateX={translateX} width={'92%' as any} height={4} radius={2} />
          <ShimmerBlock translateX={translateX} width={24}  height={10} radius={3} style={{ marginLeft: Spacing.sm }} />
        </View>

        {/* Item rows */}
        {[0, 1, 2].map((i) => (
          <View key={i} style={styles.itemRow}>
            <ShimmerBlock translateX={translateX} width={22} height={22} radius={11} />
            <View style={{ marginLeft: Spacing.sm, flex: 1 }}>
              <ShimmerBlock
                translateX={translateX}
                width={i === 0 ? '76%' : i === 1 ? '64%' : '52%' as any}
                height={12}
                radius={4}
              />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

export function KitchenSkeleton() {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue:  1,
        duration: SHIMMER_DURATION_MS,
        easing:   Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [progress]);

  const translateX = progress.interpolate({
    inputRange:  [0, 1],
    outputRange: [-SWEEP_DISTANCE, SWEEP_DISTANCE],
  });

  return (
    <View style={styles.container}>
      {Array.from({ length: CARD_COUNT }).map((_, i) => (
        <TicketSkeletonCard key={i} translateX={translateX} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: Spacing.md,
  },
  card: {
    flexDirection:   'row',
    backgroundColor: QuinckleColors.surface,
    borderRadius:    Radius.lg,
    borderWidth:     1,
    borderColor:     QuinckleColors.border,
    overflow:        'hidden',
  },
  accent: {
    width:           3,
    alignSelf:       'stretch',
    backgroundColor: QuinckleColors.borderStrong,
  },
  body: {
    flex:    1,
    padding: Spacing.lg,
  },
  headerRow: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    marginBottom:   Spacing.md,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems:    'center',
  },
  progressRow: {
    flexDirection: 'row',
    alignItems:    'center',
    marginBottom:  Spacing.md,
  },
  itemRow: {
    flexDirection:   'row',
    alignItems:      'center',
    paddingVertical: 6,
  },
});
