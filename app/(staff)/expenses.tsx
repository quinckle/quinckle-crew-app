import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  ActivityIndicator,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { QuinckleColors, Spacing, Radius, Typography } from '../../constants/Colors';
import {
  crewExpenses,
  type CrewExpenseCategory,
  type CrewExpenseItem,
  type CrewExpensePaymentMethod,
} from '../../services/api';

const C = QuinckleColors;

const PAYMENT_METHODS: { value: CrewExpensePaymentMethod; label: string }[] = [
  { value: 'CASH', label: 'Cash' },
  { value: 'UPI', label: 'UPI' },
  { value: 'BANK_TRANSFER', label: 'Bank' },
  { value: 'CARD', label: 'Card' },
  { value: 'OTHER', label: 'Other' },
];

const inr = (n: number) => '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });

function todayIst(): string {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}

export default function ExpensesScreen() {
  const [items, setItems] = useState<CrewExpenseItem[]>([]);
  const [total, setTotal] = useState(0);
  const [rangeLabel, setRangeLabel] = useState('');
  const [categories, setCategories] = useState<CrewExpenseCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<CrewExpensePaymentMethod>('CASH');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [recent, cats] = await Promise.all([crewExpenses.recent(), crewExpenses.categories()]);
      if (recent?.success && recent.data) {
        setItems(recent.data.items);
        setTotal(recent.data.totalAmount);
        setRangeLabel(recent.data.range?.label ?? '');
      }
      if (cats?.success && cats.data) {
        setCategories(cats.data);
        if (!categoryId && cats.data[0]) setCategoryId(cats.data[0].id);
      }
    } catch {
      // surfaced via empty state
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [categoryId]);

  useEffect(() => { load(); }, [load]);

  const openModal = () => {
    setAmount('');
    setNote('');
    setPaymentMethod('CASH');
    setError(null);
    if (categories[0]) setCategoryId(categories[0].id);
    setModalOpen(true);
  };

  const submit = async () => {
    const amt = parseFloat(amount);
    if (!categoryId) return setError('Pick a category');
    if (!isFinite(amt) || amt <= 0) return setError('Enter a valid amount');
    setSaving(true);
    setError(null);
    try {
      const res = await crewExpenses.create({
        categoryId,
        amount: amt,
        expenseDate: todayIst(),
        paymentMethod,
        note: note.trim() || null,
      });
      if (res?.success) {
        setModalOpen(false);
        setLoading(true);
        load();
      } else {
        setError(res?.error || 'Could not save expense');
      }
    } catch {
      setError('Network error — please try again');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.6}>
          <Ionicons name="chevron-back" size={22} color={C.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Expenses</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: Spacing.lg, paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.textSecondary} />}
      >
        {/* Total card */}
        <View style={styles.totalCard}>
          <Text style={styles.totalLabel}>SPENT · {rangeLabel.toUpperCase() || 'LAST 7 DAYS'}</Text>
          <Text style={styles.totalValue}>{inr(total)}</Text>
          <Text style={styles.totalSub}>{items.length} expense{items.length === 1 ? '' : 's'} logged here</Text>
        </View>

        {loading ? (
          <ActivityIndicator color={C.textSecondary} style={{ marginTop: 40 }} />
        ) : items.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="receipt-outline" size={28} color={C.textTertiary} />
            <Text style={styles.emptyTitle}>No expenses yet</Text>
            <Text style={styles.emptySub}>Log petty cash and supplier payments from the floor.</Text>
          </View>
        ) : (
          items.map((e) => (
            <View key={e.id} style={styles.row}>
              <View style={[styles.dot, { backgroundColor: e.category?.color ?? '#6B7280' }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{e.category?.name ?? '—'}</Text>
                <Text style={styles.rowSub}>
                  {new Date(e.expenseDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  {e.vendor ? ` · ${e.vendor.name}` : ''}
                  {e.note ? ` · ${e.note}` : ''}
                </Text>
              </View>
              <Text style={styles.rowAmount}>{inr(e.amount)}</Text>
            </View>
          ))
        )}
      </ScrollView>

      {/* Add button */}
      <TouchableOpacity style={styles.fab} onPress={openModal} activeOpacity={0.85}>
        <Ionicons name="add" size={22} color="#fff" />
        <Text style={styles.fabText}>Add expense</Text>
      </TouchableOpacity>

      {/* Add modal */}
      <Modal visible={modalOpen} animationType="slide" transparent onRequestClose={() => setModalOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalWrap}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add expense</Text>
              <TouchableOpacity onPress={() => setModalOpen(false)}>
                <Ionicons name="close" size={22} color={C.textSecondary} />
              </TouchableOpacity>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={styles.fieldLabel}>Amount (₹)</Text>
              <TextInput
                value={amount}
                onChangeText={setAmount}
                placeholder="0.00"
                placeholderTextColor={C.textMuted}
                keyboardType="decimal-pad"
                style={styles.input}
                autoFocus
              />

              <Text style={styles.fieldLabel}>Category</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: Spacing.md }}>
                {categories.map((c) => {
                  const active = c.id === categoryId;
                  return (
                    <TouchableOpacity
                      key={c.id}
                      onPress={() => setCategoryId(c.id)}
                      style={[styles.chip, active && styles.chipActive]}
                      activeOpacity={0.7}
                    >
                      <View style={[styles.chipDot, { backgroundColor: c.color }]} />
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>{c.name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <Text style={styles.fieldLabel}>Paid via</Text>
              <View style={styles.methodRow}>
                {PAYMENT_METHODS.map((m) => {
                  const active = m.value === paymentMethod;
                  return (
                    <TouchableOpacity
                      key={m.value}
                      onPress={() => setPaymentMethod(m.value)}
                      style={[styles.chip, active && styles.chipActive]}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>{m.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.fieldLabel}>Note (optional)</Text>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="e.g. vegetables"
                placeholderTextColor={C.textMuted}
                style={styles.input}
              />

              {error && <Text style={styles.error}>{error}</Text>}
            </ScrollView>

            <TouchableOpacity style={[styles.submitBtn, saving && { opacity: 0.6 }]} onPress={submit} disabled={saving} activeOpacity={0.85}>
              {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitText}>Save expense</Text>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border,
  },
  backBtn: { width: 36, height: 36, justifyContent: 'center' },
  headerTitle: { ...Typography.subtitle, color: C.textPrimary },
  totalCard: {
    backgroundColor: C.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: C.border,
    padding: Spacing.xl, marginBottom: Spacing.lg,
  },
  totalLabel: { ...Typography.label, color: C.textTertiary },
  totalValue: { fontSize: 30, fontWeight: '800', color: C.textPrimary, marginTop: 4, letterSpacing: -0.5 },
  totalSub: { ...Typography.caption, color: C.textSecondary, marginTop: 2 },
  empty: { alignItems: 'center', paddingVertical: 48 },
  emptyTitle: { ...Typography.bodyStrong, color: C.textPrimary, marginTop: Spacing.md },
  emptySub: { ...Typography.caption, color: C.textSecondary, marginTop: 4, textAlign: 'center', maxWidth: 260 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: C.surface, borderRadius: Radius.md, borderWidth: 1, borderColor: C.borderSubtle,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, marginBottom: Spacing.sm,
  },
  dot: { width: 4, height: 32, borderRadius: 2 },
  rowTitle: { ...Typography.bodyStrong, color: C.textPrimary },
  rowSub: { ...Typography.micro, color: C.textSecondary, marginTop: 2 },
  rowAmount: { fontSize: 15, fontWeight: '700', color: C.textPrimary },
  fab: {
    position: 'absolute', left: Spacing.lg, right: Spacing.lg, bottom: Spacing.xl,
    backgroundColor: C.primary, borderRadius: Radius.lg, height: 52,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
  },
  fabText: { ...Typography.bodyStrong, color: '#fff' },
  modalWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  modalCard: {
    backgroundColor: C.surfaceElevated, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl,
    padding: Spacing.xl, maxHeight: '88%',
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.lg },
  modalTitle: { ...Typography.title, color: C.textPrimary },
  fieldLabel: { ...Typography.label, color: C.textTertiary, marginBottom: Spacing.sm, marginTop: Spacing.sm },
  input: {
    backgroundColor: C.surfaceMuted, borderRadius: Radius.md, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, color: C.textPrimary, fontSize: 15,
    marginBottom: Spacing.sm,
  },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.surfaceMuted, borderRadius: Radius.pill, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, marginRight: Spacing.sm, marginBottom: Spacing.sm,
  },
  chipActive: { backgroundColor: C.primarySoft, borderColor: C.primarySoftBorder },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  chipText: { ...Typography.caption, color: C.textSecondary },
  chipTextActive: { color: C.primary, fontWeight: '700' },
  methodRow: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: Spacing.sm },
  error: { ...Typography.caption, color: C.danger, marginTop: Spacing.sm },
  submitBtn: {
    backgroundColor: C.primary, borderRadius: Radius.lg, height: 52,
    alignItems: 'center', justifyContent: 'center', marginTop: Spacing.lg,
  },
  submitText: { ...Typography.bodyStrong, color: '#fff' },
});
