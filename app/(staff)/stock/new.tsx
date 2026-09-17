/**
 * Add a raw material (CREW_STOCK_PLAN.md §2 C2).
 *
 * A screen, not a sheet: it is four decisions, one of them permanent (the unit
 * can never change once stock has moved), and it is often the first thing a new
 * venue does forty times in a row. A screen gives it room, a real back gesture,
 * and somewhere to put the consequences of each field.
 *
 * The owner is the bottleneck this whole section exists to remove, so a new
 * ingredient must not wait for them.
 */

import React, { useState } from 'react';
import {
  ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { crewStock } from '../../../services/api';
import { QuinckleColors as C, Radius, Spacing } from '../../../constants/Colors';
import { UNIT_LABEL, type StockEntryUnit } from '../../../constants/stock';
import { ErrorLine, FieldLabel, PrimaryButton, sheetStyles } from '../../../components/stock/pieces';

/** What a kitchen buys in. The base unit (g / ml / pcs) is derived server-side. */
const UNITS: { value: StockEntryUnit; label: string; hint: string }[] = [
  { value: 'KG', label: 'Kilograms', hint: 'Vegetables, paneer, rice' },
  { value: 'LITRE', label: 'Litres', hint: 'Milk, oil' },
  { value: 'PCS', label: 'Pieces', hint: 'Bottles, eggs, packets' },
];

export default function NewMaterialScreen() {
  const insets = useSafeAreaInsets();
  // Pre-filled when you got here from a search that found nothing — the way a
  // new ingredient actually gets recorded mid-delivery.
  const { name: initialName } = useLocalSearchParams<{ name?: string }>();

  const [name, setName] = useState(initialName ?? '');
  const [unit, setUnit] = useState<StockEntryUnit>('KG');
  const [low, setLow] = useState('');
  const [opening, setOpening] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const numOrNull = (v: string) => {
    if (v.trim() === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  };

  const save = async () => {
    if (!name.trim()) { setError('Give it a name'); return; }
    const lowN = numOrNull(low);
    const openN = numOrNull(opening);
    if (Number.isNaN(lowN) || Number.isNaN(openN)) { setError('Those numbers do not look right'); return; }
    setBusy(true); setError(null);
    try {
      await crewStock.createMaterial({ name: name.trim(), unit, lowStockAt: lowN, openingQty: openN });
      router.back();
    } catch (e: any) {
      const code = e?.code ?? e?.error;
      setError(code === 'NAME_TAKEN' ? 'That material already exists — restock it instead' : (e?.message ?? 'Could not add it'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <View style={s.headerBar}>
        <TouchableOpacity style={s.iconBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={22} color={C.textPrimary} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Add material</Text>
        <View style={s.iconBtn} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: Spacing.lg, paddingBottom: insets.bottom + 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <FieldLabel>Name</FieldLabel>
        <TextInput
          style={sheetStyles.input} value={name} onChangeText={setName}
          placeholder="Tomato" placeholderTextColor={C.textMuted} autoFocus={!initialName}
        />

        <FieldLabel>Bought in</FieldLabel>
        {UNITS.map((u) => (
          <TouchableOpacity
            key={u.value}
            style={[s.unit, unit === u.value && s.unitOn]}
            onPress={() => setUnit(u.value)}
            activeOpacity={0.8}
          >
            <View style={{ flex: 1 }}>
              <Text style={[s.unitLabel, unit === u.value && s.unitLabelOn]}>{u.label}</Text>
              <Text style={s.unitHint}>{u.hint}</Text>
            </View>
            {unit === u.value && <Ionicons name="checkmark" size={18} color={C.primary} />}
          </TouchableOpacity>
        ))}
        <Text style={[sheetStyles.hint, { marginTop: 8 }]}>
          This cannot be changed later — it would reinterpret every quantity recorded against it.
        </Text>

        <FieldLabel>Tell me when it drops below</FieldLabel>
        <TextInput
          style={sheetStyles.input} value={low} onChangeText={setLow} keyboardType="decimal-pad"
          placeholder={`Optional · ${UNIT_LABEL[unit]}`} placeholderTextColor={C.textMuted}
        />
        <Text style={[sheetStyles.hint, { marginTop: 6 }]}>
          Without this it can never show as running low — it stays under Stocked whatever happens.
        </Text>

        <FieldLabel>How much is there now</FieldLabel>
        <TextInput
          style={sheetStyles.input} value={opening} onChangeText={setOpening} keyboardType="decimal-pad"
          placeholder={`Optional · ${UNIT_LABEL[unit]}`} placeholderTextColor={C.textMuted}
        />

        <ErrorLine text={error} />
        <PrimaryButton label="Add material" onPress={save} busy={busy} />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  headerBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
  },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', color: C.textPrimary, fontSize: 17, fontWeight: '700' },
  unit: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingVertical: 12, paddingHorizontal: Spacing.md, marginBottom: 7,
    borderRadius: Radius.md, borderWidth: 1, borderColor: C.border,
  },
  unitOn: { backgroundColor: C.primarySoft, borderColor: C.primarySoftBorder },
  unitLabel: { color: C.textPrimary, fontSize: 15, fontWeight: '500' },
  unitLabelOn: { fontWeight: '700' },
  unitHint: { color: C.textTertiary, fontSize: 11.5, marginTop: 2 },
});
