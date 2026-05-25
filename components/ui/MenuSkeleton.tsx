import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';
import { ShimmerBlock } from './TableSkeleton';

const SHIMMER_DURATION_MS = 1500;
const SWEEP_DISTANCE = 350;

export const MenuSkeleton: React.FC = () => {
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
      {/* Top 2 Tiles */}
      <View style={styles.tileRow}>
        <View style={styles.tile}>
          <ShimmerBlock translateX={translateX} width={64} height={64} radius={Radius.md} />
          <View style={{ alignItems: 'center', marginTop: 12 }}>
            <ShimmerBlock translateX={translateX} width={70} height={14} radius={4} style={{ marginBottom: 6 }} />
            <ShimmerBlock translateX={translateX} width={50} height={10} radius={4} />
          </View>
        </View>
        <View style={styles.tile}>
          <ShimmerBlock translateX={translateX} width={64} height={64} radius={Radius.md} />
          <View style={{ alignItems: 'center', marginTop: 12 }}>
            <ShimmerBlock translateX={translateX} width={70} height={14} radius={4} style={{ marginBottom: 6 }} />
            <ShimmerBlock translateX={translateX} width={50} height={10} radius={4} />
          </View>
        </View>
      </View>

      {/* Search Input */}
      <ShimmerBlock translateX={translateX} width="100%" height={44} radius={Radius.lg} style={{ marginBottom: 12 }} />

      {/* Category Chips */}
      <View style={styles.chipRow}>
        <ShimmerBlock translateX={translateX} width={60} height={34} radius={Radius.pill} />
        <ShimmerBlock translateX={translateX} width={80} height={34} radius={Radius.pill} />
        <ShimmerBlock translateX={translateX} width={70} height={34} radius={Radius.pill} />
        <ShimmerBlock translateX={translateX} width={90} height={34} radius={Radius.pill} />
      </View>

      {/* Menu Items List */}
      {Array.from({ length: 4 }).map((_, idx) => (
        <View key={idx} style={styles.menuItemRow}>
          <View style={styles.menuItemLeft}>
            <ShimmerBlock translateX={translateX} width={58} height={58} radius={Radius.sm} />
            <View style={styles.menuItemInfo}>
              <ShimmerBlock translateX={translateX} width={120} height={16} radius={4} />
              <ShimmerBlock translateX={translateX} width={180} height={12} radius={4} />
              <ShimmerBlock translateX={translateX} width={60} height={14} radius={4} style={{ marginTop: 4 }} />
            </View>
          </View>
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: 100,
  },
  tileRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
    marginTop: 4,
  },
  tile: {
    flex: 1,
    backgroundColor: 'rgba(20,20,22,0.6)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  menuItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: QuinckleColors.borderSubtle,
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: Spacing.md,
  },
  menuItemInfo: {
    flex: 1,
    gap: 2,
  },
});
