/**
 * Stock-take (CREW_STOCK_PLAN.md §3).
 *
 * A count is the one action that can silently erase shrinkage, so it shows the
 * difference it is about to write and says out loud that it is recorded against
 * the person doing it. That visibility — not a second capability — is what makes
 * one shared STOCK key safe (§2 C1).
 */

import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { BottomSheet } from '../ui/BottomSheet';
import { QuinckleColors as C, Radius, Spacing } from '../../constants/Colors';
import { entryUnitsFor, defaultEntryUnit, fmtQty, toBase, type StockEntryUnit } from '../../constants/stock';
import { crewStock, type CrewMaterial } from '../../services/api';
import { ErrorLine, FieldLabel, PrimaryButton, QtyRow, sheetStyles } from './pieces';

export function CountSheet({ material, visible, onClose, onDone }: {
  material: CrewMaterial;
  visible: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const units = entryUnitsFor(material.unit);
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState<StockEntryUnit>(defaultEntryUnit(material.unit));
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    // Deliberately blank, not pre-filled with the system number: a pre-filled
    // box invites tapping Save without looking at the shelf.
    setQty(''); setUnit(defaultEntryUnit(material.unit)); setNote(''); setError(null);
  }, [visible, material.unit]);

  const n = Number(qty);
  const counted = Number.isFinite(n) && qty.trim() !== '' ? toBase(n, unit) : null;
  const delta = counted == null ? null : counted - material.currentQty;

  const save = async () => {
    if (counted == null || counted < 0) { setError('Enter what you actually counted'); return; }
    setBusy(true); setError(null);
    try {
      await crewStock.count(material.id, { countedQty: n, unit, note: note.trim() || null });
      onDone(`${material.name} counted`);
    } catch (e: any) {
      setError(e?.message ?? 'Could not save the count');
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title={`Count ${material.name}`} maxHeightRatio={0.7}>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text style={sheetStyles.hint}>How much is actually there?</Text>

        <FieldLabel>Counted</FieldLabel>
        <QtyRow value={qty} onChange={setQty} unit={unit} onUnit={setUnit} units={units} autoFocus />

        {delta != null && Math.abs(delta) > 0.0005 && (
          <View style={[st.diff, delta < 0 ? st.diffBad : st.diffGood]}>
            <Text style={[st.diffText, { color: delta < 0 ? C.danger : C.success }]}>
              {fmtQty(material.currentQty, material.unit)} → {fmtQty(counted!, material.unit)} · {delta < 0 ? '−' : '+'}{fmtQty(Math.abs(delta), material.unit)}
            </Text>
            <Text style={st.diffSub}>Recorded against your name</Text>
          </View>
        )}

        <FieldLabel>Note</FieldLabel>
        <TextInput
          style={sheetStyles.input} value={note} onChangeText={setNote}
          placeholder="Why it differs, if you know" placeholderTextColor={C.textMuted}
        />

        <ErrorLine text={error} />
        <PrimaryButton label="Save count" onPress={save} busy={busy} />
        <View style={{ height: Spacing.xl }} />
      </ScrollView>
    </BottomSheet>
  );
}

const st = StyleSheet.create({
  diff: { marginTop: Spacing.md, padding: Spacing.md, borderRadius: Radius.md, borderWidth: 1 },
  diffBad: { backgroundColor: C.dangerSoft, borderColor: C.dangerBorder },
  diffGood: { backgroundColor: C.successSoft, borderColor: C.successBorder },
  diffText: { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  diffSub: { color: C.textSecondary, fontSize: 12, marginTop: 3 },
});
