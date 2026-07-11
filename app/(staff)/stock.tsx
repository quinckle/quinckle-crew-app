import React, { useCallback, useState } from 'react';
import {
  StyleSheet, Text, View, TextInput, TouchableOpacity, ActivityIndicator, FlatList, Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { crewStock, type CrewStockItem } from '../../services/api';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';

export default function StockScreen() {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<CrewStockItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [active, setActive] = useState<{ item: CrewStockItem; mode: 'count' | 'waste' } | null>(null);
  const [val, setVal] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    crewStock.list(lowOnly, search || undefined)
      .then((r) => setItems(r.data.items))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [lowOnly, search]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2200); };

  const submit = async () => {
    if (!active) return;
    const n = parseFloat(val);
    if (!isFinite(n) || n < 0) { flash('Enter a valid number'); return; }
    if (active.mode === 'waste' && !reason.trim()) { flash('Add a reason'); return; }
    setBusy(true);
    try {
      if (active.mode === 'count') await crewStock.adjust(active.item.id, n);
      else await crewStock.wastage(active.item.id, n, reason.trim());
      setActive(null); setVal(''); setReason(''); flash('Updated'); load();
    } catch { flash('Failed'); } finally { setBusy(false); }
  };

  const filtered = items.filter((i) => !search || i.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.headerBar}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}><Ionicons name="chevron-back" size={22} color={QuinckleColors.textPrimary} /></TouchableOpacity>
        <Text style={styles.headerTitle}>Stock</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => setLowOnly((v) => !v)}><Ionicons name={lowOnly ? 'alert-circle' : 'alert-circle-outline'} size={22} color={lowOnly ? QuinckleColors.warning : QuinckleColors.textPrimary} /></TouchableOpacity>
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={16} color={QuinckleColors.textMuted} />
        <TextInput style={styles.searchInput} value={search} onChangeText={setSearch} placeholder="Search items" placeholderTextColor={QuinckleColors.textMuted} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={QuinckleColors.primary} /></View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: Spacing.lg, paddingBottom: insets.bottom + 40 }}
          ListEmptyComponent={<Text style={styles.empty}>No stock items{lowOnly ? ' are low' : ''}.</Text>}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={[styles.qty, { color: item.isOut ? QuinckleColors.danger : item.isLow ? QuinckleColors.warning : QuinckleColors.textSecondary }]}>
                  {item.currentQty} {item.unit}{item.isOut ? ' · OUT' : item.isLow ? ' · LOW' : ''}
                </Text>
              </View>
              <TouchableOpacity style={styles.smallBtn} onPress={() => { setActive({ item, mode: 'count' }); setVal(String(item.currentQty)); }}><Text style={styles.smallBtnText}>Count</Text></TouchableOpacity>
              <TouchableOpacity style={styles.smallBtn} onPress={() => { setActive({ item, mode: 'waste' }); setVal(''); setReason(''); }}><Text style={styles.smallBtnText}>Waste</Text></TouchableOpacity>
            </View>
          )}
        />
      )}

      <Modal visible={!!active} transparent animationType="fade" onRequestClose={() => setActive(null)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{active?.mode === 'count' ? 'Stock-take' : 'Wastage'} · {active?.item.name}</Text>
            {active?.mode === 'count' && <Text style={styles.hint}>System shows {active?.item.currentQty} {active?.item.unit}. Enter the counted quantity.</Text>}
            <Text style={styles.label}>{active?.mode === 'count' ? `Counted (${active?.item.unit})` : `Quantity wasted (${active?.item.unit})`}</Text>
            <TextInput style={styles.input} value={val} onChangeText={setVal} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={QuinckleColors.textMuted} autoFocus />
            {active?.mode === 'waste' && (<>
              <Text style={styles.label}>Reason</Text>
              <TextInput style={styles.input} value={reason} onChangeText={setReason} placeholder="e.g. spoiled, breakage" placeholderTextColor={QuinckleColors.textMuted} />
            </>)}
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.ghostBtn} onPress={() => setActive(null)}><Text style={styles.ghostBtnText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={styles.primaryBtn} onPress={submit} disabled={busy}>{busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Save</Text>}</TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {toast && <View style={[styles.toast, { bottom: insets.bottom + 30 }]}><Text style={styles.toastText}>{toast}</Text></View>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: QuinckleColors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: QuinckleColors.border },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: QuinckleColors.textPrimary, fontSize: 17, fontWeight: '700' },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, margin: Spacing.lg, marginBottom: 0, paddingHorizontal: Spacing.md, height: 42, backgroundColor: QuinckleColors.surfaceMutedHover, borderRadius: Radius.md, borderWidth: 1, borderColor: QuinckleColors.border },
  searchInput: { flex: 1, color: QuinckleColors.textPrimary, fontSize: 14 },
  empty: { color: QuinckleColors.textMuted, textAlign: 'center', marginTop: 40, fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: QuinckleColors.borderSubtle },
  name: { color: QuinckleColors.textPrimary, fontSize: 14.5, fontWeight: '600' },
  qty: { fontSize: 12.5, marginTop: 2, fontVariant: ['tabular-nums'] },
  smallBtn: { paddingHorizontal: Spacing.md, paddingVertical: 7, borderRadius: Radius.md, borderWidth: 1, borderColor: QuinckleColors.border, backgroundColor: QuinckleColors.surface },
  smallBtnText: { color: QuinckleColors.textPrimary, fontSize: 12.5, fontWeight: '600' },
  modalWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: Spacing.lg },
  modalCard: { backgroundColor: QuinckleColors.surfaceElevated, borderRadius: Radius.lg, borderWidth: 1, borderColor: QuinckleColors.border, padding: Spacing.lg },
  modalTitle: { color: QuinckleColors.textPrimary, fontSize: 15, fontWeight: '700', marginBottom: Spacing.sm },
  hint: { color: QuinckleColors.textSecondary, fontSize: 12.5, lineHeight: 18, marginBottom: Spacing.sm },
  label: { color: QuinckleColors.textSecondary, fontSize: 12, fontWeight: '600', marginTop: Spacing.sm, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { backgroundColor: QuinckleColors.surfaceMutedHover, borderRadius: Radius.md, borderWidth: 1, borderColor: QuinckleColors.border, color: QuinckleColors.textPrimary, paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, fontSize: 16 },
  modalActions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.lg, alignItems: 'center' },
  ghostBtn: { paddingVertical: Spacing.md, paddingHorizontal: Spacing.lg },
  ghostBtnText: { color: QuinckleColors.textSecondary, fontSize: 15, fontWeight: '600' },
  primaryBtn: { flex: 1, backgroundColor: QuinckleColors.primary, borderRadius: Radius.md, paddingVertical: Spacing.md, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  toast: { position: 'absolute', alignSelf: 'center', backgroundColor: QuinckleColors.surfaceElevated, borderWidth: 1, borderColor: QuinckleColors.border, borderRadius: 999, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  toastText: { color: QuinckleColors.textPrimary, fontSize: 13, fontWeight: '600' },
});
