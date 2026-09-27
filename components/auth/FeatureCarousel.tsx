import React, { useEffect, useRef, useState } from 'react';
import { Animated, Image, StyleSheet, Text, View } from 'react-native';
import { QuinckleColors, Radius, Spacing, Typography } from '../../constants/Colors';
import { isDesktop } from '../../services/platform';
import { HeroBackground } from './HeroBackground';

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

// Desktop shows one fixed message instead of the rotating slides.
const DESKTOP_CAPTION = {
  headline: ['The crew is the heart of every venue.', 'You turn a meal into a memory, one table at a time.'],
  tagline: 'Quinckle Crew. Built for the people who make service happen.',
};

const AUTO_ADVANCE_MS = 4200;
const FADE_MS = 420;

export function FeatureCarousel() {
  // Desktop shows the hero as an inset rounded card with one static caption —
  // no logo, no rotating copy, no dots. Phone and tablet keep the carousel.
  const showSlides = !isDesktop();
  const [index, setIndex] = useState(0);
  const fade = useRef(new Animated.Value(1)).current;
  const rise = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!showSlides) return;
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
    <View style={[styles.container, !showSlides && styles.containerDesktopCard]}>
      {/* Background fills the full pane, edge to edge — not inset by the
          foreground's padding. Gradient blobs on phone, a photographic hero
          with a scrim on desktop — see HeroBackground.web.tsx. */}
      <HeroBackground />

      <View style={styles.content}>
        {showSlides && (
          <Image
            source={require('../../assets/images/logo/quinckle crew logo dark.webp')}
            style={styles.logo}
            resizeMode="contain"
          />
        )}

        {!showSlides && (
          <View style={styles.caption}>
            {DESKTOP_CAPTION.headline.map((line) => (
              <Text key={line} style={styles.captionHeadline}>
                {line}
              </Text>
            ))}
            <Text style={styles.captionTagline}>{DESKTOP_CAPTION.tagline}</Text>
          </View>
        )}

        {showSlides && (
          <>
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
          </>
        )}
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
  // Desktop: the photo is a rounded card floating in the dark window, not a
  // full-bleed pane. overflow:'hidden' on container clips the image to it.
  containerDesktopCard: {
    margin: Spacing.md,
    borderRadius: Radius.xxl,
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
  caption: {
    position: 'absolute',
    left: Spacing.huge,
    right: Spacing.huge,
    bottom: Spacing.huge,
    alignItems: 'center',
  },
  captionHeadline: {
    fontSize: 24,
    lineHeight: 32,
    fontWeight: '400',
    letterSpacing: -0.4,
    textAlign: 'center',
    color: QuinckleColors.textPrimary,
  },
  captionTagline: {
    ...Typography.caption,
    marginTop: Spacing.lg,
    textAlign: 'center',
    color: QuinckleColors.textSecondary,
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
