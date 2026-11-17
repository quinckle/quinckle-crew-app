/**
 * NamePrinterSheet — what staff will call this printer.
 *
 * Asked once when a printer is added (after width and role), and again from the
 * printer's Rename button. The name is what every screen, the invoice picker and
 * "Printed on Counter" show, so it should say where the printer IS, not what
 * model it is — the model stays visible underneath as the system name.
 *
 * Names are unique per venue (case-insensitive). The sheet checks the names it
 * already knows so a clash is caught before anything is saved; the server is
 * still the authority and refuses one this list didn't know about.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { BottomSheet } from './BottomSheet';
import { QuinckleColors, Radius, Spacing, Typography } from '../../constants/Colors';

/** One tap for the names almost every venue uses. */
const SUGGESTIONS = ['Counter', 'Kitchen', 'Bar', 'Billing'];
const NAME_MAX = 60;

interface Props {
  visible: boolean;
  /** "Name this printer" when adding, "Rename printer" when renaming. */
  title: string;
  /** Prefilled text — the current name, or the hardware name for a new one. */
  initialName: string;
  /** What the hardware calls itself, shown below the field. */
  systemName?: string | null;
  /** Other printers' names in this venue, for the clash check. */
  takenNames: string[];
  onSave: (name: string) => void;
  onClose: () => void;
  /** When adding: keep the hardware's own name instead. */
  skipLabel?: string;
}

export function NamePrinterSheet({
  visible, title, initialName, systemName, takenNames, onSave, onClose, skipLabel,
}: Props) {
  const [name, setName] = useState(initialName);

  useEffect(() => {
    if (visible) setName(initialName);
  }, [visible, initialName]);

  const trimmed = name.trim();
  const taken = useMemo(() => new Set(takenNames.map((n) => n.trim().toLowerCase())), [takenNames]);
  const clash = trimmed.length > 0 && taken.has(trimmed.toLowerCase());
  const canSave = trimmed.length > 0 && !clash;

  return (
    <BottomSheet visible={visible} onClose={onClose} title={title}>
      <View style={styles.body}>
        <Text style={styles.sub}>
          Say where it is — this is what everyone sees when they print.
        </Text>

        <TextInput
          style={[styles.input, clash && styles.inputError]}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Counter"
          placeholderTextColor={QuinckleColors.textMuted}
          maxLength={NAME_MAX}
          autoFocus
          autoCapitalize="words"
          returnKeyType="done"
          onSubmitEditing={() => { if (canSave) onSave(trimmed); }}
          accessibilityLabel="Printer name"
        />
        {clash ? (
          <Text style={styles.error}>Another printer is already called “{trimmed}”.</Text>
        ) : systemName ? (
          <Text style={styles.system}>System name: {systemName}</Text>
        ) : null}

        <View style={styles.chips}>
          {SUGGESTIONS.filter((s) => !taken.has(s.toLowerCase())).map((s) => (
            <TouchableOpacity
              key={s}
              style={[styles.chip, trimmed === s && styles.chipOn]}
              onPress={() => setName(s)}
              activeOpacity={0.8}
              accessibilityRole="button"
            >
              <Text style={[styles.chipText, trimmed === s && styles.chipTextOn]}>{s}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity
          style={[styles.save, !canSave && styles.saveDisabled]}
          onPress={() => onSave(trimmed)}
          disabled={!canSave}
          activeOpacity={0.85}
          accessibilityRole="button"
        >
          <Text style={styles.saveText}>Save name</Text>
        </TouchableOpacity>

        {skipLabel && (
          <TouchableOpacity style={styles.skip} onPress={onClose} activeOpacity={0.7}>
            <Text style={styles.skipText}>{skipLabel}</Text>
          </TouchableOpacity>
        )}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.xl },
  sub: { ...Typography.caption, color: QuinckleColors.textMuted, paddingBottom: Spacing.md },
  input: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: QuinckleColors.surfaceElevated,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    fontSize: 16,
    color: QuinckleColors.textPrimary,
  },
  inputError: { borderColor: QuinckleColors.danger },
  error: { ...Typography.caption, color: QuinckleColors.danger, marginTop: 6 },
  system: { ...Typography.caption, color: QuinckleColors.textMuted, marginTop: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.md },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
  },
  chipOn: { borderColor: QuinckleColors.primary },
  chipText: { fontSize: 13, fontWeight: '600', color: QuinckleColors.textSecondary },
  chipTextOn: { color: QuinckleColors.primary },
  save: {
    marginTop: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: Radius.lg,
    alignItems: 'center',
    backgroundColor: QuinckleColors.primary,
  },
  saveDisabled: { backgroundColor: QuinckleColors.surfaceMuted },
  saveText: { ...Typography.body, color: '#fff', fontWeight: '700' },
  skip: { alignItems: 'center', paddingVertical: Spacing.md },
  skipText: { ...Typography.body, color: QuinckleColors.textSecondary, fontWeight: '600' },
});
