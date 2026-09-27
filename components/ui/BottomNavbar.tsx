import React from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { QuinckleColors, Radius, Spacing, Typography } from '../../constants/Colors';

// Default staff tabs — kept as the back-compat shape so existing callers
// don't break. The component now also accepts a generic `tabs` array.
type StaffTabKey = 'tables' | 'menu' | 'orders' | 'activity';

export interface BottomNavTab<K extends string = string> {
  key:        K;
  label:      string;
  icon:       keyof typeof Ionicons.glyphMap;
  iconActive: keyof typeof Ionicons.glyphMap;
}

interface BottomNavbarProps<K extends string = StaffTabKey> {
  activeTab:    K;
  onTabChange:  (tab: K) => void;
  /** Optional custom tabs. Defaults to the staff tab set. */
  tabs?:        BottomNavTab<K>[];
  /** Float as an inset, rounded bar instead of a full-bleed edge-to-edge one. */
  floating?:    boolean;
  /**
   * Desktop split layouts only (see index.tsx): overrides the bar's own
   * left/width with animated values in pixels, instead of it sizing itself
   * off its parent's instant flex width. The Tables tab confines this bar to
   * the grid's 60% column (`floating`); every other tab spans the full
   * window — switching between them used to snap the width in one frame,
   * a jarring jump on a wide desktop window. The caller tweens these two
   * Animated.Values instead; omit for every other layout (phone, tablet, the
   * cook app) and the bar sizes itself as before.
   */
  animatedBox?: {
    left: Animated.Value | Animated.AnimatedInterpolation<string | number>;
    width: Animated.Value | Animated.AnimatedInterpolation<string | number>;
  };
}

const DEFAULT_STAFF_TABS: BottomNavTab<StaffTabKey>[] = [
  { key: 'orders', label: 'Orders', icon: 'receipt-outline',    iconActive: 'receipt' },
  { key: 'tables', label: 'Tables', icon: 'grid-outline',       iconActive: 'grid' },
  { key: 'menu',   label: 'Menu',   icon: 'restaurant-outline', iconActive: 'restaurant' },
];

export function BottomNavbar<K extends string = StaffTabKey>({
  activeTab,
  onTabChange,
  tabs,
  floating,
  animatedBox,
}: BottomNavbarProps<K>) {
  const insets = useSafeAreaInsets();
  const items = (tabs ?? (DEFAULT_STAFF_TABS as unknown as BottomNavTab<K>[]));

  return (
    <Animated.View
      style={[
        styles.container,
        floating ? styles.floatingLook : { paddingBottom: Math.max(insets.bottom, Spacing.sm) },
        animatedBox
          // Caller owns position/size — the bottom offset still follows
          // `floating` (a floating pill sits clear of the edge; a full-bleed
          // bar sits flush, padded for the safe area instead).
          ? {
              left: animatedBox.left,
              right: undefined,
              width: animatedBox.width,
              bottom: floating ? Spacing.md : 0,
            }
          : floating ? styles.floatingPosition : { left: 0, right: 0 },
      ]}
    >
      <View style={styles.row}>
        {items.map((tab) => {
          const isActive = activeTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              style={styles.btn}
              onPress={() => onTabChange(tab.key)}
              activeOpacity={0.7}
            >
              <Ionicons
                name={isActive ? tab.iconActive : tab.icon}
                size={22}
                color={isActive ? QuinckleColors.primary : QuinckleColors.textTertiary}
              />
              {/* Five tabs on a narrow phone: clip rather than wrap, which
                  would shove the row taller than the icons. */}
              <Text numberOfLines={1} style={[styles.label, isActive && styles.labelActive]}>{tab.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    backgroundColor: QuinckleColors.background,
    borderTopWidth: 1,
    borderTopColor: QuinckleColors.border,
    paddingTop: Spacing.sm,
  },
  // Position for the plain (non-animatedBox) floating case — Radius.lg pill
  // inset from its parent box, same as before this was split out.
  floatingPosition: {
    left: Spacing.lg,
    right: Spacing.lg,
    bottom: Spacing.md,
  },
  // The pill's look only (shape/border/background) — split from its position
  // so an animatedBox caller gets the same shape without the position clash.
  floatingLook: {
    paddingTop: 0,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    backgroundColor: QuinckleColors.surface,
    overflow: 'hidden',
    borderTopWidth: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingHorizontal: Spacing.lg,
  },
  btn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: Spacing.sm,
  },
  label: {
    ...Typography.micro,
    color: QuinckleColors.textTertiary,
  },
  labelActive: {
    color: QuinckleColors.primary,
    fontWeight: '600',
  },
});
