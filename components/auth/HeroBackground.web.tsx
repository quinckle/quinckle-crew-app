/**
 * Auth hero background — desktop (Electron) and web.
 *
 * Desktop gets a photographic hero filling the left pane; a plain browser tab
 * keeps the gradient, since at phone width a cropped photo reads worse than the
 * blobs do.
 *
 * ── Replacing the image ──────────────────────────────────────────────────────
 * Drop your file at  assets/images/auth/desktop hero.webp  — the path below is
 * the only reference, so nothing else needs editing. What ships there today is
 * a PLACEHOLDER (brand arcs on the app background), not artwork.
 *
 * Shoot/crop for roughly 3:4 to 1:1 — the pane is about 740×780 at a 1440-wide
 * window — and keep the BOTTOM THIRD calm: the centred caption sits there over
 * the scrim. The pane shows no logo on desktop, so the photo can carry a
 * wordmark if the artwork wants one.
 */

import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Defs, RadialGradient as SvgRadialGradient, Rect, Stop } from 'react-native-svg';
import { QuinckleColors } from '../../constants/Colors';
import { isDesktop } from '../../services/platform';

const DESKTOP_HERO = require('../../assets/images/auth/desktop hero.webp');

/** The phone/browser treatment — kept identical to the native file. */
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

export function HeroBackground() {
  if (!isDesktop()) return <GradientMesh />;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* "cover": the photo fills its rounded card edge to edge, so there are
          no bars inside the rounded corners at any window size.
          NOTE: the explicit 100%/100% is load-bearing. Under react-native-web
          an Image with only StyleSheet.absoluteFill takes its INTRINSIC size
          (here 1108x1419) and simply overflows the pane, which clips it — so
          resizeMode has nothing to fit against and "contain" and "cover" look
          identical. Sizing the element to the pane is what makes it work. */}
      <Image source={DESKTOP_HERO} style={styles.heroImage} resizeMode="cover" />

      {/* Bottom-up scrim, so the centred caption keeps its contrast over a
          light or busy lower edge. The photo is otherwise untouched. */}
      <LinearGradient
        colors={['transparent', SCRIM_SOFT, SCRIM_STRONG]}
        locations={[0.45, 0.75, 1]}
        style={StyleSheet.absoluteFill}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  heroImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
  },
});

// Derived from the app background so the scrim dissolves into the pane's own
// colour rather than introducing a second black.
const SCRIM_STRONG = 'rgba(10, 10, 11, 0.92)';
const SCRIM_SOFT = 'rgba(10, 10, 11, 0.45)';
