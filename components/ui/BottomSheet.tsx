/**
 * BottomSheet — spring-animated, drag-to-dismiss bottom sheet.
 * Mirrors the partner app's BottomSheet.tsx exactly.
 *
 * Usage:
 *   <BottomSheet visible={open} onClose={() => setOpen(false)} title="Swap table">
 *     {children}
 *   </BottomSheet>
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  KeyboardAvoidingView,
  LayoutChangeEvent,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { QuinckleColors, Radius, Spacing, Typography } from '../../constants/Colors';

const { height: SCREEN_H } = Dimensions.get('window');
const DISMISS_DISTANCE = 80;
const DISMISS_VELOCITY = 0.5;

export interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  /** Max height as a fraction of screen height (0–1). Defaults to 0.92. */
  maxHeightRatio?: number;
  /**
   * When true the sheet gets a fixed height (maxHeightRatio × screen) and
   * children are wrapped in a plain flex:1 View instead of a ScrollView.
   * Use when the child contains its own FlatList/ScrollView.
   */
  disableInternalScroll?: boolean;
  children: React.ReactNode;
}

export function BottomSheet({
  visible,
  onClose,
  title,
  maxHeightRatio = 0.92,
  disableInternalScroll = false,
  children,
}: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(false);

  const translateY = useRef(new Animated.Value(SCREEN_H)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const sheetHeight = useRef(SCREEN_H);
  const closing = useRef(false);
  const layoutFired = useRef(false);

  // Stable refs so PanResponder (created once) always sees the latest version
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  // ── Animations ──────────────────────────────────────────────────────────────

  const animateOpen = useCallback(() => {
    Animated.parallel([
      Animated.timing(backdropOpacity, { toValue: 1, duration: 260, useNativeDriver: true }),
      Animated.spring(translateY, {
        toValue: 0,
        damping: 26,
        mass: 0.85,
        stiffness: 280,
        useNativeDriver: true,
      }),
    ]).start();
  }, [backdropOpacity, translateY]);

  const animateCloseRef = useRef<(cb?: () => void) => void>(() => {});

  const animateClose = useCallback((cb?: () => void) => {
    if (closing.current) return;
    closing.current = true;
    Animated.parallel([
      Animated.timing(backdropOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.spring(translateY, {
        toValue: sheetHeight.current,
        damping: 28,
        mass: 0.9,
        stiffness: 320,
        overshootClamping: true,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) {
        closing.current = false;
        setMounted(false);
        cb?.();
      }
    });
  }, [backdropOpacity, translateY]);

  // Keep ref in sync so PanResponder can call it
  useEffect(() => { animateCloseRef.current = animateClose; }, [animateClose]);

  // ── Visible prop ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (visible) {
      closing.current = false;
      layoutFired.current = false;
      translateY.setValue(SCREEN_H);
      backdropOpacity.setValue(0);
      setMounted(true);
    } else {
      animateClose();
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── First layout → open ──────────────────────────────────────────────────────

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    sheetHeight.current = h;
    if (!layoutFired.current) {
      layoutFired.current = true;
      translateY.setValue(h);
      animateOpen();
    }
  }, [animateOpen, translateY]);

  // ── Drag-to-dismiss (created once via useMemo) ───────────────────────────────

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gs) =>
          gs.dy > 8 && Math.abs(gs.dy) > Math.abs(gs.dx),
        onPanResponderGrant: () => {
          translateY.stopAnimation();
        },
        onPanResponderMove: (_, gs) => {
          const clamped = Math.max(0, gs.dy);
          translateY.setValue(clamped);
          backdropOpacity.setValue(
            Math.max(0, 1 - (clamped / (sheetHeight.current || SCREEN_H)) * 1.3),
          );
        },
        onPanResponderRelease: (_, gs) => {
          if (gs.dy > DISMISS_DISTANCE || gs.vy > DISMISS_VELOCITY) {
            animateCloseRef.current(onCloseRef.current);
          } else {
            Animated.parallel([
              Animated.timing(backdropOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
              Animated.spring(translateY, {
                toValue: 0,
                damping: 26,
                mass: 0.85,
                stiffness: 280,
                useNativeDriver: true,
              }),
            ]).start();
          }
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // ── Render ───────────────────────────────────────────────────────────────────

  if (!mounted) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {/* Backdrop */}
      <Animated.View
        style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: backdropOpacity }]}
        pointerEvents="auto"
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={() => animateClose(onClose)} />
      </Animated.View>

      {/* Sheet */}
      <KeyboardAvoidingView
        behavior="padding"
        keyboardVerticalOffset={Platform.OS === 'android' ? 0 : 0}
        style={styles.kav}
        pointerEvents="box-none"
      >
        <Animated.View
          style={[
            styles.sheet,
            {
              maxHeight: SCREEN_H * maxHeightRatio,
              // Fixed height when child owns scrolling (FlatList inside)
              ...(disableInternalScroll && { height: SCREEN_H * maxHeightRatio }),
              // Float clear of the screen edges (safe-area aware).
              marginBottom: insets.bottom + Spacing.sm,
              paddingBottom: Spacing.lg,
              transform: [{ translateY }],
            },
          ]}
          onLayout={onLayout}
          {...pan.panHandlers}
        >
          <View style={styles.handle} />

          {title != null && (
            <View style={styles.titleRow}>
              <Text style={styles.titleText}>{title}</Text>
            </View>
          )}

          {disableInternalScroll ? (
            <View style={{ flex: 1 }}>{children}</View>
          ) : (
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              bounces={false}
            >
              {children}
            </ScrollView>
          )}
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  kav: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: QuinckleColors.surface,
    borderTopLeftRadius: Radius.xxl,
    borderTopRightRadius: Radius.xxl,
    paddingTop: Spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 24,
  },
  handle: {
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: QuinckleColors.borderStrong,
    alignSelf: 'center',
    marginBottom: Spacing.sm,
  },
  titleRow: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xs,
    paddingBottom: Spacing.lg,
  },
  titleText: {
    ...Typography.subtitle,
    color: QuinckleColors.textPrimary,
  },
});
