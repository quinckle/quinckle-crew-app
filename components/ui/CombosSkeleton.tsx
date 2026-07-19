import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { Radius, Spacing } from '../../constants/Colors';
import { ShimmerBlock } from './TableSkeleton';

const SHIMMER_DURATION_MS = 1500;
const SWEEP_DISTANCE = 350;

export const CombosSkeleton: React.FC = () => {
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
      {Array.from({ length: 2 }).map((_, idx) => (
        <View key={idx} style={styles.comboCard}>
          <ShimmerBlock translateX={translateX} width="100%" height={180} radius={Radius.md} style={{ marginBottom: 12 }} />
          <View style={styles.body}>
            <ShimmerBlock translateX={translateX} width="60%" height={18} radius={4} style={{ marginBottom: 8 }} />
            <ShimmerBlock translateX={translateX} width="85%" height={12} radius={4} style={{ marginBottom: 12 }} />
            <ShimmerBlock translateX={translateX} width="25%" height={20} radius={4} style={{ marginBottom: 16 }} />
            
            {/* Included list items */}
            <View style={styles.includesBlock}>
              <ShimmerBlock translateX={translateX} width={60} height={12} radius={4} style={{ marginBottom: 10 }} />
              <View style={styles.entryRow}>
                <View style={styles.dot} />
                <ShimmerBlock translateX={translateX} width="40%" height={12} radius={4} />
              </View>
              <View style={styles.entryRow}>
                <View style={styles.dot} />
                <ShimmerBlock translateX={translateX} width="50%" height={12} radius={4} />
              </View>
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
    gap: 16,
    paddingTop: 16,
  },
  comboCard: {
    backgroundColor: '#141416',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    overflow: 'hidden',
    paddingBottom: 16,
  },
  body: {
    paddingHorizontal: 16,
  },
  includesBlock: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
    paddingTop: 12,
  },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginVertical: 4,
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
});
