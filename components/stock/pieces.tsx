/**
 * Small shared pieces for the crew stock screens (CREW_STOCK_PLAN.md §3).
 * Kept in one file because none of them is worth a screen of its own.
 */

import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { QuinckleColors as C, Radius, Spacing } from '../../constants/Colors';
import {
  UNIT_LABEL, UNIT_NAME, UNIT_FACTOR, BASE_OF_ENTRY, REASONS,
  type StockEntryUnit, type WastageReason,
} from '../../constants/stock';

export function LevelBadge({ isOut, isLow }: { isOut: boolean; isLow: boolean }) {
  if (!isOut && !isLow) return null;
  const bad = isOut;
  return (
    <View style={[s.badge, { backgroundColor: bad ? C.dangerSoft : C.warningSoft, borderColor: bad ? C.dangerBorder : C.warningBorder }]}>
      <Text style={[s.badgeText, { color: bad ? C.danger : C.warning }]}>{bad ? 'OUT' : 'LOW'}</Text>
    </View>
  );
}

/** A field label in the app's uppercase micro style. */
export function FieldLabel({ children }: { children: React.ReactNode }) {
  return <Text style={s.label}>{children}</Text>;
}

/**
 * Number box + unit dropdown on one line.
 *
 * The dropdown expands INLINE rather than opening a sheet, because every caller
 * is already inside a bottom sheet and this app's sheets render in the tree
 * rather than as native modals — a sheet inside a sheet would be clipped by its
 * parent's scroll view.
 *
 * A material with only one possible unit (pieces) shows a static chip: there is
 * nothing to choose.
 */
export function QtyRow({ value, onChange, unit, onUnit, units, placeholder, autoFocus }: {
  value: string; onChange: (v: string) => void;
  unit: StockEntryUnit; onUnit: (u: StockEntryUnit) => void; units: StockEntryUnit[];
  placeholder?: string; autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <View>
      <View style={s.qtyRow}>
        <TextInput
          style={s.qtyInput} value={value} onChangeText={onChange} keyboardType="decimal-pad"
          placeholder={placeholder ?? '0'} placeholderTextColor={C.textMuted} autoFocus={autoFocus}
        />
        {units.length > 1 ? (
          <TouchableOpacity style={[s.unitField, open && s.unitFieldOn]} onPress={() => setOpen((v) => !v)} activeOpacity={0.8}>
            <Text style={s.unitFieldText}>{UNIT_LABEL[unit]}</Text>
            <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={13} color={C.textSecondary} />
          </TouchableOpacity>
        ) : (
          <View style={s.unitStatic}><Text style={s.unitChipText}>{UNIT_LABEL[unit]}</Text></View>
        )}
      </View>

      {open && (
        <View style={s.unitList}>
          {units.map((u) => {
            const factor = UNIT_FACTOR[u];
            const base = BASE_OF_ENTRY[u];
            const baseLabel = base === 'GRAM' ? 'g' : base === 'ML' ? 'ml' : 'pcs';
            return (
              <TouchableOpacity
                key={u} style={s.unitRow} activeOpacity={0.75}
                onPress={() => { onUnit(u); setOpen(false); }}
              >
                <Text style={[s.unitName, u === unit && s.unitNameOn]}>{UNIT_NAME[u]}</Text>
                {factor !== 1 && (
                  <Text style={s.unitWorth}>1 {UNIT_LABEL[u]} = {factor.toLocaleString('en-IN')} {baseLabel}</Text>
                )}
                {u === unit && <Ionicons name="checkmark" size={16} color={C.primary} />}
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
}

export function ReasonChips({ value, onChange }: { value: WastageReason | null; onChange: (r: WastageReason) => void }) {
  return (
    <View style={s.chipsWrap}>
      {REASONS.map((r) => (
        <TouchableOpacity
          key={r.value} onPress={() => onChange(r.value)} activeOpacity={0.8}
          style={[s.chip, value === r.value && s.chipOn]}
        >
          <Text style={[s.chipText, value === r.value && s.chipTextOn]}>{r.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

/** The one filled button at the bottom of a sheet. */
export function PrimaryButton({ label, onPress, busy, disabled }: {
  label: string; onPress: () => void; busy?: boolean; disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[s.primary, (disabled || busy) && { opacity: 0.55 }]}
      onPress={onPress} disabled={disabled || busy} activeOpacity={0.85}
    >
      {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryText}>{label}</Text>}
    </TouchableOpacity>
  );
}

/** Inline validation / failure line. Never a silent no-op on a tapped Save. */
export function ErrorLine({ text }: { text: string | null }) {
  if (!text) return null;
  return <Text style={s.error}>{text}</Text>;
}

export const sheetStyles = StyleSheet.create({
  input: {
    backgroundColor: C.surfaceMutedHover, borderRadius: Radius.md, borderWidth: 1, borderColor: C.border,
    color: C.textPrimary, paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, fontSize: 16,
  },
  hint: { color: C.textSecondary, fontSize: 12.5, lineHeight: 18 },
});

const s = StyleSheet.create({
  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
  badgeText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.4 },
  label: {
    color: C.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 0.8,
    textTransform: 'uppercase', marginTop: Spacing.md, marginBottom: 6,
  },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  qtyInput: {
    flex: 1, backgroundColor: C.surfaceMutedHover, borderRadius: Radius.md, borderWidth: 1, borderColor: C.border,
    color: C.textPrimary, paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, fontSize: 17,
    fontVariant: ['tabular-nums'],
  },
  unitField: {
    flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 86, justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, paddingVertical: 12, borderRadius: Radius.md,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.surfaceMutedHover,
  },
  unitFieldOn: { borderColor: C.primarySoftBorder, backgroundColor: C.primarySoft },
  unitFieldText: { color: C.textPrimary, fontSize: 14, fontWeight: '600' },
  unitList: {
    marginTop: 6, borderRadius: Radius.md, borderWidth: 1, borderColor: C.border,
    backgroundColor: C.surfaceElevated, overflow: 'hidden',
  },
  unitRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.md, paddingVertical: 11,
    borderBottomWidth: 1, borderBottomColor: C.borderSubtle,
  },
  unitName: { flex: 1, color: C.textPrimary, fontSize: 14, fontWeight: '500' },
  unitNameOn: { fontWeight: '700' },
  unitWorth: { color: C.textTertiary, fontSize: 11, fontVariant: ['tabular-nums'] },
  unitChipText: { color: C.textSecondary, fontSize: 13, fontWeight: '600' },
  unitStatic: { paddingHorizontal: Spacing.md, paddingVertical: 11, borderRadius: Radius.md, borderWidth: 1, borderColor: C.borderSubtle },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: { paddingHorizontal: Spacing.md, paddingVertical: 8, borderRadius: Radius.pill, borderWidth: 1, borderColor: C.border },
  chipOn: { backgroundColor: C.primarySoft, borderColor: C.primarySoftBorder },
  chipText: { color: C.textSecondary, fontSize: 13, fontWeight: '600' },
  chipTextOn: { color: C.primary },
  primary: {
    backgroundColor: C.primary, borderRadius: Radius.md, paddingVertical: 14,
    alignItems: 'center', justifyContent: 'center', marginTop: Spacing.lg,
  },
  primaryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  error: { color: C.danger, fontSize: 12.5, marginTop: Spacing.sm },
});
