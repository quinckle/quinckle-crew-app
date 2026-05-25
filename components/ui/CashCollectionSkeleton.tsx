import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';
import { ShimmerBlock } from './TableSkeleton';

const SHIMMER_DURATION_MS = 1500;
const CARD_COUNT = 3; // Show 3 fake pending requests
const SWEEP_DISTANCE = 350; // Sweeping across the full screen width

const PendingCardSkeleton: React.FC<{ translateX: Animated.AnimatedInterpolation<number> }> = ({ translateX }) => (
  <View style={styles.pendingCard}>
    <View style={styles.cardTopRow}>
      {/* Table Pill */}
      <ShimmerBlock translateX={translateX} width={70} height={20} radius={Radius.pill} />
      {/* Time Ago */}
      <ShimmerBlock translateX={translateX} width={50} height={12} radius={4} />
    </View>

    {/* Customer Name */}
    <ShimmerBlock translateX={translateX} width={120} height={18} radius={4} style={{ marginBottom: 4 }} />
    {/* Customer Phone */}
    <ShimmerBlock translateX={translateX} width={100} height={14} radius={4} style={{ marginBottom: Spacing.md }} />

    <View style={styles.cardBottomRow}>
      {/* Amount */}
      <ShimmerBlock translateX={translateX} width={80} height={24} radius={4} />
      {/* Collect Button */}
      <ShimmerBlock translateX={translateX} width={140} height={40} radius={Radius.pill} />
    </View>
  </View>
);

export const CashCollectionSkeleton: React.FC = () => {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: SHIMMER_DURATION_MS,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [progress]);

  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [-SWEEP_DISTANCE, SWEEP_DISTANCE],
  });

  return (
    <View style={styles.container}>
      {/* Section Header Skeleton */}
      <View style={styles.sectionHeader}>
        <ShimmerBlock translateX={translateX} width={60} height={14} radius={4} />
        <ShimmerBlock translateX={translateX} width={100} height={12} radius={4} />
      </View>

      {/* Pending Cards */}
      {Array.from({ length: CARD_COUNT }).map((_, idx) => (
        <PendingCardSkeleton key={idx} translateX={translateX} />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingBottom: 100,
  },
  sectionHeader: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  pendingCard: {
    backgroundColor: QuinckleColors.surface,
    marginHorizontal: Spacing.md,
    marginVertical: Spacing.xs,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: QuinckleColors.primarySoftBorder,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  cardBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
});
