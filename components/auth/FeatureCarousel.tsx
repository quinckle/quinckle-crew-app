import React, { useEffect, useRef, useState } from 'react';
import { Animated, Image, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, RadialGradient as SvgRadialGradient, Rect, Stop } from 'react-native-svg';
import { QuinckleColors, Radius, Spacing, Typography } from '../../constants/Colors';

type Slide = {
  title: string;
  subtitle: string;
};

const SLIDES: Slide[] = [
  {
    title: 'Live Table View',
    subtitle: 'See every table’s status the moment it changes: available, occupied, or reserved.',
  },
  {
    title: 'Instant KOT Printing',
    subtitle: 'Orders hit the kitchen printer the second they’re placed. No delays, no manual calls.',
  },
  {
    title: 'Kitchen Ticket Queue',
    subtitle: 'Cooks track every order from fired to ready, with a swipe to bump it done.',
  },
];

const AUTO_ADVANCE_MS = 4200;
const FADE_MS = 420;

/**
 * Background: two soft radial-gradient blobs (react-native-svg) drifting
 * behind the content. Cheap, GPU-friendly, and avoids stretching any bitmap
 * asset across arbitrary tablet aspect ratios.
 */
function GradientMesh() {
  return (
    <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <SvgRadialGradient id="blobTop" cx="80%" cy="8%" r="65%">
          <Stop offset="0%" stopColor={QuinckleColors.primary} stopOpacity={0.32} />
          <Stop offset="100%" stopColor={QuinckleColors.primary} stopOpacity={0} />
        </SvgRadialGradient>
        <SvgRadialGradient id="blobBottom" cx="10%" cy="95%" r="55%">
          <Stop offset="0%" stopColor={QuinckleColors.primaryDark} stopOpacity={0.28} />
          <Stop offset="100%" stopColor={QuinckleColors.primaryDark} stopOpacity={0} />
        </SvgRadialGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={QuinckleColors.background} />
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#blobTop)" />
      <Rect x="0" y="0" width="100%" height="100%" fill="url(#blobBottom)" />
    </Svg>
  );
}

export function FeatureCarousel() {
  const [index, setIndex] = useState(0);
  const fade = useRef(new Animated.Value(1)).current;
  const rise = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const timer = setInterval(() => {
      Animated.timing(fade, {
        toValue: 0,
        duration: FADE_MS,
        useNativeDriver: true,
      }).start(() => {
        setIndex((prev) => (prev + 1) % SLIDES.length);
        rise.setValue(8);
        Animated.parallel([
          Animated.timing(fade, { toValue: 1, duration: FADE_MS, useNativeDriver: true }),
          Animated.timing(rise, { toValue: 0, duration: FADE_MS, useNativeDriver: true }),
        ]).start();
      });
    }, AUTO_ADVANCE_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const slide = SLIDES[index];

  return (
    <View style={styles.container}>
      {/* Background fills the full pane, edge to edge — not inset by the
          foreground's padding. */}
      <GradientMesh />

      <View style={styles.content}>
        <Image
          source={require('../../assets/images/logo/quinckle crew logo dark.webp')}
          style={styles.logo}
          resizeMode="contain"
        />

        <View style={styles.centerArea}>
          <Animated.View
            style={[
              styles.slideContent,
              { opacity: fade, transform: [{ translateY: rise }] },
            ]}
          >
            <Text style={styles.title}>{slide.title}</Text>
            <Text style={styles.subtitle}>{slide.subtitle}</Text>
          </Animated.View>
        </View>

        <View style={styles.dots}>
          {SLIDES.map((_, i) => (
            <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: QuinckleColors.background,
  },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.huge,
    paddingVertical: Spacing.huge,
  },
  // Absolutely positioned so growing/shrinking the logo never shifts the
  // centered slide text out of alignment with the form pane's center.
  logo: {
    position: 'absolute',
    top: Spacing.huge,
    left: Spacing.huge,
    width: 121,
    height: 68,
  },
  centerArea: {
    flex: 1,
    justifyContent: 'center',
  },
  slideContent: {
    maxWidth: 380,
  },
  title: {
    ...Typography.display,
    fontSize: 30,
    color: QuinckleColors.textPrimary,
    marginBottom: Spacing.sm,
  },
  subtitle: {
    ...Typography.body,
    fontSize: 16,
    lineHeight: 24,
    color: QuinckleColors.textSecondary,
  },
  dots: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: Radius.pill,
    backgroundColor: QuinckleColors.borderStrong,
  },
  dotActive: {
    width: 24,
    backgroundColor: QuinckleColors.primary,
  },
});
