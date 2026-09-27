/**
 * Auth hero background — native (Android / iOS).
 *
 * Two soft radial-gradient blobs (react-native-svg) behind the feature
 * carousel. Cheap, GPU-friendly, and avoids stretching a bitmap across
 * arbitrary phone and tablet aspect ratios.
 *
 * The desktop build swaps in HeroBackground.web.tsx, which uses a photographic
 * hero instead. Keeping that in a platform file rather than an `isDesktop()`
 * branch matters here: the desktop image is only `require`d in the web variant,
 * so it is never bundled into the phone app or an OTA payload.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import Svg, { Defs, RadialGradient as SvgRadialGradient, Rect, Stop } from 'react-native-svg';
import { QuinckleColors } from '../../constants/Colors';

export function HeroBackground() {
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
