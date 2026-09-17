/**
 * Stock — materials and wastage (CREW_STOCK_PLAN.md §3).
 *
 * Replaces the V1 screen (a flat list with a count box). Two tabs in one header:
 * the materials the kitchen holds, and the wastage log. Money is deliberately
 * thin here — no stock valuation, no ₹ per unit (§2 C3); the only ₹ a staffer
 * sees is the bill they typed and the wastage they caused.
 *
 * Reached from More, gated on the STOCK capability on both sides.
 */

import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { crewStock, type CrewDish, type CrewMaterial, type CrewWastageEntry } from '../../../services/api';
import { QuinckleColors as C, Radius, Spacing } from '../../../constants/Colors';
import { fmtQty, inr, istDate, prettyReason } from '../../../constants/stock';
import { LevelBadge } from '../../../components/stock/pieces';
import { AddMaterialSheet } from '../../../components/stock/AddMaterialSheet';
import { RecordWastageSheet } from '../../../components/stock/RecordWastageSheet';

type Tab = 'materials' | 'dishes' | 'wastage';
/** Only what the server understands — `7d` is its default branch. */
type Range = 'today' | '7d' | 'month';

const RANGES: { value: Range; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: 'month', label: 'This month' },
];

export default function StockScreen() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('materials');
  const [items, setItems] = useState<CrewMaterial[]>([]);
  const [lowCount, setLowCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [lowOnly, setLowOnly] = useState(false);

  const [dishes, setDishes] = useState<CrewDish[]>([]);
  const [dishesLoading, setDishesLoading] = useState(false);
  const [unlinkedOnly, setUnlinkedOnly] = useState(false);

  const [range, setRange] = useState<Range>('today');
  const [wastage, setWastage] = useState<CrewWastageEntry[]>([]);
  const [wastageTotal, setWastageTotal] = useState(0);
  const [wastageLoading, setWastageLoading] = useState(false);

  const [adding, setAdding] = useState(false);
  const [recording, setRecording] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2200); };

  // Always fetched whole, never filtered server-side: the low toggle is a view
  // of the same list, and the wastage picker needs every material even while the
  // list is showing only the low ones.
  const loadMaterials = useCallback(() => {
    setLoading(true);
    crewStock.materials()
      .then((r) => { setItems(r.data?.items ?? []); setLowCount(Number(r.data?.lowCount) || 0); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Every field is defaulted. A shape that does not match must leave the tab
  // empty, never blank the screen — reading `total` (the server sends
  // `totalCost`) threw inside the ₹ formatter and took the whole screen down.
  // `all`, not the default `with`: this tab exists to find the dishes that have
  // NO recipe — the ones whose sales deduct nothing.
  const loadDishes = useCallback(() => {
    setDishesLoading(true);
    crewStock.dishes(undefined, 'all')
      .then((r) => setDishes(r.data ?? []))
      .catch(() => setDishes([]))
      .finally(() => setDishesLoading(false));
  }, []);

  const loadWastage = useCallback((r: Range) => {
    setWastageLoading(true);
    crewStock.wastageLog(r)
      .then((res) => {
        setWastage(res.data?.entries ?? []);
        setWastageTotal(Number(res.data?.totalCost) || 0);
      })
      .catch(() => { setWastage([]); setWastageTotal(0); })
      .finally(() => setWastageLoading(false));
  }, []);

  // Coming back from a material detail must show what was just done there, so
  // the list refetches on focus rather than trusting the copy it already has.
  useFocusEffect(useCallback(() => {
    loadMaterials();
    if (tab === 'dishes') loadDishes();
    if (tab === 'wastage') loadWastage(range);
  }, [loadMaterials, loadDishes, loadWastage, tab, range]));

  const q = search.trim().toLowerCase();
  const filtered = items.filter((i) =>
    (!q || i.name.toLowerCase().includes(q)) && (!lowOnly || i.isLow || i.isOut));

  const switchTab = (t: Tab) => {
    setTab(t);
    if (t === 'dishes' && dishes.length === 0) loadDishes();
    if (t === 'wastage' && wastage.length === 0) loadWastage(range);
  };

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <View style={s.headerBar}>
        <TouchableOpacity style={s.iconBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={22} color={C.textPrimary} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Stock</Text>
        <TouchableOpacity style={s.iconBtn} onPress={() => setAdding(true)} activeOpacity={0.7}>
          <Ionicons name="add" size={24} color={C.primary} />
        </TouchableOpacity>
      </View>

      <View style={s.tabs}>
        <TouchableOpacity style={[s.tab, tab === 'materials' && s.tabOn]} onPress={() => switchTab('materials')} activeOpacity={0.8}>
          <Text style={[s.tabText, tab === 'materials' && s.tabTextOn]}>
            Materials{lowCount > 0 ? ` · ${lowCount} low` : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.tab, tab === 'dishes' && s.tabOn]} onPress={() => switchTab('dishes')} activeOpacity={0.8}>
          <Text style={[s.tabText, tab === 'dishes' && s.tabTextOn]}>Dishes</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.tab, tab === 'wastage' && s.tabOn]} onPress={() => switchTab('wastage')} activeOpacity={0.8}>
          <Text style={[s.tabText, tab === 'wastage' && s.tabTextOn]}>Wastage</Text>
        </TouchableOpacity>
      </View>

      {tab === 'materials' ? (
        <>
          <View style={s.searchRow}>
            <View style={s.searchWrap}>
              <Ionicons name="search" size={16} color={C.textMuted} />
              <TextInput
                style={s.searchInput} value={search} onChangeText={setSearch}
                placeholder="Search materials" placeholderTextColor={C.textMuted}
              />
            </View>
            <TouchableOpacity
              style={[s.lowBtn, lowOnly && s.lowBtnOn]}
              onPress={() => setLowOnly((v) => !v)} activeOpacity={0.8}
            >
              <Ionicons name={lowOnly ? 'alert-circle' : 'alert-circle-outline'} size={18} color={lowOnly ? C.warning : C.textSecondary} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={s.center}><ActivityIndicator color={C.primary} /></View>
          ) : (
            <FlatList
              data={filtered}
              keyExtractor={(i) => i.id}
              contentContainerStyle={{ padding: Spacing.lg, paddingBottom: insets.bottom + 40 }}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                // The empty search IS the add path — this is how a new
                // ingredient gets recorded mid-delivery (§2 C2).
                q ? (
                  <TouchableOpacity style={s.emptyAdd} onPress={() => setAdding(true)} activeOpacity={0.8}>
                    <Ionicons name="add-circle-outline" size={18} color={C.primary} />
                    <Text style={s.emptyAddText}>Add “{search.trim()}” as a new material</Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={s.empty}>{lowOnly ? 'Nothing is running low.' : 'No materials yet.'}</Text>
                )
              }
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={s.row}
                  activeOpacity={0.7}
                  onPress={() => router.push({ pathname: '/(staff)/stock/[id]', params: { id: item.id } })}
                >
                  <Text style={s.name} numberOfLines={1}>{item.name}</Text>
                  <Text style={s.qty}>{fmtQty(item.currentQty, item.unit)}</Text>
                  <LevelBadge isOut={item.isOut} isLow={item.isLow} />
                  <Ionicons name="chevron-forward" size={16} color={C.textTertiary} />
                </TouchableOpacity>
              )}
            />
          )}
        </>
      ) : tab === 'dishes' ? (
        <>
          <View style={s.searchRow}>
            <View style={s.searchWrap}>
              <Ionicons name="search" size={16} color={C.textMuted} />
              <TextInput
                style={s.searchInput} value={search} onChangeText={setSearch}
                placeholder="Search dishes" placeholderTextColor={C.textMuted}
              />
            </View>
            <TouchableOpacity
              style={[s.lowBtn, unlinkedOnly && s.lowBtnOn]}
              onPress={() => setUnlinkedOnly((v) => !v)} activeOpacity={0.8}
            >
              <Ionicons name={unlinkedOnly ? 'link-outline' : 'link'} size={18} color={unlinkedOnly ? C.warning : C.textSecondary} />
            </TouchableOpacity>
          </View>

          {dishesLoading ? (
            <View style={s.center}><ActivityIndicator color={C.primary} /></View>
          ) : (
            <FlatList
              data={dishes.filter((d) =>
                (!q || d.name.toLowerCase().includes(q)) && (!unlinkedOnly || d.materials === 0))}
              keyExtractor={(d) => d.menuItemId}
              contentContainerStyle={{ padding: Spacing.lg, paddingBottom: insets.bottom + 40 }}
              keyboardShouldPersistTaps="handled"
              ListHeaderComponent={
                unlinkedOnly || dishes.length === 0 ? null : (
                  <Text style={s.dishHint}>
                    {dishes.filter((d) => d.materials === 0).length} of {dishes.length} dishes take nothing out of stock when they sell.
                  </Text>
                )
              }
              ListEmptyComponent={<Text style={s.empty}>{unlinkedOnly ? 'Every dish is linked.' : 'No dishes.'}</Text>}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={s.row}
                  activeOpacity={0.7}
                  onPress={() => router.push({ pathname: '/(staff)/stock/dish/[id]', params: { id: item.menuItemId } })}
                >
                  <Text style={s.name} numberOfLines={1}>{item.name}</Text>
                  {item.materials > 0 ? (
                    <Text style={s.qty}>{item.materials} material{item.materials === 1 ? '' : 's'}</Text>
                  ) : (
                    <Text style={s.notLinked}>not linked</Text>
                  )}
                  <Ionicons name="chevron-forward" size={16} color={C.textTertiary} />
                </TouchableOpacity>
              )}
            />
          )}
        </>
      ) : (
        <>
          <View style={s.rangeRow}>
            {RANGES.map((r) => (
              <TouchableOpacity
                key={r.value}
                style={[s.rangeChip, range === r.value && s.rangeChipOn]}
                onPress={() => { setRange(r.value); loadWastage(r.value); }}
                activeOpacity={0.8}
              >
                <Text style={[s.rangeText, range === r.value && s.rangeTextOn]}>{r.label}</Text>
              </TouchableOpacity>
            ))}
            <Text style={s.rangeTotal}>{inr(wastageTotal)} lost</Text>
          </View>

          {wastageLoading ? (
            <View style={s.center}><ActivityIndicator color={C.primary} /></View>
          ) : (
            <FlatList
              data={wastage}
              keyExtractor={(e) => e.id}
              contentContainerStyle={{ padding: Spacing.lg, paddingBottom: insets.bottom + 90 }}
              ListEmptyComponent={<Text style={s.empty}>Nothing recorded.</Text>}
              renderItem={({ item }) => (
                <View style={s.wasteRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={s.name} numberOfLines={1}>{item.name}</Text>
                    <Text style={s.wasteMeta}>
                      {fmtQty(item.qty, item.unit)} · {prettyReason(item.reason)}
                      {item.recordedBy ? ` · ${item.recordedBy}` : ''}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={s.wasteValue}>{inr(item.costValue)}</Text>
                    <Text style={s.wasteWhen}>{istDate(item.createdAt)}</Text>
                  </View>
                </View>
              )}
            />
          )}

          <TouchableOpacity
            style={[s.fab, { bottom: insets.bottom + 20 }]}
            onPress={() => setRecording(true)}
            activeOpacity={0.85}
          >
            <Ionicons name="add" size={20} color="#fff" />
            <Text style={s.fabText}>Record wastage</Text>
          </TouchableOpacity>
        </>
      )}

      <AddMaterialSheet
        visible={adding}
        initialName={q && filtered.length === 0 ? search.trim() : undefined}
        onClose={() => setAdding(false)}
        onDone={(m) => { setAdding(false); setSearch(''); flash(m); loadMaterials(); }}
      />

      <RecordWastageSheet
        visible={recording}
        materials={items}
        onClose={() => setRecording(false)}
        onDone={(m) => { setRecording(false); flash(m); loadWastage(range); loadMaterials(); }}
      />

      {toast && <View style={[s.toast, { bottom: insets.bottom + 90 }]}><Text style={s.toastText}>{toast}</Text></View>}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
  },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: C.textPrimary, fontSize: 17, fontWeight: '700' },
  tabs: { flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md },
  tab: { paddingHorizontal: Spacing.lg, paddingVertical: 8, borderRadius: Radius.pill, borderWidth: 1, borderColor: C.border },
  tabOn: { backgroundColor: C.primarySoft, borderColor: C.primarySoftBorder },
  tabText: { color: C.textSecondary, fontSize: 13, fontWeight: '600' },
  tabTextOn: { color: C.primary },
  searchRow: { flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.lg },
  searchWrap: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: Spacing.md, height: 42,
    backgroundColor: C.surfaceMutedHover, borderRadius: Radius.md, borderWidth: 1, borderColor: C.border,
  },
  searchInput: { flex: 1, color: C.textPrimary, fontSize: 14 },
  lowBtn: { width: 42, height: 42, borderRadius: Radius.md, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  lowBtnOn: { backgroundColor: C.warningSoft, borderColor: C.warningBorder },
  empty: { color: C.textMuted, textAlign: 'center', marginTop: 40, fontSize: 14 },
  emptyAdd: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 32,
    paddingVertical: 14, borderRadius: Radius.md, borderWidth: 1, borderColor: C.primarySoftBorder, backgroundColor: C.primarySoft,
  },
  emptyAddText: { color: C.primary, fontSize: 14, fontWeight: '600' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: C.borderSubtle,
  },
  name: { flex: 1, color: C.textPrimary, fontSize: 14.5, fontWeight: '600' },
  qty: { color: C.textSecondary, fontSize: 13, fontVariant: ['tabular-nums'] },
  notLinked: { color: C.warning, fontSize: 12.5, fontWeight: '600' },
  dishHint: { color: C.textTertiary, fontSize: 12.5, lineHeight: 18, marginBottom: Spacing.md },
  rangeRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.lg },
  rangeChip: { paddingHorizontal: Spacing.md, paddingVertical: 7, borderRadius: Radius.pill, borderWidth: 1, borderColor: C.border },
  rangeChipOn: { backgroundColor: C.primarySoft, borderColor: C.primarySoftBorder },
  rangeText: { color: C.textSecondary, fontSize: 12.5, fontWeight: '600' },
  rangeTextOn: { color: C.primary },
  rangeTotal: { marginLeft: 'auto', color: C.textSecondary, fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  wasteRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: C.borderSubtle,
  },
  wasteMeta: { color: C.textSecondary, fontSize: 12.5, marginTop: 2 },
  wasteValue: { color: C.textPrimary, fontSize: 13.5, fontWeight: '600', fontVariant: ['tabular-nums'] },
  wasteWhen: { color: C.textTertiary, fontSize: 11, marginTop: 2 },
  fab: {
    position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.primary, borderRadius: Radius.pill, paddingHorizontal: Spacing.xl, paddingVertical: 13,
  },
  fabText: { color: '#fff', fontSize: 14.5, fontWeight: '700' },
  toast: {
    position: 'absolute', alignSelf: 'center', backgroundColor: C.surfaceElevated, borderWidth: 1, borderColor: C.border,
    borderRadius: 999, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
  },
  toastText: { color: C.textPrimary, fontSize: 13, fontWeight: '600' },
});
