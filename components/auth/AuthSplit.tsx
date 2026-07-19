import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { QuinckleColors, Spacing } from '../../constants/Colors';
import { FeatureCarousel } from './FeatureCarousel';

const HERO_FLEX = 1.15;
const COLLAPSE_MS = 420;

/**
 * Tablet-landscape auth shell: an animated feature carousel fills the left
 * pane, the form / CTA lives in a centered panel on the right. Phones never
 * use this — the auth screen keeps its existing full-bleed hero layout and
 * only swaps to AuthSplit when `isWide` (tablet + landscape). login.tsx swaps
 * its inner content between welcome/phone/otp steps without navigating, so
 * this pane never remounts mid-flow.
 *
 * When `showHero` goes false (phone/OTP entry), the hero pane doesn't just
 * disappear — it slides out and shrinks away, and the form pane naturally
 * expands to fill the freed width and re-centers itself.
 */
type Props = {
  children: React.ReactNode;
  /**
   * 'center' for the welcome step (no keyboard). 'top' for phone/OTP entry,
   * so the form stays put near the top instead of jumping around as the
   * keyboard opens and reflows a centered layout.
   */
  align?: 'center' | 'top';
  /** false to swipe the hero pane away and let the form take the full width. */
  showHero?: boolean;
};

export function AuthSplit({ children, align = 'center', showHero = true }: Props) {
  const heroAnim = useRef(new Animated.Value(showHero ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(heroAnim, {
      toValue: showHero ? 1 : 0,
      duration: COLLAPSE_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false, // flex isn't native-driver-animatable
    }).start();
  }, [showHero, heroAnim]);

  const heroFlex = heroAnim.interpolate({ inputRange: [0, 1], outputRange: [0.0001, HERO_FLEX] });
  const heroOpacity = heroAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });
  const heroTranslate = heroAnim.interpolate({ inputRange: [0, 1], outputRange: [-80, 0] });

  return (
    <View style={styles.row}>
      <Animated.View
        style={[
          styles.heroPane,
          {
            flex: heroFlex,
            opacity: heroOpacity,
            transform: [{ translateX: heroTranslate }],
          },
        ]}
        pointerEvents={showHero ? 'auto' : 'none'}
      >
        <FeatureCarousel />
      </Animated.View>

      {/* Right: form panel — centered for welcome, top-anchored for phone/OTP.
          Expands to the full row once the hero pane collapses. */}
      <View style={[styles.formPane, align === 'top' && styles.formPaneTop]}>
        <View style={styles.formInner}>{children}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: QuinckleColors.background,
  },
  heroPane: {
    flex: HERO_FLEX,
    overflow: 'hidden',
    backgroundColor: QuinckleColors.background,
  },
  formPane: {
    flex: 1,
    backgroundColor: QuinckleColors.background,
    justifyContent: 'center',
    paddingHorizontal: Spacing.xxl,
  },
  formPaneTop: {
    justifyContent: 'flex-start',
    paddingTop: Spacing.huge,
  },
  formInner: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
  },
});
