/**
 * Unit dropdown (CREW_STOCK_PLAN.md §3).
 *
 * Two jobs, one sheet:
 *
 *  - On a NEW material it picks what the material measures — weight, volume or
 *    count — and that choice is permanent, so the sheet shows all three kinds
 *    with what each is for.
 *  - On an EXISTING material it picks how you want to type this one quantity, so
 *    it only offers that material's own kind: kg or g for weight, never ml.
 *    Mixing kinds has no answer — there is no density to convert paneer with.
 *
 * Each row carries what one of it is worth in the base unit, because "quintal"
 * means different things to different people and the factor should not be folk
 * knowledge.
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheet } from '../ui/BottomSheet';
import { QuinckleColors as C, Spacing } from '../../constants/Colors';
import {
  UNIT_KINDS, UNIT_NAME, UNIT_LABEL, UNIT_FACTOR, BASE_OF_ENTRY, entryUnitsFor,
  type StockBaseUnit, type StockEntryUnit,
} from '../../constants/stock';

/** "1 kg = 1,000 g" — the sentence that stops a 100× mistake. */
function worth(u: StockEntryUnit): string | null {
  const factor = UNIT_FACTOR[u];
  if (factor === 1) return null;
  const base = BASE_OF_ENTRY[u];
  const baseLabel = base === 'GRAM' ? 'g' : base === 'ML' ? 'ml' : 'pcs';
  return `1 ${UNIT_LABEL[u]} = ${factor.toLocaleString('en-IN')} ${baseLabel}`;
}

export function UnitPicker({ visible, value, base, onClose, onPick }: {
  visible: boolean;
  value: StockEntryUnit;
  /** Given: offer only this material's kind. Omitted: offer all three. */
  base?: StockBaseUnit;
  onClose: () => void;
  onPick: (u: StockEntryUnit) => void;
}) {
  const kinds = base
    ? UNIT_KINDS.filter((k) => k.base === base).map((k) => ({ ...k, units: entryUnitsFor(base) }))
    : UNIT_KINDS;

  return (
    <BottomSheet visible={visible} onClose={onClose} title={base ? 'Enter in' : 'What does it measure?'} maxHeightRatio={0.85}>
      {kinds.map((kind) => (
        <View key={kind.base}>
          <Text style={s.kind}>{kind.label}</Text>
          {!base && <Text style={s.kindHint}>{kind.hint}</Text>}
          {kind.units.map((u) => {
            const w = worth(u);
            return (
              <TouchableOpacity key={u} style={s.row} onPress={() => onPick(u)} activeOpacity={0.75}>
                <View style={{ flex: 1 }}>
                  <Text style={[s.name, value === u && s.nameOn]}>{UNIT_NAME[u]}</Text>
                  {w && <Text style={s.worth}>{w}</Text>}
                </View>
                <Text style={s.short}>{UNIT_LABEL[u]}</Text>
                {value === u && <Ionicons name="checkmark" size={18} color={C.primary} />}
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
      {!base && (
        <Text style={s.foot}>
          Packet, box and crate are not here on purpose — a crate is 24 bottles of one thing and 12 of
          another, so it belongs to the material, not to the list.
        </Text>
      )}
      <View style={{ height: Spacing.xl }} />
    </BottomSheet>
  );
}

/** The closed state of the dropdown — tap to open the sheet above. */
export function UnitField({ value, onPress, compact }: { value: StockEntryUnit; onPress: () => void; compact?: boolean }) {
  return (
    <TouchableOpacity style={[s.field, compact && s.fieldCompact]} onPress={onPress} activeOpacity={0.8}>
      <Text style={s.fieldText} numberOfLines={1}>{compact ? UNIT_LABEL[value] : UNIT_NAME[value]}</Text>
      <Ionicons name="chevron-down" size={14} color={C.textSecondary} />
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  kind: {
    color: C.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 0.8,
    textTransform: 'uppercase', marginTop: Spacing.lg,
  },
  kindHint: { color: C.textTertiary, fontSize: 11.5, marginTop: 2, marginBottom: 4 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: C.borderSubtle,
  },
  name: { color: C.textPrimary, fontSize: 15, fontWeight: '500' },
  nameOn: { fontWeight: '700' },
  worth: { color: C.textTertiary, fontSize: 11.5, marginTop: 2, fontVariant: ['tabular-nums'] },
  short: { color: C.textSecondary, fontSize: 13, fontWeight: '600' },
  foot: { color: C.textMuted, fontSize: 11.5, lineHeight: 17, marginTop: Spacing.lg },
  field: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6,
    backgroundColor: C.surfaceMutedHover, borderWidth: 1, borderColor: C.border, borderRadius: 12,
    paddingHorizontal: Spacing.md, paddingVertical: 13,
  },
  fieldCompact: { paddingVertical: 12, minWidth: 92 },
  fieldText: { color: C.textPrimary, fontSize: 15, fontWeight: '600' },
});
