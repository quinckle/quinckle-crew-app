/**
 * ClearFlash — a brief green "swept clean" wash over a table card, used on the
 * batch/multi-select free path (the lightweight, non-blocking counterpart to
 * the FreeTableOverlay used for a single free). Self-animates on mount and calls
 * onDone so the parent can drop it from the freed-ids set.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { QuinckleColors, Radius } from '../../constants/Colors';

const AnimatedIcon = Animated.createAnimatedComponent(Ionicons);

export function ClearFlash({ onDone }: { onDone: () => void }) {
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(t, { toValue: 1, duration: 720, easing: Easing.inOut(Easing.quad), useNativeDriver: true })
      .start(({ finished }) => { if (finished) onDone(); });
  }, [t, onDone]);

  // Wash fades in, holds, fades out; the sweep highlight travels across; a small
  // check pulses at the peak.
  const washOpacity = t.interpolate({ inputRange: [0, 0.25, 0.7, 1], outputRange: [0, 1, 1, 0] });
  const sweepX = t.interpolate({ inputRange: [0, 1], outputRange: [-140, 140] });
  const checkScale = t.interpolate({ inputRange: [0, 0.35, 0.6, 1], outputRange: [0.4, 1.1, 1, 0.9] });
  const checkOpacity = t.interpolate({ inputRange: [0, 0.3, 0.75, 1], outputRange: [0, 1, 1, 0] });

  return (
    <Animated.View style={[styles.wash, { opacity: washOpacity }]} pointerEvents="none">
      <Animated.View style={[styles.sweep, { transform: [{ translateX: sweepX }, { skewX: '-18deg' }] }]} />
      <AnimatedIcon
        name="checkmark-circle"
        size={30}
        color={QuinckleColors.success}
        style={{ opacity: checkOpacity, transform: [{ scale: checkScale }] }}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wash: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: Radius.lg + 1.5,
    backgroundColor: 'rgba(34,197,94,0.16)',
    borderWidth: 1.5,
    borderColor: QuinckleColors.successBorder,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    zIndex: 3,
  },
  sweep: {
    position: 'absolute',
    top: '-20%',
    width: '30%',
    height: '140%',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
});
