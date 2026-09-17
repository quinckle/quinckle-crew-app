/**
 * Add a raw material from the floor (CREW_STOCK_PLAN.md §2 C2).
 *
 * The owner is the bottleneck this whole screen exists to remove, so a new
 * ingredient must not wait for them. A duplicate name comes back from the server
 * as NAME_TAKEN, and we say so plainly rather than creating a second "Tomato".
 */

import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { BottomSheet } from '../ui/BottomSheet';
import { QuinckleColors as C, Radius, Spacing } from '../../constants/Colors';
import { UNIT_LABEL, type StockEntryUnit } from '../../constants/stock';
import { crewStock } from '../../services/api';
import { ErrorLine, FieldLabel, PrimaryButton, sheetStyles } from './pieces';

/** What a kitchen buys in. The base unit (g / ml / pcs) is derived server-side. */
const UNITS: StockEntryUnit[] = ['KG', 'LITRE', 'PCS'];

export function AddMaterialSheet({ visible, initialName, onClose, onDone }: {
  visible: boolean;
  /** Pre-fills from a search that found nothing — the way this gets used mid-delivery. */
  initialName?: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [name, setName] = useState('');
  const [unit, setUnit] = useState<StockEntryUnit>('KG');
  const [low, setLow] = useState('');
  const [opening, setOpening] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setName(initialName ?? ''); setUnit('KG'); setLow(''); setOpening(''); setError(null);
  }, [visible, initialName]);

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
      onDone(`${name.trim()} added`);
    } catch (e: any) {
      const code = e?.code ?? e?.error;
      setError(code === 'NAME_TAKEN' ? 'That material already exists — restock it instead' : (e?.message ?? 'Could not add it'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Add material" maxHeightRatio={0.8}>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <FieldLabel>Name</FieldLabel>
        <TextInput
          style={sheetStyles.input} value={name} onChangeText={setName}
          placeholder="Tomato" placeholderTextColor={C.textMuted} autoFocus={!initialName}
        />

        <FieldLabel>Bought in</FieldLabel>
        <View style={st.units}>
          {UNITS.map((u) => (
            <TouchableOpacity key={u} style={[st.unit, u === unit && st.unitOn]} onPress={() => setUnit(u)} activeOpacity={0.8}>
              <Text style={[st.unitText, u === unit && st.unitTextOn]}>{UNIT_LABEL[u]}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={[sheetStyles.hint, { marginTop: 6 }]}>This cannot be changed later — it would reinterpret every past quantity.</Text>

        <FieldLabel>Tell me when it drops below</FieldLabel>
        <TextInput
          style={sheetStyles.input} value={low} onChangeText={setLow} keyboardType="decimal-pad"
          placeholder={`Optional · ${UNIT_LABEL[unit]}`} placeholderTextColor={C.textMuted}
        />

        <FieldLabel>How much is there now</FieldLabel>
        <TextInput
          style={sheetStyles.input} value={opening} onChangeText={setOpening} keyboardType="decimal-pad"
          placeholder={`Optional · ${UNIT_LABEL[unit]}`} placeholderTextColor={C.textMuted}
        />

        <ErrorLine text={error} />
        <PrimaryButton label="Add material" onPress={save} busy={busy} />
        <View style={{ height: Spacing.xl }} />
      </ScrollView>
    </BottomSheet>
  );
}

const st = StyleSheet.create({
  units: { flexDirection: 'row', gap: Spacing.sm },
  unit: { flex: 1, paddingVertical: 12, borderRadius: Radius.md, borderWidth: 1, borderColor: C.border, alignItems: 'center' },
  unitOn: { backgroundColor: C.primarySoft, borderColor: C.primarySoftBorder },
  unitText: { color: C.textSecondary, fontSize: 14, fontWeight: '600' },
  unitTextOn: { color: C.primary },
});
