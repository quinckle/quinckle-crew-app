/**
 * CenteredModal — fade + scale centered modal for tablet-landscape.
 * Same props shape as BottomSheet so screens can swap between the two based
 * on `isWide` without restructuring their content.
 *
 * Usage:
 *   <CenteredModal visible={open} onClose={() => setOpen(false)} title="Filter tables">
 *     {children}
 *   </CenteredModal>
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { QuinckleColors, Radius, Spacing, Typography } from '../../constants/Colors';

const OPEN_MS = 240;
const CLOSE_MS = 180;

export interface CenteredModalProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  /** Max width of the card, in dp. Defaults to 420. */
  maxWidth?: number;
  children: React.ReactNode;
}

export function CenteredModal({
  visible,
  onClose,
  title,
  maxWidth = 420,
  children,
}: CenteredModalProps) {
  const [mounted, setMounted] = useState(false);
  const scale = useRef(new Animated.Value(0.92)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);

  const animateOpen = useCallback(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: OPEN_MS, useNativeDriver: true }),
      Animated.spring(scale, {
        toValue: 1,
        damping: 22,
        mass: 0.8,
        stiffness: 260,
        useNativeDriver: true,
      }),
    ]).start();
  }, [opacity, scale]);

  const animateClose = useCallback((cb?: () => void) => {
    if (closing.current) return;
    closing.current = true;
    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: CLOSE_MS, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 0.92, duration: CLOSE_MS, useNativeDriver: true }),
    ]).start(({ finished }) => {
      if (finished) {
        closing.current = false;
        setMounted(false);
        cb?.();
      }
    });
  }, [opacity, scale]);

  useEffect(() => {
    if (visible) {
      closing.current = false;
      scale.setValue(0.92);
      opacity.setValue(0);
      setMounted(true);
    } else {
      animateClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Content is self-sized (no drag-to-measure like BottomSheet needs), so
  // just kick off the open animation once mounted.
  useEffect(() => {
    if (mounted) animateOpen();
  }, [mounted, animateOpen]);

  if (!mounted) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View
        style={[StyleSheet.absoluteFill, styles.backdrop, { opacity }]}
        pointerEvents="auto"
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={() => animateClose(onClose)} />
      </Animated.View>

      <View style={styles.center} pointerEvents="box-none">
        <Animated.View
          style={[
            styles.card,
            { maxWidth, opacity, transform: [{ scale }] },
          ]}
        >
          {title != null && (
            <View style={styles.titleRow}>
              <Text style={styles.titleText}>{title}</Text>
              <Pressable
                onPress={() => animateClose(onClose)}
                hitSlop={8}
                style={styles.closeBtn}
              >
                <Ionicons name="close" size={18} color={QuinckleColors.textSecondary} />
              </Pressable>
            </View>
          )}

          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {children}
          </ScrollView>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  card: {
    width: '100%',
    maxHeight: '80%',
    backgroundColor: QuinckleColors.surface,
    borderRadius: Radius.xxl,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.lg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.35,
    shadowRadius: 30,
    elevation: 24,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.lg,
  },
  titleText: {
    ...Typography.subtitle,
    color: QuinckleColors.textPrimary,
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: QuinckleColors.surfaceMuted,
  },
});
