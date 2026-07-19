import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';
import { FeatureCarousel } from './FeatureCarousel';

const COLLAPSE_MS = 420;

/**
 * Portrait/phone counterpart to AuthSplit: same feature-carousel hero and
 * same collapse behavior, just stacked vertically instead of side-by-side.
 * The hero pane sits on top and swipes up + shrinks + fades away once
 * `showHero` goes false, letting the form pane grow to fill the screen and
 * re-center — mirrors AuthSplit's horizontal collapse exactly, just on the Y
 * axis, so phone and tablet read as one consistent design.
 *
 * On welcome, the form pane is NOT flex-shared with the hero — it's sized to
 * its own content (greeting + CTA + terms) and pinned to the bottom, so the
 * hero gets every pixel of the screen that isn't needed for that content.
 */
type Props = {
  children: React.ReactNode;
  /** 'bottom' for the welcome step (full-bleed hero, CTA stuck to the bottom). 'top' for phone/OTP so the keyboard never pushes the form around. */
  align?: 'bottom' | 'top';
  /** false to swipe the hero pane away and let the form take the full height. */
  showHero?: boolean;
};

export function AuthStack({ children, align = 'bottom', showHero = true }: Props) {
  const insets = useSafeAreaInsets();
  // Force the exact device width — guards against this column inheriting a
  // shrunk cross-axis size from an ancestor after an orientation change.
  const { width } = useWindowDimensions();
  const heroAnim = useRef(new Animated.Value(showHero ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(heroAnim, {
      toValue: showHero ? 1 : 0,
      duration: COLLAPSE_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false, // flex isn't native-driver-animatable
    }).start();
  }, [showHero, heroAnim]);

  const heroFlex = heroAnim.interpolate({ inputRange: [0, 1], outputRange: [0.0001, 1] });
  const heroOpacity = heroAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const heroTranslate = heroAnim.interpolate({ inputRange: [0, 1], outputRange: [-60, 0] });

  return (
    <View style={[styles.column, { width, paddingTop: insets.top }]}>
      <Animated.View
        style={[
          styles.heroPane,
          {
            flex: heroFlex,
            opacity: heroOpacity,
            transform: [{ translateY: heroTranslate }],
          },
        ]}
        pointerEvents={showHero ? 'auto' : 'none'}
      >
        <FeatureCarousel />
      </Animated.View>

      <View
        style={[
          styles.formPane,
          align === 'top' ? styles.formPaneTop : styles.formPaneBottom,
          { paddingBottom: insets.bottom + Spacing.lg },
        ]}
      >
        <View style={styles.formInner}>{children}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  column: {
    flex: 1,
    backgroundColor: QuinckleColors.background,
  },
  heroPane: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: QuinckleColors.background,
  },
  // Rounded-top "sheet" so the card reads as sitting on top of the hero
  // instead of being an invisible continuation of the same background.
  formPane: {
    backgroundColor: QuinckleColors.surface,
    borderTopLeftRadius: Radius.xxl,
    borderTopRightRadius: Radius.xxl,
    paddingHorizontal: Spacing.xxl,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 24,
  },
  // Phone/OTP: needs to fill whatever room the (near-zero) hero gives up.
  formPaneTop: {
    flexGrow: 1,
    flexShrink: 0,
    justifyContent: 'flex-start',
    paddingTop: Spacing.xxl,
  },
  // Welcome: sized to its own content only — the hero claims everything else.
  formPaneBottom: {
    flexGrow: 0,
    flexShrink: 0,
    justifyContent: 'flex-end',
    paddingTop: Spacing.xxl,
  },
  formInner: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
  },
});
