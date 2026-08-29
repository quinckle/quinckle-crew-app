import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator, FlatList, Modal, RefreshControl, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { Stack, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { crewPayments, crewOrders, type OutstandingGroup } from '../../services/api';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';
import { ReasonChips } from '../../components/ui/ReasonSheet';
import { useManagerApproval } from '../../components/ui/ManagerPinSheet';
import { WAIVE_REASONS, isReasonComplete, toReasonPayload } from '../../constants/adjustmentReasons';
import { isOffPremise, channelLabel, locationLabel as channelLocationLabel } from '../../constants/channel';

function timeAgo(iso: string): string {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function OutstandingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [groups, setGroups] = useState<OutstandingGroup[]>([]);
  const [totalDue, setTotalDue] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [waiveTarget, setWaiveTarget] = useState<OutstandingGroup | null>(null);
  const [waiveReason, setWaiveReason] = useState('');
  const [waiveCode, setWaiveCode] = useState<string | null>(null);
  const [waiving, setWaiving] = useState(false);
  const { sheet: managerPinSheet, runWithApproval } = useManagerApproval();

  const load = useCallback(async () => {
    try {
      const res = await crewPayments.getOutstanding();
      setGroups(res.groups);
      setTotalDue(res.totalDue);
    } catch (e) {
      console.error('[outstanding] load failed', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const handleCollect = (g: OutstandingGroup) => {
    router.push({
      pathname: '/(staff)/payment-collect',
      params: {
        orderId: g.orderIds[0] ?? '',
        sessionId: g.sessionId,
        orderIds: JSON.stringify(g.orderIds),
        tableNumber: String(g.tableNumber ?? ''),
        ...(g.channel === 'TAKEAWAY' ? { channel: 'TAKEAWAY', pickupToken: g.pickupToken ?? '' } : {}),
        amount: String(g.amount ?? 0),
        customerName: g.customerName ?? '',
        customerPhone: g.customerPhone ?? '',
      },
    });
  };

  const submitWaive = async () => {
    if (!waiveTarget) return;
    // The coded reason reaches the adjustments ledger; the free text stays as
    // the note. The picker guarantees completeness, so the server's
    // INVALID_REASON / REASON_TEXT_REQUIRED can't be reached from here.
    if (!isReasonComplete(waiveCode, waiveReason)) return;
    const coded = toReasonPayload(waiveCode!, waiveReason);
    const reason = waiveReason.trim() || WAIVE_REASONS.find((r) => r.code === waiveCode)!.label;
    setWaiving(true);
    try {
      // One PIN entry, one grant per bill in the group.
      await runWithApproval({ action: 'COMP_ORDER', amount: waiveTarget.amount }, async (mint) => {
        for (const id of waiveTarget.orderIds) {
          try {
            const grantId = mint ? await mint(id, null) : undefined;
            await crewOrders.waive(id, reason, coded, grantId);
          } catch (e: any) {
            const code = String(e?.code ?? e?.error ?? e?.message ?? '');
            if (code === 'ADMIN_REQUIRED' || code === 'AUTHORIZATION_REQUIRED' || code.startsWith('GRANT_') || code === 'PIN_LOCKED_OUT') throw e;
          }
        }
        setWaiveTarget(null);
        setWaiveReason('');
        setWaiveCode(null);
        await load();
      });
    } catch {
      // surfaced on next load; keep it simple
    } finally {
      setWaiving(false);
    }
  };

  const renderItem = ({ item: g }: { item: OutstandingGroup }) => (
    <View style={s.card}>
      <View style={s.cardTop}>
        <View style={s.titleRow}>
          <Text style={s.table}>
            {channelLocationLabel(g.channel, { token: g.pickupToken ?? 'TK', tableNumber: g.tableNumber })}
          </Text>
          {g.sessionClosed && (
            <View style={s.freedBadge}><Text style={s.freedBadgeText}>FREED</Text></View>
          )}
        </View>
        <Text style={s.time}>{timeAgo(g.oldestAt)}</Text>
      </View>

      <Text style={s.amount}>₹{g.amount.toLocaleString('en-IN')}</Text>
      <Text style={s.meta}>
        {g.orderCount} order{g.orderCount === 1 ? '' : 's'}
        {g.customerPhone ? ` · ${g.customerPhone}` : ''}
      </Text>

      <View style={s.actions}>
        <TouchableOpacity style={s.collectBtn} onPress={() => handleCollect(g)} activeOpacity={0.85}>
          <Text style={s.collectBtnText}>Collect</Text>
        </TouchableOpacity>
        {/* Not admin-gated in the UI any more — a steward starts it, a manager
            approves with the PIN, and the server remains the real gate. */}
        <TouchableOpacity style={s.waiveBtn} onPress={() => { setWaiveTarget(g); setWaiveReason(''); setWaiveCode(null); }} activeOpacity={0.85}>
          <Text style={s.waiveBtnText}>Waive</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={24} color={QuinckleColors.textPrimary} />
        </TouchableOpacity>
        <View>
          <Text style={s.headerTitle}>Outstanding</Text>
          {groups.length > 0 && <Text style={s.headerSub}>₹{totalDue.toLocaleString('en-IN')} across {groups.length} table{groups.length === 1 ? '' : 's'}</Text>}
        </View>
        <TouchableOpacity onPress={() => { setRefreshing(true); void load(); }} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="refresh-outline" size={20} color={QuinckleColors.textSecondary} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={QuinckleColors.primary} /></View>
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(g) => g.sessionId}
          renderItem={renderItem}
          contentContainerStyle={{ padding: Spacing.lg, paddingBottom: insets.bottom + 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={QuinckleColors.primary} />}
          ListEmptyComponent={
            <View style={s.empty}>
              <Ionicons name="checkmark-done-circle-outline" size={42} color={QuinckleColors.textTertiary} style={{ opacity: 0.5 }} />
              <Text style={s.emptyText}>Nothing outstanding. Every table is settled.</Text>
            </View>
          }
        />
      )}

      {/* Waive (admin) */}
      <Modal visible={!!waiveTarget} transparent animationType="fade" onRequestClose={() => setWaiveTarget(null)}>
        <View style={s.backdrop}>
          <View style={s.modalCard}>
            <Text style={s.modalEyebrow}>
              Write off · {waiveTarget?.channel === 'TAKEAWAY'
                ? (waiveTarget?.pickupToken ?? 'Takeaway')
                : `Table T${waiveTarget?.tableNumber}`}
            </Text>
            <Text style={s.modalTitle}>Waive ₹{waiveTarget?.amount.toLocaleString('en-IN')}?</Text>
            <Text style={s.modalSub}>Records a write-off (no money collected). Reason required.</Text>
            <ReasonChips
              reasons={WAIVE_REASONS}
              prompt="Why is it being written off?"
              code={waiveCode}
              text={waiveReason}
              onPickCode={setWaiveCode}
              onChangeText={setWaiveReason}
              disabled={waiving}
            />
            <View style={s.modalFooter}>
              <TouchableOpacity style={s.cancelBtn} onPress={() => setWaiveTarget(null)} disabled={waiving}>
                <Text style={s.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.confirmBtn, (!isReasonComplete(waiveCode, waiveReason) || waiving) && { opacity: 0.4 }]}
                onPress={submitWaive}
                disabled={!isReasonComplete(waiveCode, waiveReason) || waiving}
              >
                {waiving ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.confirmBtnText}>Waive</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {managerPinSheet}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: QuinckleColors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.lg, height: 52 },
  headerTitle: { color: QuinckleColors.textPrimary, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  headerSub: { color: QuinckleColors.textTertiary, fontSize: 11, textAlign: 'center', marginTop: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: {
    backgroundColor: QuinckleColors.surface, borderRadius: 18, padding: Spacing.lg, marginBottom: Spacing.sm,
    borderWidth: 1, borderColor: QuinckleColors.border,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  table: { color: QuinckleColors.textPrimary, fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  freedBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, backgroundColor: 'rgba(248,113,113,0.16)', borderWidth: 1, borderColor: 'rgba(248,113,113,0.32)' },
  freedBadgeText: { color: '#fca5a5', fontSize: 9, fontWeight: '700', letterSpacing: 0.6 },
  time: { color: QuinckleColors.textTertiary, fontSize: 11 },
  amount: { color: QuinckleColors.textPrimary, fontSize: 26, fontWeight: '700', letterSpacing: -0.8, marginTop: 8 },
  meta: { color: QuinckleColors.textTertiary, fontSize: 12, marginTop: 2 },
  actions: { flexDirection: 'row', gap: Spacing.sm, marginTop: 14 },
  collectBtn: { flex: 1, backgroundColor: QuinckleColors.primary, paddingVertical: 12, borderRadius: Radius.md, alignItems: 'center' },
  collectBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  waiveBtn: { paddingVertical: 12, paddingHorizontal: 18, borderRadius: Radius.md, alignItems: 'center', borderWidth: 1, borderColor: QuinckleColors.border },
  waiveBtnText: { color: QuinckleColors.textSecondary, fontSize: 14, fontWeight: '600' },
  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: 80, gap: 12 },
  emptyText: { color: QuinckleColors.textTertiary, fontSize: 13, textAlign: 'center', paddingHorizontal: 40 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  modalCard: { width: '100%', backgroundColor: QuinckleColors.surface, borderRadius: 20, padding: Spacing.xl, borderWidth: 1, borderColor: QuinckleColors.border },
  modalEyebrow: { color: QuinckleColors.textTertiary, fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  modalTitle: { color: QuinckleColors.textPrimary, fontSize: 20, fontWeight: '700', marginTop: 4 },
  modalSub: { color: QuinckleColors.textSecondary, fontSize: 13, marginTop: 6 },
  inputWrap: { marginTop: 14, borderWidth: 1, borderColor: QuinckleColors.border, borderRadius: Radius.md, backgroundColor: QuinckleColors.background },
  input: { color: QuinckleColors.textPrimary, fontSize: 15, paddingHorizontal: 14, paddingVertical: 12 },
  modalFooter: { flexDirection: 'row', gap: Spacing.sm, marginTop: 16 },
  cancelBtn: { flex: 1, paddingVertical: 13, borderRadius: Radius.md, alignItems: 'center', borderWidth: 1, borderColor: QuinckleColors.border },
  cancelBtnText: { color: QuinckleColors.textSecondary, fontSize: 14, fontWeight: '600' },
  confirmBtn: { flex: 1, paddingVertical: 13, borderRadius: Radius.md, alignItems: 'center', backgroundColor: QuinckleColors.primary },
  confirmBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
