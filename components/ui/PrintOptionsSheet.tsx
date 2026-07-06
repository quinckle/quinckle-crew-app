/**
 * PrintOptionsSheet — bottom sheet replacing the "Print KOT / Print Invoice"
 * popover on the table-detail screen. Two square cards side by side.
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheet } from './BottomSheet';
import { QuinckleColors, Radius, Spacing, Typography } from '../../constants/Colors';

interface Props {
  visible: boolean;
  onPrintKot: () => void;
  onPrintInvoice: () => void;
  onClose: () => void;
}

function PrintCard({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.iconWrap}>
        <Ionicons name={icon} size={22} color={QuinckleColors.textSecondary} />
      </View>
      <Text style={styles.cardLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

export function PrintOptionsSheet({ visible, onPrintKot, onPrintInvoice, onClose }: Props) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Print">
      <View style={styles.grid}>
        <PrintCard icon="restaurant-outline" label="Print KOT" onPress={onPrintKot} />
        <PrintCard icon="receipt-outline" label="Print invoice" onPress={onPrintInvoice} />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  grid: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.xl,
    gap: Spacing.md,
    marginBottom: Spacing.sm,
  },
  card: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: QuinckleColors.surfaceElevated,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.sm,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    backgroundColor: QuinckleColors.surfaceMutedHover,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardLabel: {
    ...Typography.bodyStrong,
    color: QuinckleColors.textPrimary,
    textAlign: 'center',
  },
});
