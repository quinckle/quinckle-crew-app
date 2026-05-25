import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';

const SHIMMER_DURATION_MS = 1500;
const CARD_COUNT = 6;
const SWEEP_DISTANCE = 220;

/**
 * Shimmering placeholder block. The base is a muted translucent surface; an
 * absolutely-positioned linear gradient sweeps across via the native driver,
 * so the animation stays at 60fps even while React is hydrating real data.
 */
export const ShimmerBlock: React.FC<{
  width: number | `${number}%`;
  height: number;
  style?: ViewStyle;
  radius?: number;
  translateX: Animated.AnimatedInterpolation<number>;
}> = ({ width, height, style, radius = 6, translateX }) => (
  <View
    style={[
      styles.shimmerBase,
      { width, height, borderRadius: radius },
      style,
    ]}
  >
    <Animated.View
      style={[StyleSheet.absoluteFillObject, { transform: [{ translateX }] }]}
    >
      <LinearGradient
        colors={[
          'rgba(255,255,255,0)',
          'rgba(255,255,255,0.05)',
          'rgba(255,255,255,0.11)',
          'rgba(255,255,255,0.05)',
          'rgba(255,255,255,0)',
        ]}
        locations={[0, 0.35, 0.5, 0.65, 1]}
        start={{ x: 0, y: 0.5 }}
        end={{ x: 1, y: 0.5 }}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  </View>
);

const SkeletonCard: React.FC<{ translateX: Animated.AnimatedInterpolation<number> }> = ({ translateX }) => (
  <View style={styles.card}>
    <View style={styles.cardHeader}>
      <View>
        <ShimmerBlock translateX={translateX} width={56} height={22} radius={6} />
        <ShimmerBlock
          translateX={translateX}
          width={48}
          height={10}
          radius={4}
          style={{ marginTop: 8 }}
        />
      </View>
      <ShimmerBlock translateX={translateX} width={72} height={20} radius={Radius.pill} />
    </View>

    <View style={styles.cardBottom}>
      <ShimmerBlock translateX={translateX} width={80} height={18} radius={6} />
      <ShimmerBlock
        translateX={translateX}
        width={60}
        height={10}
        radius={4}
        style={{ marginTop: 6 }}
      />
    </View>
  </View>
);

export const TableSkeleton: React.FC = () => {
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

  // Build (CARD_COUNT / 2) rows of 2 cards each — mirrors FlatList numColumns=2
  // with columnWrapperStyle so the layout matches pixel-for-pixel.
  const rowCount = Math.ceil(CARD_COUNT / 2);

  return (
    <View style={styles.grid}>
      {Array.from({ length: rowCount }).map((_, rowIdx) => (
        <View key={rowIdx} style={styles.row}>
          <SkeletonCard translateX={translateX} />
          <SkeletonCard translateX={translateX} />
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  grid: {
    paddingBottom: 100,
    gap: Spacing.md,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  card: {
    flex: 1,
    maxWidth: '49%',
    minHeight: 130,
    backgroundColor: QuinckleColors.surface,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  cardBottom: {
    marginTop: Spacing.md,
  },
  shimmerBase: {
    backgroundColor: 'rgba(255,255,255,0.045)',
    overflow: 'hidden',
  },
});

export default TableSkeleton;
