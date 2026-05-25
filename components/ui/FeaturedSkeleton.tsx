import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';
import { ShimmerBlock } from './TableSkeleton';

const SHIMMER_DURATION_MS = 1500;
const SWEEP_DISTANCE = 350;

export const FeaturedSkeleton: React.FC = () => {
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
      <View style={styles.sectionCard}>
        {/* Eyebrow */}
        <View style={styles.eyebrowRow}>
          <View style={styles.starPlaceholder} />
          <ShimmerBlock translateX={translateX} width={120} height={10} radius={3} />
        </View>

        {/* Section title & desc */}
        <ShimmerBlock translateX={translateX} width="55%" height={18} radius={4} style={{ marginBottom: 8 }} />
        <ShimmerBlock translateX={translateX} width="80%" height={12} radius={4} style={{ marginBottom: 16 }} />

        <View style={styles.divider} />

        {/* Items label */}
        <ShimmerBlock translateX={translateX} width={100} height={12} radius={4} style={{ marginBottom: 16 }} />

        {/* Item Rows */}
        {Array.from({ length: 4 }).map((_, idx) => (
          <View key={idx} style={styles.itemRow}>
            <ShimmerBlock translateX={translateX} width={44} height={44} radius={Radius.sm} />
            <View style={styles.itemInfo}>
              <ShimmerBlock translateX={translateX} width="50%" height={14} radius={4} style={{ marginBottom: 6 }} />
              <ShimmerBlock translateX={translateX} width="20%" height={12} radius={4} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: Spacing.md,
    paddingTop: 16,
  },
  sectionCard: {
    backgroundColor: '#141416',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    padding: 16,
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 10,
  },
  starPlaceholder: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginVertical: 14,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginVertical: 8,
  },
  itemInfo: {
    flex: 1,
  },
});
