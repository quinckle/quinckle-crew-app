/**
 * WidthPickerSheet — bottom sheet for choosing the printer's paper roll width.
 * Replaces the old cramped ThemedDialog (all presets + Cancel squeezed into
 * one row) with a 2x2 tile grid, one tile per PAPER_PRESETS entry.
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { BottomSheet } from './BottomSheet';
import { PAPER_PRESETS } from '../../services/paperProfile';
import { QuinckleColors, Radius, Spacing, Typography } from '../../constants/Colors';

interface Props {
  visible: boolean;
  onPick: (widthMM: number) => void;
  onClose: () => void;
}

/** Pulls the "(2 inch)" part out of a preset label; falls back to "standard". */
function subtitleFor(label: string): string {
  const match = label.match(/\(([^)]+)\)/);
  return match ? match[1] : 'standard';
}

export function WidthPickerSheet({ visible, onPick, onClose }: Props) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Paper width">
      <Text style={styles.sub}>Select the printer&apos;s paper roll width.</Text>
      <View style={styles.grid}>
        {PAPER_PRESETS.map((preset) => (
          <TouchableOpacity
            key={preset.widthMM}
            style={styles.tile}
            onPress={() => onPick(preset.widthMM)}
            activeOpacity={0.8}
          >
            <Text style={styles.tileWidth}>{preset.widthMM}mm</Text>
            <Text style={styles.tileSub}>{subtitleFor(preset.label)}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sub: {
    ...Typography.caption,
    color: QuinckleColors.textMuted,
    paddingHorizontal: Spacing.xl,
    marginBottom: Spacing.lg,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: Spacing.xl,
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  tile: {
    flexBasis: '48%',
    flexGrow: 1,
    alignItems: 'center',
    backgroundColor: QuinckleColors.surfaceElevated,
    borderRadius: Radius.md,
    borderWidth: 1.5,
    borderColor: 'transparent',
    paddingVertical: Spacing.md,
  },
  tileWidth: {
    ...Typography.bodyStrong,
    color: QuinckleColors.textPrimary,
  },
  tileSub: {
    ...Typography.micro,
    color: QuinckleColors.textSecondary,
    marginTop: 2,
  },
});
