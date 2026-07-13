/**
 * Dues (Khata) — customer pay-later balances.
 *
 * Lists open dues grouped by customer phone (backend /crew/dues/parties),
 * expands to the individual dues, and settles them (full or partial, cash/UPI)
 * via /crew/dues/:id/settle. Settlements are replay-safe: the idempotency key
 * is minted once per opened settle sheet, so a retry of the same confirmation
 * can't double-collect.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { crewDues, type CrewDue, type CrewDueParty } from '../../services/api';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';

const fmt = (n: number) => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const fmtDate = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

export default function DuesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [parties, setParties] = useState<CrewDueParty[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedPhone, setExpandedPhone] = useState<string | null>(null);
  const [duesByPhone, setDuesByPhone] = useState<Record<string, CrewDue[]>>({});
  const [loadingDues, setLoadingDues] = useState<string | null>(null);

  // Settle sheet state
  const [settleDue, setSettleDue] = useState<CrewDue | null>(null);
  const [settleAmount, setSettleAmount] = useState('');
  const [settleMethod, setSettleMethod] = useState<'CASH' | 'UPI'>('CASH');
  const [settleKey, setSettleKey] = useState('');
  const [settling, setSettling] = useState(false);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const res = await crewDues.parties();
      setParties(res.data ?? []);
      // Refresh any expanded party's dues too so balances stay honest.
      if (expandedPhone) {
        const list = await crewDues.list(expandedPhone);
        setDuesByPhone(prev => ({ ...prev, [expandedPhone]: list.data?.items ?? [] }));
      }
    } catch {
      // Non-fatal: pull-to-refresh retries.
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [expandedPhone]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const toggleParty = async (party: CrewDueParty) => {
    const phone = party.phone;
    if (!phone) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (expandedPhone === phone) { setExpandedPhone(null); return; }
    setExpandedPhone(phone);
    if (!duesByPhone[phone]) {
      setLoadingDues(phone);
      try {
        const list = await crewDues.list(phone);
        setDuesByPhone(prev => ({ ...prev, [phone]: list.data?.items ?? [] }));
      } catch {
        setExpandedPhone(null);
      } finally {
        setLoadingDues(null);
      }
    }
  };

  const openSettle = (due: CrewDue) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSettleDue(due);
    setSettleAmount(String(Math.round(due.balance)));
    setSettleMethod('CASH');
    // One key per opened sheet — retries of the same confirm are replays.
    setSettleKey(`crew-due-settle:${due.id}:${Date.now()}`);
  };

  const settleNum = Number(settleAmount || 0);
  const settleValid = !!settleDue && settleNum > 0 && settleNum <= Math.ceil(settleDue.balance);

  const confirmSettle = async () => {
    if (!settleDue || !settleValid || settling) return;
    setSettling(true);
    try {
      const amount = Math.min(settleNum, settleDue.balance);
      await crewDues.settle(settleDue.id, amount, settleMethod, settleKey);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSettleDue(null);
      // Drop the cached list so re-expanding refetches fresh balances.
      if (settleDue.customerPhone) {
        setDuesByPhone(prev => {
          const next = { ...prev };
          delete next[settleDue.customerPhone!];
          return next;
        });
      }
      await load(true);
    } catch (err: any) {
      const code = String(err?.code ?? err?.message ?? '');
      if (code.includes('OVER_SETTLE')) {
        Alert.alert('Too much', 'Amount is more than the outstanding balance.');
      } else if (code.includes('DUE_NOT_OPEN')) {
        Alert.alert('Already settled', 'This due has already been settled or written off.');
        setSettleDue(null);
        await load(true);
      } else {
        Alert.alert('Could not record collection', err?.message ?? 'Please try again.');
      }
    } finally {
      setSettling(false);
    }
  };

  const totalOutstanding = useMemo(
    () => parties.reduce((s, p) => s + Number(p.outstanding || 0), 0),
    [parties],
  );

  return (
    <View style={s.root}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.6} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={24} color={QuinckleColors.textPrimary} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Dues (Khata)</Text>
        <View style={{ width: 44 }} />
      </View>

      {/* Summary */}
      <View style={s.summary}>
        <Text style={s.summaryLabel}>Outstanding from customers</Text>
        <Text style={s.summaryAmount}>{fmt(totalOutstanding)}</Text>
        <Text style={s.summarySub}>{parties.length} customer{parties.length === 1 ? '' : 's'} owe{parties.length === 1 ? 's' : ''} money</Text>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: Spacing.lg, paddingBottom: insets.bottom + 32, gap: Spacing.md }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={QuinckleColors.textTertiary} />}
      >
        {loading && !refreshing ? (
          <ActivityIndicator style={{ marginTop: 48 }} color={QuinckleColors.textTertiary} />
        ) : parties.length === 0 ? (
          <View style={s.empty}>
            <Ionicons name="book-outline" size={36} color={QuinckleColors.textTertiary} />
            <Text style={s.emptyTitle}>Khata is clear</Text>
            <Text style={s.emptySub}>When a bill is marked &quot;pay later&quot; at collection, it shows up here.</Text>
          </View>
        ) : (
          parties.map(party => {
            const expanded = expandedPhone === party.phone;
            const dues = party.phone ? duesByPhone[party.phone] ?? [] : [];
            return (
              <View key={party.key} style={s.card}>
                <TouchableOpacity style={s.cardHead} onPress={() => void toggleParty(party)} activeOpacity={0.7}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.cardName}>{party.customerName ?? 'Customer'}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      {party.phone && (
                        <TouchableOpacity onPress={() => Linking.openURL(`tel:${party.phone}`).catch(() => {})} activeOpacity={0.6}>
                          <Text style={s.cardPhone}>{party.phone}</Text>
                        </TouchableOpacity>
                      )}
                      <Text style={s.cardMeta}>
                        {party.dueCount} due{party.dueCount === 1 ? '' : 's'} · since {fmtDate(party.oldestAt)}
                      </Text>
                    </View>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 2 }}>
                    <Text style={s.cardAmount}>{fmt(party.outstanding)}</Text>
                    <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={QuinckleColors.textTertiary} />
                  </View>
                </TouchableOpacity>

                {expanded && (
                  <View style={s.cardBody}>
                    {loadingDues === party.phone ? (
                      <ActivityIndicator style={{ paddingVertical: 16 }} color={QuinckleColors.textTertiary} size="small" />
                    ) : (
                      dues.map(due => (
                        <View key={due.id} style={s.dueRow}>
                          <View style={{ flex: 1 }}>
                            <Text style={s.dueRowAmount}>{fmt(due.balance)}</Text>
                            <Text style={s.dueRowMeta}>
                              of {fmt(due.originalAmount)} · {fmtDate(due.createdAt)}
                              {due.settledAmount > 0 ? ` · ${fmt(due.settledAmount)} paid` : ''}
                            </Text>
                          </View>
                          <TouchableOpacity style={s.collectBtn} onPress={() => openSettle(due)} activeOpacity={0.8}>
                            <Text style={s.collectBtnText}>Collect</Text>
                          </TouchableOpacity>
                        </View>
                      ))
                    )}
                  </View>
                )}
              </View>
            );
          })
        )}
      </ScrollView>

      {/* ── Settle sheet ── */}
      <Modal visible={!!settleDue} animationType="slide" transparent onRequestClose={() => setSettleDue(null)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Pressable style={s.backdrop} onPress={() => !settling && setSettleDue(null)}>
            <Pressable style={s.sheet} onPress={() => {}}>
              <View style={s.handleWrap}><View style={s.handle} /></View>
              <Text style={s.sheetTitle}>Collect due</Text>
              <Text style={s.sheetSub}>
                {settleDue?.customerName ?? 'Customer'}{settleDue?.customerPhone ? ` · ${settleDue.customerPhone}` : ''} — owes {fmt(settleDue?.balance ?? 0)}
              </Text>

              <View style={s.sheetField}>
                <Text style={s.sheetCurrency}>₹</Text>
                <TextInput
                  value={settleAmount}
                  onChangeText={raw => setSettleAmount(raw.replace(/[^\d]/g, '').slice(0, 7))}
                  keyboardType="number-pad"
                  placeholder="0"
                  placeholderTextColor={QuinckleColors.textTertiary}
                  style={s.sheetInput}
                  autoFocus
                />
                <TouchableOpacity onPress={() => settleDue && setSettleAmount(String(Math.round(settleDue.balance)))} activeOpacity={0.7} style={s.fullChip}>
                  <Text style={s.fullChipText}>Full</Text>
                </TouchableOpacity>
              </View>
              {settleDue && settleNum > Math.ceil(settleDue.balance) && (
                <Text style={s.overText}>More than the outstanding {fmt(settleDue.balance)}</Text>
              )}

              <View style={s.methodRow}>
                {(['CASH', 'UPI'] as const).map(m => (
                  <TouchableOpacity
                    key={m}
                    style={[s.methodChip, settleMethod === m && s.methodChipActive]}
                    onPress={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSettleMethod(m); }}
                    activeOpacity={0.8}
                  >
                    <Ionicons name={m === 'CASH' ? 'cash-outline' : 'qr-code-outline'} size={15} color={settleMethod === m ? QuinckleColors.primary : QuinckleColors.textSecondary} />
                    <Text style={[s.methodChipText, settleMethod === m && s.methodChipTextActive]}>{m === 'CASH' ? 'Cash' : 'UPI'}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TouchableOpacity
                style={[s.confirmBtn, (!settleValid || settling) && { opacity: 0.4 }]}
                onPress={() => void confirmSettle()}
                disabled={!settleValid || settling}
                activeOpacity={0.8}
              >
                {settling
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={s.confirmBtnText}>Collect {fmt(Math.min(settleNum, settleDue?.balance ?? settleNum))}</Text>}
              </TouchableOpacity>
              <View style={{ height: insets.bottom + Spacing.lg }} />
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: QuinckleColors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
  },
  backBtn: { width: 44, height: 40, alignItems: 'flex-start', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', color: QuinckleColors.textPrimary, fontSize: 17, fontWeight: '700' },

  summary: {
    marginHorizontal: Spacing.lg,
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    backgroundColor: QuinckleColors.warningSoft,
    borderWidth: 1,
    borderColor: QuinckleColors.warningBorder,
  },
  summaryLabel: { color: QuinckleColors.warning, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  summaryAmount: { color: QuinckleColors.textPrimary, fontSize: 30, fontWeight: '800', letterSpacing: -0.8, marginTop: 4 },
  summarySub: { color: QuinckleColors.textTertiary, fontSize: 12, marginTop: 2 },

  empty: { alignItems: 'center', paddingTop: 64, gap: 8, paddingHorizontal: 32 },
  emptyTitle: { color: QuinckleColors.textPrimary, fontSize: 16, fontWeight: '700' },
  emptySub: { color: QuinckleColors.textTertiary, fontSize: 13, textAlign: 'center', lineHeight: 19 },

  card: {
    borderRadius: Radius.lg,
    backgroundColor: QuinckleColors.surface,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    overflow: 'hidden',
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', padding: Spacing.lg, gap: Spacing.md },
  cardName: { color: QuinckleColors.textPrimary, fontSize: 15, fontWeight: '700' },
  cardPhone: { color: QuinckleColors.info, fontSize: 12, fontWeight: '600', marginTop: 3 },
  cardMeta: { color: QuinckleColors.textTertiary, fontSize: 11, marginTop: 3 },
  cardAmount: { color: QuinckleColors.warning, fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },

  cardBody: { borderTopWidth: 1, borderTopColor: QuinckleColors.border, paddingHorizontal: Spacing.lg },
  dueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: QuinckleColors.border,
  },
  dueRowAmount: { color: QuinckleColors.textPrimary, fontSize: 15, fontWeight: '700' },
  dueRowMeta: { color: QuinckleColors.textTertiary, fontSize: 11, marginTop: 2 },
  collectBtn: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: 8,
    borderRadius: Radius.pill,
    backgroundColor: QuinckleColors.primary,
  },
  collectBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  // Settle sheet
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: QuinckleColors.background,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
  },
  handleWrap: { alignItems: 'center', paddingVertical: Spacing.md },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: QuinckleColors.borderStrong },
  sheetTitle: { color: QuinckleColors.textPrimary, fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  sheetSub: { color: QuinckleColors.textSecondary, fontSize: 12, marginTop: 4, marginBottom: Spacing.lg },
  sheetField: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    borderWidth: 1.5,
    borderColor: QuinckleColors.border,
    backgroundColor: QuinckleColors.surface,
    height: 60,
  },
  sheetCurrency: { color: QuinckleColors.textSecondary, fontSize: 20, fontWeight: '500', marginRight: 4 },
  sheetInput: { flex: 1, color: QuinckleColors.textPrimary, fontSize: 22, fontWeight: '700', padding: 0, letterSpacing: -0.4 },
  fullChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    backgroundColor: QuinckleColors.surfaceMuted,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
  },
  fullChipText: { color: QuinckleColors.textSecondary, fontSize: 11, fontWeight: '700' },
  overText: { color: QuinckleColors.danger, fontSize: 12, marginTop: 6 },
  methodRow: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.lg },
  methodChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 48,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    backgroundColor: QuinckleColors.surfaceMuted,
  },
  methodChipActive: { borderColor: QuinckleColors.primarySoftBorder, backgroundColor: QuinckleColors.primarySoft },
  methodChipText: { color: QuinckleColors.textSecondary, fontSize: 13, fontWeight: '600' },
  methodChipTextActive: { color: QuinckleColors.primary },
  confirmBtn: {
    marginTop: Spacing.lg,
    height: 52,
    borderRadius: Radius.lg,
    backgroundColor: QuinckleColors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
