import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';
import { ShimmerBlock } from './TableSkeleton';

const SHIMMER_DURATION_MS = 1500;
const CARD_COUNT = 4;
const SWEEP_DISTANCE = 320;

/** One placeholder takeaway card — mirrors the real card's top row (token +
 *  customer on the left, status/total on the right), a divider, and two item
 *  lines, so the swap to real data doesn't shift the layout. */
const SkeletonCard: React.FC<{ translateX: Animated.AnimatedInterpolation<number> }> = ({ translateX }) => (
  <View style={styles.card}>
    <View style={styles.cardTop}>
      <View style={styles.cardLeft}>
        <ShimmerBlock translateX={translateX} width={110} height={20} radius={6} />
        <ShimmerBlock translateX={translateX} width={140} height={12} radius={4} style={{ marginTop: 10 }} />
      </View>
      <View style={styles.cardRight}>
        <ShimmerBlock translateX={translateX} width={64} height={14} radius={4} />
        <ShimmerBlock translateX={translateX} width={30} height={30} radius={Radius.md} style={{ marginTop: 10 }} />
      </View>
    </View>
    <View style={styles.divider} />
    <ShimmerBlock translateX={translateX} width="70%" height={12} radius={4} />
    <ShimmerBlock translateX={translateX} width="50%" height={12} radius={4} style={{ marginTop: 8 }} />
  </View>
);

export const TakeawaySkeleton: React.FC = () => {
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
    <View style={styles.list}>
      {Array.from({ length: CARD_COUNT }).map((_, i) => (
        <SkeletonCard key={i} translateX={translateX} />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  list: {
    paddingBottom: 100,
    gap: Spacing.md,
  },
  card: {
    backgroundColor: QuinckleColors.surface,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    overflow: 'hidden',
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  cardLeft: {
    flex: 1,
  },
  cardRight: {
    alignItems: 'flex-end',
  },
  divider: {
    height: 1,
    backgroundColor: QuinckleColors.border,
    marginVertical: Spacing.md,
  },
});

export default TakeawaySkeleton;
