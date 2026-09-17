/**
 * Restock — the form that matters (CREW_STOCK_PLAN.md §3).
 *
 * Quantity + what was paid + who supplied it + the bill, and by default it also
 * books the purchase into Expenses so the money lands in P&L without anyone
 * remembering to do it.
 *
 * Bill photos upload one at a time BEFORE the restock is saved: a failed photo
 * must never cost the restock, and the restock must never be saved twice
 * because an upload timed out.
 */

import React, { useEffect, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { BottomSheet } from '../ui/BottomSheet';
import { QuinckleColors as C, Radius, Spacing } from '../../constants/Colors';
import { entryUnitsFor, defaultEntryUnit, inr, type StockEntryUnit } from '../../constants/stock';
import { crewStock, type CrewMaterial } from '../../services/api';
import { ErrorLine, FieldLabel, PrimaryButton, QtyRow, sheetStyles } from './pieces';

const MAX_BILLS = 3;

export function RestockSheet({ material, visible, onClose, onDone }: {
  material: CrewMaterial;
  visible: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const units = entryUnitsFor(material.unit);
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState<StockEntryUnit>(defaultEntryUnit(material.unit));
  const [paid, setPaid] = useState('');
  const [vendor, setVendor] = useState('');
  const [vendors, setVendors] = useState<{ id: string; name: string }[]>([]);
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [bills, setBills] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [recordExpense, setRecordExpense] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setQty(''); setUnit(defaultEntryUnit(material.unit)); setPaid('');
    setVendor(''); setVendorId(null); setNote(''); setBills([]); setRecordExpense(true); setError(null);
    crewStock.vendors().then((r) => setVendors(r.data ?? [])).catch(() => {});
  }, [visible, material.unit]);

  // Typing a vendor name unpicks the chosen one — the typed name wins, and the
  // server finds-or-creates it.
  const onVendorText = (t: string) => { setVendor(t); setVendorId(null); };

  const addBill = async (fromCamera: boolean) => {
    setError(null);
    try {
      const perm = fromCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== 'granted') {
        setError(fromCamera ? 'Camera access is off for Quinckle' : 'Photo access is off for Quinckle');
        return;
      }
      const res = fromCamera
        ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 });
      if (res.canceled || !res.assets?.[0]?.uri) return;
      setUploading(true);
      // Compress before upload: the server caps the body at 5 MB and a modern
      // phone camera clears that on its own. 1400px keeps a bill readable.
      const shrunk = await ImageManipulator.manipulateAsync(
        res.assets[0].uri,
        [{ resize: { width: 1400 } }],
        { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      if (!shrunk.base64) throw new Error('Could not read that photo');
      const up = await crewStock.uploadBill(shrunk.base64);
      setBills((b) => [...b, up.data.url]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That photo could not be uploaded');
    } finally {
      setUploading(false);
    }
  };

  const qtyNum = Number(qty);
  const paidNum = paid.trim() === '' ? null : Number(paid);
  const perUnit = paidNum != null && Number.isFinite(paidNum) && qtyNum > 0 ? paidNum / qtyNum : null;

  const save = async () => {
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) { setError('Enter how much came in'); return; }
    if (paid.trim() !== '' && (!Number.isFinite(paidNum!) || paidNum! < 0)) { setError('Enter a valid amount'); return; }
    if (recordExpense && !(paidNum && paidNum > 0)) { setError('Add the amount paid, or turn off the expense'); return; }
    setBusy(true); setError(null);
    try {
      await crewStock.restock(material.id, {
        qty: qtyNum, unit,
        totalPaid: paidNum,
        vendorId,
        vendorName: vendorId ? null : (vendor.trim() || null),
        billUrls: bills,
        note: note.trim() || null,
        recordExpense,
      });
      onDone(`${material.name} restocked`);
    } catch (e: any) {
      setError(e?.message ?? 'Could not save the restock');
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title={`Restock ${material.name}`}>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <FieldLabel>How much came in</FieldLabel>
        <QtyRow value={qty} onChange={setQty} unit={unit} onUnit={setUnit} units={units} autoFocus />

        <FieldLabel>Total paid</FieldLabel>
        <TextInput
          style={sheetStyles.input} value={paid} onChangeText={setPaid} keyboardType="decimal-pad"
          placeholder="₹ 0" placeholderTextColor={C.textMuted}
        />
        {perUnit != null && (
          <Text style={[sheetStyles.hint, { marginTop: 6 }]}>
            That works out to {inr(perUnit)} per {unit.toLowerCase() === 'pcs' ? 'pc' : unit.toLowerCase()}
          </Text>
        )}

        <FieldLabel>Vendor</FieldLabel>
        <TextInput
          style={sheetStyles.input} value={vendor} onChangeText={onVendorText}
          placeholder="Who supplied it" placeholderTextColor={C.textMuted}
        />
        {vendor.trim().length > 0 && (
          <View style={st.vendorList}>
            {vendors
              .filter((v) => v.name.toLowerCase().includes(vendor.trim().toLowerCase()) && v.name.toLowerCase() !== vendor.trim().toLowerCase())
              .slice(0, 4)
              .map((v) => (
                <TouchableOpacity key={v.id} style={st.vendorChip} onPress={() => { setVendor(v.name); setVendorId(v.id); }} activeOpacity={0.8}>
                  <Text style={st.vendorChipText}>{v.name}</Text>
                </TouchableOpacity>
              ))}
          </View>
        )}

        <FieldLabel>Bill photo</FieldLabel>
        <View style={st.billRow}>
          {bills.map((url) => (
            <View key={url} style={st.billThumbWrap}>
              <Image source={{ uri: url }} style={st.billThumb} />
              <TouchableOpacity style={st.billRemove} onPress={() => setBills((b) => b.filter((x) => x !== url))} activeOpacity={0.8}>
                <Ionicons name="close" size={12} color="#fff" />
              </TouchableOpacity>
            </View>
          ))}
          {bills.length < MAX_BILLS && (
            <>
              <TouchableOpacity style={st.billAdd} onPress={() => addBill(true)} disabled={uploading} activeOpacity={0.8}>
                <Ionicons name="camera-outline" size={20} color={uploading ? C.textMuted : C.textSecondary} />
              </TouchableOpacity>
              <TouchableOpacity style={st.billAdd} onPress={() => addBill(false)} disabled={uploading} activeOpacity={0.8}>
                <Ionicons name="image-outline" size={20} color={uploading ? C.textMuted : C.textSecondary} />
              </TouchableOpacity>
            </>
          )}
          {uploading && <Text style={[sheetStyles.hint, { alignSelf: 'center' }]}>Uploading…</Text>}
        </View>

        <FieldLabel>Note</FieldLabel>
        <TextInput
          style={sheetStyles.input} value={note} onChangeText={setNote}
          placeholder="Anything worth remembering" placeholderTextColor={C.textMuted}
        />

        <TouchableOpacity style={st.toggleRow} onPress={() => setRecordExpense((v) => !v)} activeOpacity={0.8}>
          <View style={{ flex: 1 }}>
            <Text style={st.toggleLabel}>Also record in expenses</Text>
            <Text style={sheetStyles.hint}>Books it to the owner&apos;s P&amp;L under Raw materials</Text>
          </View>
          <View style={[st.switch, recordExpense && st.switchOn]}>
            <View style={[st.knob, recordExpense && st.knobOn]} />
          </View>
        </TouchableOpacity>

        <ErrorLine text={error} />
        <PrimaryButton label="Save restock" onPress={save} busy={busy} disabled={uploading} />
        <View style={{ height: Spacing.xl }} />
      </ScrollView>
    </BottomSheet>
  );
}

const st = StyleSheet.create({
  vendorList: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginTop: Spacing.sm },
  vendorChip: { paddingHorizontal: Spacing.md, paddingVertical: 7, borderRadius: Radius.pill, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface },
  vendorChipText: { color: C.textSecondary, fontSize: 12.5, fontWeight: '600' },
  billRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
  billAdd: {
    width: 52, height: 52, borderRadius: Radius.md, borderWidth: 1, borderColor: C.borderStrong,
    borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center',
  },
  billThumbWrap: { width: 52, height: 52 },
  billThumb: { width: 52, height: 52, borderRadius: Radius.md, borderWidth: 1, borderColor: C.border },
  billRemove: {
    position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10,
    backgroundColor: C.danger, alignItems: 'center', justifyContent: 'center',
  },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginTop: Spacing.lg },
  toggleLabel: { color: C.textPrimary, fontSize: 14.5, fontWeight: '600', marginBottom: 2 },
  switch: { width: 44, height: 26, borderRadius: 13, backgroundColor: C.surfaceMutedHover, borderWidth: 1, borderColor: C.border, padding: 2 },
  switchOn: { backgroundColor: C.primary, borderColor: C.primary },
  knob: { width: 20, height: 20, borderRadius: 10, backgroundColor: C.textMuted },
  knobOn: { backgroundColor: '#fff', alignSelf: 'flex-end' },
});
