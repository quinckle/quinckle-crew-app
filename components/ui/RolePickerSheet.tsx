/**
 * RolePickerSheet — what a printer prints: kitchen tickets, bills, or both.
 *
 * Sibling of WidthPickerSheet, shown right after it when adding a printer. The
 * wording is deliberately about paper rather than data model: a partner thinks
 * "the one in the kitchen" and "the one at the counter", not KOT and BILL.
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheet } from './BottomSheet';
import { QuinckleColors, Radius, Spacing, Typography } from '../../constants/Colors';
import type { PrinterRole } from '../../services/api';

interface Props {
  visible: boolean;
  onPick: (role: PrinterRole) => void;
  onClose: () => void;
  /** Highlight the current choice when editing an existing printer. */
  current?: PrinterRole;
}

const OPTIONS: { role: PrinterRole; icon: keyof typeof Ionicons.glyphMap; title: string; sub: string }[] = [
  {
    role: 'KOT',
    icon: 'restaurant-outline',
    title: 'Kitchen tickets',
    sub: 'Every new order prints here',
  },
  {
    role: 'BILL',
    icon: 'receipt-outline',
    title: 'Bills only',
    sub: 'Invoices for customers — no kitchen tickets',
  },
  {
    role: 'BOTH',
    icon: 'copy-outline',
    title: 'Both',
    sub: 'Kitchen tickets and bills on this one printer',
  },
];

export function RolePickerSheet({ visible, onPick, onClose, current }: Props) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title="What does it print?">
      <Text style={styles.sub}>
        You can change this later from the printer&apos;s row.
      </Text>
      <View style={styles.list}>
        {OPTIONS.map((option) => {
          const selected = current === option.role;
          return (
            <TouchableOpacity
              key={option.role}
              style={[styles.row, selected && styles.rowSelected]}
              onPress={() => onPick(option.role)}
              activeOpacity={0.8}
            >
              <View style={[styles.iconWrap, selected && styles.iconWrapSelected]}>
                <Ionicons
                  name={option.icon}
                  size={20}
                  color={selected ? QuinckleColors.primary : QuinckleColors.textSecondary}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{option.title}</Text>
                <Text style={styles.rowSub}>{option.sub}</Text>
              </View>
              {selected && (
                <Ionicons name="checkmark-circle" size={20} color={QuinckleColors.primary} />
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sub: {
    ...Typography.caption,
    color: QuinckleColors.textMuted,
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.md,
  },
  list: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xl,
    gap: Spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    backgroundColor: QuinckleColors.surface,
  },
  rowSelected: {
    borderColor: QuinckleColors.primary,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: QuinckleColors.surfaceMuted,
  },
  iconWrapSelected: {
    backgroundColor: `${QuinckleColors.primary}1A`,
  },
  rowTitle: {
    ...Typography.body,
    color: QuinckleColors.textPrimary,
    fontWeight: '600',
  },
  rowSub: {
    ...Typography.caption,
    color: QuinckleColors.textMuted,
    marginTop: 2,
  },
});
