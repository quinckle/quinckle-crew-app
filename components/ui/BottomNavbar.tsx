import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { QuinckleColors, Spacing, Typography } from '../../constants/Colors';

type NavItem = 'tables' | 'menu' | 'orders' | 'activity';

interface BottomNavbarProps {
  activeTab: NavItem;
  onTabChange: (tab: NavItem) => void;
}

const TABS: { key: NavItem; label: string; icon: keyof typeof Ionicons.glyphMap; iconActive: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'orders', label: 'Orders', icon: 'receipt-outline', iconActive: 'receipt' },
  { key: 'tables', label: 'Tables', icon: 'grid-outline', iconActive: 'grid' },
  { key: 'menu', label: 'Menu', icon: 'restaurant-outline', iconActive: 'restaurant' },
];

export function BottomNavbar({ activeTab, onTabChange }: BottomNavbarProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingBottom: Math.max(insets.bottom, Spacing.sm) }]}>
      <View style={styles.row}>
        {TABS.map((tab) => {
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
              <Text style={[styles.label, isActive && styles.labelActive]}>{tab.label}</Text>
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
