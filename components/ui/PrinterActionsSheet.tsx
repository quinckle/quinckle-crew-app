/**
 * PrinterActionsSheet — the ⋯ menu on a printer's row.
 *
 * Rename, what it prints, default for bills, and remove used to sit as a row
 * of buttons under every printer. They're rare, setup-time actions, so they
 * live here and the row keeps only Test / Use this device.
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheet } from './BottomSheet';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';

type Action = {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  sub?: string;
  danger?: boolean;
  onPress: () => void;
};

interface Props {
  visible: boolean;
  printerName: string;
  /** Shown only when the venue has a second bill printer to choose between. */
  canMakeDefault: boolean;
  onRename: () => void;
  onChangeRole: () => void;
  onMakeDefault: () => void;
  onRemove: () => void;
  onClose: () => void;
}

export function PrinterActionsSheet({
  visible, printerName, canMakeDefault, onRename, onChangeRole, onMakeDefault, onRemove, onClose,
}: Props) {
  const actions: Action[] = [
    { key: 'rename', icon: 'pencil-outline', label: 'Rename', onPress: onRename },
    { key: 'role', icon: 'swap-horizontal-outline', label: 'Change what it prints', sub: 'Kitchen tickets, bills, or both', onPress: onChangeRole },
    ...(canMakeDefault
      ? [{ key: 'default', icon: 'star-outline' as const, label: 'Make default for bills', sub: 'Bills print here unless someone picks another', onPress: onMakeDefault }]
      : []),
    { key: 'remove', icon: 'trash-outline', label: 'Remove printer', danger: true, onPress: onRemove },
  ];

  return (
    <BottomSheet visible={visible} onClose={onClose} title={printerName}>
      <View style={styles.list}>
        {actions.map((a) => (
          <TouchableOpacity key={a.key} style={styles.row} onPress={a.onPress} activeOpacity={0.75}>
            <View style={[styles.iconWrap, a.danger && styles.iconWrapDanger]}>
              <Ionicons name={a.icon} size={19} color={a.danger ? QuinckleColors.danger : QuinckleColors.textSecondary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, a.danger && styles.labelDanger]}>{a.label}</Text>
              {!!a.sub && <Text style={styles.sub}>{a.sub}</Text>}
            </View>
          </TouchableOpacity>
        ))}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  list: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.md,
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
  iconWrap: {
    width: 38,
    height: 38,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: QuinckleColors.surfaceMuted,
  },
  iconWrapDanger: { backgroundColor: QuinckleColors.dangerSoft },
  label: { fontSize: 15, fontWeight: '600', color: QuinckleColors.textPrimary },
  labelDanger: { color: QuinckleColors.danger },
  sub: { fontSize: 12, color: QuinckleColors.textTertiary, marginTop: 2 },
});
