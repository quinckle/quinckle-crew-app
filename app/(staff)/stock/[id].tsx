/**
 * One material — level, what it feeds, and everything that moved it
 * (CREW_STOCK_PLAN.md §3).
 *
 * A pushed screen rather than a modal: it has its own history worth coming back
 * to, and the three actions open as sheets ON it, so every save lands back on
 * the page that proves it worked.
 *
 * The history names WHO. That attribution is the control that lets restock,
 * count and wastage all sit behind one shared STOCK capability (§2 C1).
 */

import React, { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { crewStock, type CrewMaterialDetail } from '../../../services/api';
import { QuinckleColors as C, Radius, Spacing } from '../../../constants/Colors';
import { fmtQty, inr, istDate, prettyReason } from '../../../constants/stock';
import { LevelBadge } from '../../../components/stock/pieces';
import { RestockSheet } from '../../../components/stock/RestockSheet';
import { CountSheet } from '../../../components/stock/CountSheet';
import { RecordWastageSheet } from '../../../components/stock/RecordWastageSheet';

/** Movements the kitchen caused vs ones the system did on its own. */
const MANUAL_TYPES = new Set(['PURCHASE', 'WASTAGE', 'CORRECTION', 'OPENING']);

export default function MaterialDetailScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<CrewMaterialDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [sheet, setSheet] = useState<'restock' | 'count' | 'wastage' | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!id) return;
    crewStock.material(id)
      .then((r) => { setData(r.data); setFailed(false); })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const done = (message: string) => {
    setSheet(null);
    setToast(message);
    setTimeout(() => setToast(null), 2200);
    load();
  };

  if (loading) {
    return <View style={[s.container, s.center, { paddingTop: insets.top }]}><ActivityIndicator color={C.primary} /></View>;
  }

  if (failed || !data) {
    return (
      <View style={[s.container, s.center, { paddingTop: insets.top }]}>
        <Text style={s.empty}>Could not load this material.</Text>
        <TouchableOpacity style={s.retry} onPress={() => { setLoading(true); load(); }} activeOpacity={0.8}>
          <Text style={s.retryText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <View style={s.headerBar}>
        <TouchableOpacity style={s.iconBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={22} color={C.textPrimary} />
        </TouchableOpacity>
        <Text style={s.headerTitle} numberOfLines={1}>{data.name}</Text>
        <View style={s.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={{ padding: Spacing.lg, paddingBottom: insets.bottom + 40 }}>
        <View style={s.levelRow}>
          <Text style={s.level}>{fmtQty(data.currentQty, data.unit)}</Text>
          <LevelBadge isOut={data.isOut} isLow={data.isLow} />
        </View>
        {data.lowStockAt != null && (
          <Text style={s.levelSub}>Low below {fmtQty(data.lowStockAt, data.unit)}</Text>
        )}

        <View style={s.actions}>
          <TouchableOpacity style={[s.action, s.actionPrimary]} onPress={() => setSheet('restock')} activeOpacity={0.85}>
            <Text style={s.actionPrimaryText}>Restock</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.action} onPress={() => setSheet('count')} activeOpacity={0.85}>
            <Text style={s.actionText}>Count</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.action} onPress={() => setSheet('wastage')} activeOpacity={0.85}>
            <Text style={s.actionText}>Wastage</Text>
          </TouchableOpacity>
        </View>

        {data.usedBy.length > 0 && (
          <Text style={s.usedBy} numberOfLines={2}>
            Used in {data.usedBy.map((u) => u.name).join(' · ')}
          </Text>
        )}

        <Text style={s.sectionLabel}>History</Text>
        {data.movements.length === 0 && <Text style={s.empty}>Nothing has moved yet.</Text>}
        {data.movements.map((m) => {
          const out = m.qtyDelta < 0;
          const manual = MANUAL_TYPES.has(m.type);
          return (
            <View key={m.id} style={s.moveRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.moveTitle}>
                  <Text style={{ color: out ? C.danger : C.success }}>
                    {out ? '−' : '+'}{fmtQty(Math.abs(m.qtyDelta), data.unit)}
                  </Text>
                  {'  '}{m.label}
                </Text>
                <Text style={s.moveMeta} numberOfLines={1}>
                  {[
                    m.vendorName,
                    prettyReason(m.reason),
                    // Restock ₹ is the one money figure crew sees (§2 C3) —
                    // they paid it, so it is theirs to check.
                    m.type === 'PURCHASE' && m.value != null ? inr(m.value) : null,
                  ].filter(Boolean).join(' · ') || (manual ? '' : 'Automatic')}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={s.moveBy}>{m.by ?? (manual ? '—' : 'system')}</Text>
                <Text style={s.moveWhen}>{istDate(m.createdAt)}</Text>
              </View>
            </View>
          );
        })}
      </ScrollView>

      <RestockSheet material={data} visible={sheet === 'restock'} onClose={() => setSheet(null)} onDone={done} />
      <CountSheet material={data} visible={sheet === 'count'} onClose={() => setSheet(null)} onDone={done} />
      <RecordWastageSheet
        visible={sheet === 'wastage'}
        materials={[data]}
        prefillMaterial={data}
        onClose={() => setSheet(null)}
        onDone={done}
      />

      {toast && <View style={[s.toast, { bottom: insets.bottom + 30 }]}><Text style={s.toastText}>{toast}</Text></View>}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  center: { alignItems: 'center', justifyContent: 'center' },
  headerBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
  },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', color: C.textPrimary, fontSize: 17, fontWeight: '700' },
  levelRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  level: { color: C.textPrimary, fontSize: 30, fontWeight: '800', letterSpacing: -0.8, fontVariant: ['tabular-nums'] },
  levelSub: { color: C.textSecondary, fontSize: 12.5, marginTop: 4 },
  actions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.lg },
  action: { flex: 1, paddingVertical: 12, borderRadius: Radius.md, borderWidth: 1, borderColor: C.borderStrong, alignItems: 'center' },
  actionPrimary: { backgroundColor: C.primary, borderColor: C.primary },
  actionText: { color: C.textPrimary, fontSize: 14, fontWeight: '600' },
  actionPrimaryText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  usedBy: { color: C.textTertiary, fontSize: 12.5, marginTop: Spacing.lg, lineHeight: 18 },
  sectionLabel: {
    color: C.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 0.8,
    textTransform: 'uppercase', marginTop: Spacing.xl, marginBottom: Spacing.sm,
  },
  moveRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingVertical: Spacing.md, borderTopWidth: 1, borderTopColor: C.borderSubtle,
  },
  moveTitle: { color: C.textPrimary, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  moveMeta: { color: C.textSecondary, fontSize: 12, marginTop: 2 },
  moveBy: { color: C.textSecondary, fontSize: 12.5, fontWeight: '600' },
  moveWhen: { color: C.textTertiary, fontSize: 11, marginTop: 2 },
  empty: { color: C.textMuted, fontSize: 14, marginTop: Spacing.md },
  retry: { marginTop: Spacing.lg, paddingHorizontal: Spacing.xl, paddingVertical: 10, borderRadius: Radius.md, borderWidth: 1, borderColor: C.border },
  retryText: { color: C.textPrimary, fontSize: 14, fontWeight: '600' },
  toast: {
    position: 'absolute', alignSelf: 'center', backgroundColor: C.surfaceElevated, borderWidth: 1, borderColor: C.border,
    borderRadius: 999, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
  },
  toastText: { color: C.textPrimary, fontSize: 13, fontWeight: '600' },
});
