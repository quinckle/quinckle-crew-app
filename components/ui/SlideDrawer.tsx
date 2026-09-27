/**
 * A left-hand drawer that slides in over whatever screen renders it, with a
 * backdrop that fades and dismisses it.
 *
 * It is an overlay inside the host screen rather than a route on purpose: there
 * is no navigation transition to fight, no second screen to mount, and nothing
 * to reveal when it moves — just a panel and a scrim animating on two values.
 *
 * Children are a render function so the content can close the drawer itself
 * (an X button, or tapping a row that navigates away) and have the panel slide
 * out rather than vanish.
 *
 * Closing is always animated: `close()` slides the panel out and then calls
 * `onClosed`, which is where the host unmounts it.
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet } from 'react-native';
import { QuinckleColors } from '../../constants/Colors';

const OPEN_MS = 280;
const CLOSE_MS = 200;
// A fast start that settles gently — the curve iOS uses for its own drawers.
const OPEN_EASING = Easing.bezier(0.32, 0.72, 0, 1);
const CLOSE_EASING = Easing.bezier(0.4, 0, 1, 1);
const SCRIM_ALPHA = 0.55;

type Props = {
  onClosed: () => void;
  width?: number;
  children: (close: () => void) => React.ReactNode;
};

export function SlideDrawer({ onClosed, width = 380, children }: Props) {
  // 0 = fully off-screen, 1 = fully open.
  const progress = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;

  // The web build cannot use the native driver; it animates in JS, which is
  // ample for one panel and one fade.
  const native = Platform.OS !== 'web';

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: OPEN_MS,
      easing: OPEN_EASING,
      useNativeDriver: native,
    }).start();
  }, [progress, native]);

  const close = useCallback(() => {
    if (closing.current) return; // a double tap must not start a second close
    closing.current = true;
    Animated.timing(progress, {
      toValue: 0,
      duration: CLOSE_MS,
      easing: CLOSE_EASING,
      useNativeDriver: native,
    }).start(() => onClosedRef.current());
  }, [progress, native]);

  // Desktop: Escape closes it, as it would any dialog.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [close]);

  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [-width, 0] });
  const scrim = progress.interpolate({ inputRange: [0, 1], outputRange: [0, SCRIM_ALPHA] });

  return (
    <Animated.View style={StyleSheet.absoluteFill} accessibilityViewIsModal testID="slide-drawer">
      <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, { opacity: scrim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close menu" />
      </Animated.View>

      <Animated.View
        testID="slide-drawer-panel"
        style={[styles.panel, { width, transform: [{ translateX }] }]}
      >
        {children(close)}
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Opacity is animated on the wrapper, so the scrim itself is opaque black.
  scrim: { backgroundColor: '#000' },
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    maxWidth: '100%',
    backgroundColor: QuinckleColors.background,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: QuinckleColors.border,
    overflow: 'hidden',
  },
});
