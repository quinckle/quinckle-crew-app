import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { QuinckleColors, Spacing } from '../../constants/Colors';

const SHIMMER_DURATION_MS = 1500;
const SWEEP_DISTANCE = 320;
const ACTIVE_CARD_COUNT = 3;
const CONFIRMED_ROW_COUNT = 4;

export const ShimmerBlock: React.FC<{
  width: number | `${number}%`;
  height: number;
  style?: any;
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

const ActiveCardSkeleton: React.FC<{ translateX: Animated.AnimatedInterpolation<number> }> = ({ translateX }) => (
  <View style={styles.activeCard}>
    <View style={styles.activeTop}>
      <View style={styles.titleCluster}>
        <ShimmerBlock translateX={translateX} width={78} height={28} radius={8} />
        <ShimmerBlock translateX={translateX} width={90} height={18} radius={999} style={{ marginTop: 8 }} />
      </View>
      <ShimmerBlock translateX={translateX} width={52} height={12} radius={4} />
    </View>

    <View style={styles.activeBody}>
      <ShimmerBlock translateX={translateX} width={90} height={11} radius={4} />
      <ShimmerBlock translateX={translateX} width="62%" height={34} radius={8} style={{ marginTop: 6 }} />
      <ShimmerBlock translateX={translateX} width="48%" height={13} radius={4} style={{ marginTop: 12 }} />
      <ShimmerBlock translateX={translateX} width="38%" height={13} radius={4} style={{ marginTop: 8 }} />
    </View>

    <ShimmerBlock translateX={translateX} width="100%" height={44} radius={14} />
  </View>
);

const ConfirmedRowSkeleton: React.FC<{ translateX: Animated.AnimatedInterpolation<number> }> = ({ translateX }) => (
  <View style={styles.confirmedRow}>
    <View style={styles.confirmedLeft}>
      <View style={styles.confirmedTopLine}>
        <ShimmerBlock translateX={translateX} width={78} height={14} radius={4} />
        <ShimmerBlock translateX={translateX} width={84} height={18} radius={999} />
      </View>
      <ShimmerBlock translateX={translateX} width="54%" height={11} radius={4} style={{ marginTop: 9 }} />
      <ShimmerBlock translateX={translateX} width="42%" height={11} radius={4} style={{ marginTop: 6 }} />
    </View>
    <View style={styles.confirmedRight}>
      <ShimmerBlock translateX={translateX} width={48} height={11} radius={4} />
      <ShimmerBlock translateX={translateX} width={72} height={18} radius={4} style={{ marginTop: 8 }} />
    </View>
  </View>
);

const SectionSkeleton: React.FC<{
  titleWidth: number;
  subtitleWidth: number;
  translateX: Animated.AnimatedInterpolation<number>;
  active?: boolean;
}> = ({ titleWidth, subtitleWidth, translateX, active }) => (
  <View style={styles.section}>
    <View style={[styles.sectionHeader, active && styles.sectionHeaderActive]}>
      <ShimmerBlock translateX={translateX} width={titleWidth} height={14} radius={4} />
      <ShimmerBlock translateX={translateX} width={subtitleWidth} height={12} radius={4} />
    </View>
    <View style={styles.sectionBody}>
      {active
        ? Array.from({ length: ACTIVE_CARD_COUNT }).map((_, idx) => (
            <ActiveCardSkeleton key={idx} translateX={translateX} />
          ))
        : Array.from({ length: CONFIRMED_ROW_COUNT }).map((_, idx) => (
            <ConfirmedRowSkeleton key={idx} translateX={translateX} />
          ))}
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
      <SectionSkeleton
        active
        translateX={translateX}
        titleWidth={138}
        subtitleWidth={110}
      />
      <SectionSkeleton
        translateX={translateX}
        titleWidth={124}
        subtitleWidth={96}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingBottom: 100,
  },
  section: {
    paddingTop: Spacing.sm,
    marginBottom: Spacing.md,
  },
  sectionHeader: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  sectionHeaderActive: {
    marginTop: Spacing.xs,
  },
  sectionBody: {
    gap: Spacing.sm,
  },
  activeCard: {
    marginHorizontal: Spacing.lg,
    backgroundColor: QuinckleColors.surface,
    borderRadius: 22,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    overflow: 'hidden',
  },
  activeTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  titleCluster: {
    flex: 1,
    paddingRight: 12,
  },
  activeBody: {
    marginBottom: 14,
  },
  confirmedRow: {
    marginHorizontal: Spacing.lg,
    paddingVertical: 12,
    paddingHorizontal: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: QuinckleColors.border,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
  },
  confirmedLeft: {
    flex: 1,
    paddingRight: 8,
  },
  confirmedRight: {
    alignItems: 'flex-end',
    minWidth: 74,
  },
  confirmedTopLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  shimmerBase: {
    backgroundColor: 'rgba(255,255,255,0.045)',
    overflow: 'hidden',
  },
});

export default CashCollectionSkeleton;
