import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { QuinckleColors, Spacing, Typography } from '../../constants/Colors';

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
}: BottomNavbarProps<K>) {
  const insets = useSafeAreaInsets();
  const items = (tabs ?? (DEFAULT_STAFF_TABS as unknown as BottomNavTab<K>[]));

  return (
    <View style={[styles.container, { paddingBottom: Math.max(insets.bottom, Spacing.sm) }]}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: QuinckleColors.background,
    borderTopWidth: 1,
    borderTopColor: QuinckleColors.border,
    paddingTop: Spacing.sm,
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
