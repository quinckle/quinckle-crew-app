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
import { QuinckleColors as C, Spacing } from '../../../constants/Colors';
import { UNIT_LABEL, UNIT_NAME, BASE_OF_ENTRY, type StockEntryUnit } from '../../../constants/stock';
import { ErrorLine, FieldLabel, PrimaryButton, sheetStyles } from '../../../components/stock/pieces';
import { UnitPicker, UnitField } from '../../../components/stock/UnitPicker';

export default function NewMaterialScreen() {
  const insets = useSafeAreaInsets();
  // Pre-filled when you got here from a search that found nothing — the way a
  // new ingredient actually gets recorded mid-delivery.
  const { name: initialName } = useLocalSearchParams<{ name?: string }>();

  const [name, setName] = useState(initialName ?? '');
  const [unit, setUnit] = useState<StockEntryUnit>('KG');
  const [low, setLow] = useState('');
  const [opening, setOpening] = useState('');
  const [unitOpen, setUnitOpen] = useState(false);
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

        <FieldLabel>Measured in</FieldLabel>
        <UnitField value={unit} onPress={() => setUnitOpen(true)} />
        <Text style={[sheetStyles.hint, { marginTop: 8 }]}>
          {BASE_OF_ENTRY[unit] === 'PCS'
            ? 'Counted one by one.'
            : `Stored in ${BASE_OF_ENTRY[unit] === 'GRAM' ? 'grams' : 'millilitres'} — you can still type ${UNIT_NAME[unit].toLowerCase()} anywhere.`}
          {' '}What it measures cannot change later; it would reinterpret every quantity recorded against it.
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

      <UnitPicker
        visible={unitOpen}
        value={unit}
        onClose={() => setUnitOpen(false)}
        onPick={(u) => { setUnit(u); setUnitOpen(false); }}
      />
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
});
