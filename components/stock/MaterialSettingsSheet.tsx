/**
 * A material's own settings (CREW_STOCK_PLAN.md §3).
 *
 * The low level is the point of this sheet: it is what decides whether a
 * material sits in the Running low section of the ledger, and it is what a
 * low-stock alert will fire on. It is typed in kitchen units — 5 means 5 kg —
 * so the unit travels with the number.
 *
 * The material's own unit is not editable, and that is deliberate: changing it
 * would silently reinterpret every quantity ever recorded against it.
 */

import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { BottomSheet } from '../ui/BottomSheet';
import { QuinckleColors as C, Spacing } from '../../constants/Colors';
import {
  UNIT_LABEL, entryUnitsFor, defaultEntryUnit, fmtQty, fromBase, type StockEntryUnit,
} from '../../constants/stock';
import { crewStock, type CrewMaterial } from '../../services/api';
import { ErrorLine, FieldLabel, PrimaryButton, QtyRow, sheetStyles } from './pieces';

export function MaterialSettingsSheet({ material, visible, onClose, onDone }: {
  material: CrewMaterial;
  visible: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const units = entryUnitsFor(material.unit);
  const [name, setName] = useState(material.name);
  const [low, setLow] = useState('');
  const [lowUnit, setLowUnit] = useState<StockEntryUnit>(defaultEntryUnit(material.unit));
  const [hide, setHide] = useState(!!material.hideDishesWhenOut);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setName(material.name);
    const entry = material.lowStockAt != null ? fromBase(material.lowStockAt, material.unit) : null;
    setLow(entry ? String(entry.qty) : '');
    setLowUnit(entry ? entry.unit : defaultEntryUnit(material.unit));
    setHide(!!material.hideDishesWhenOut);
    setError(null);
  }, [visible, material]);

  const save = async () => {
    if (!name.trim()) { setError('Give it a name'); return; }
    const cleared = low.trim() === '';
    const n = Number(low);
    if (!cleared && (!Number.isFinite(n) || n < 0)) { setError('That low level does not look right'); return; }
    setBusy(true); setError(null);
    try {
      await crewStock.updateMaterial(material.id, {
        name: name.trim(),
        lowStockAt: cleared ? null : n,
        ...(cleared ? {} : { lowStockUnit: lowUnit }),
        hideDishesWhenOut: hide,
      });
      onDone('Settings saved');
    } catch (e: any) {
      setError(e?.code === 'NAME_TAKEN' ? 'Another material already has that name' : (e?.message ?? 'Could not save'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title={`${material.name} settings`} maxHeightRatio={0.8}>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <FieldLabel>Name</FieldLabel>
        <TextInput
          style={sheetStyles.input} value={name} onChangeText={setName}
          placeholder="Tomato" placeholderTextColor={C.textMuted}
        />

        <FieldLabel>Tell me when it drops below</FieldLabel>
        <QtyRow value={low} onChange={setLow} unit={lowUnit} onUnit={setLowUnit} units={units} placeholder="No alert" />
        <Text style={[sheetStyles.hint, { marginTop: 6 }]}>
          {low.trim() === ''
            ? 'Leave empty and it never shows as running low.'
            : `Below this it moves to Running low. Right now: ${fmtQty(material.currentQty, material.unit)}.`}
        </Text>

        <TouchableOpacity style={st.toggleRow} onPress={() => setHide((v) => !v)} activeOpacity={0.8}>
          <View style={{ flex: 1 }}>
            <Text style={st.toggleLabel}>Hide its dishes when it runs out</Text>
            <Text style={sheetStyles.hint}>They come back on their own after a restock or a count.</Text>
          </View>
          <View style={[st.switch, hide && st.switchOn]}>
            <View style={[st.knob, hide && st.knobOn]} />
          </View>
        </TouchableOpacity>

        <Text style={[sheetStyles.hint, { marginTop: Spacing.lg }]}>
          Measured in {UNIT_LABEL[defaultEntryUnit(material.unit)]} — that cannot be changed once stock has moved.
        </Text>

        <ErrorLine text={error} />
        <PrimaryButton label="Save settings" onPress={save} busy={busy} />
        <View style={{ height: Spacing.xl }} />
      </ScrollView>
    </BottomSheet>
  );
}

const st = StyleSheet.create({
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginTop: Spacing.lg },
  toggleLabel: { color: C.textPrimary, fontSize: 14.5, fontWeight: '600', marginBottom: 2 },
  switch: { width: 44, height: 26, borderRadius: 13, backgroundColor: C.surfaceMutedHover, borderWidth: 1, borderColor: C.border, padding: 2 },
  switchOn: { backgroundColor: C.primary, borderColor: C.primary },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: C.textMuted },
  knobOn: { backgroundColor: '#fff', alignSelf: 'flex-end' },
});
