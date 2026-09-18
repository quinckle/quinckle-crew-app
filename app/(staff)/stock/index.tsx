/**
 * Stock — materials, dishes and wastage (CREW_STOCK_PLAN.md §3).
 *
 * The materials tab is a LEDGER grouped into three sections: Out, Running low,
 * Stocked. The grouping answers "what do I need to buy" before anyone touches a
 * control, and the ledger keeps 7-8 materials on a phone screen instead of 3.
 *
 * Grouping and sorting happen on the SERVER, and pages are slices of that one
 * ordered list — otherwise a section header would reappear at every page
 * boundary. Rows arrive 40 at a time and the next page loads as you reach the
 * end, so a venue with 400 materials opens as fast as one with 12.
 *
 * Money is deliberately thin here — no stock valuation, no ₹ per unit (§2 C3).
 *
 * Reached from More, gated on the STOCK capability on both sides.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import {
  crewStock,
  type CrewDish, type CrewMaterial, type CrewWastageEntry, type MaterialSort, type MaterialState,
} from '../../../services/api';
import { QuinckleColors as C, Radius, Spacing } from '../../../constants/Colors';
import { fmtQty, inr, istDate, prettyReason } from '../../../constants/stock';
import { RecordWastageSheet } from '../../../components/stock/RecordWastageSheet';
import { StockFilterSheet, type StockStateFilter } from '../../../components/stock/StockFilterSheet';

type Tab = 'materials' | 'dishes' | 'wastage';
/** Only what the server understands — `7d` is its default branch. */
type Range = 'today' | '7d' | 'month';

const RANGES: { value: Range; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: 'month', label: 'This month' },
];

const PAGE = 40;

/** Raw materials · Wastage · Menu linking — in that order, left to right. */
const TABS: { value: Tab; label: string }[] = [
  { value: 'materials', label: 'Raw materials' },
  { value: 'wastage', label: 'Wastage' },
  { value: 'dishes', label: 'Menu linking' },
];

const SECTION: Record<MaterialState, { label: string; color: string }> = {
  OUT: { label: 'Out', color: C.danger },
  LOW: { label: 'Running low', color: C.warning },
  OK: { label: 'Stocked', color: C.textSecondary },
};

export default function StockScreen() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('materials');

  // ── Materials (grouped, sorted and paged on the server) ──────────────────
  const [items, setItems] = useState<CrewMaterial[]>([]);
  const [counts, setCounts] = useState({ out: 0, low: 0, ok: 0, total: 0 });
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [paging, setPaging] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [filter, setFilter] = useState<StockStateFilter>('all');
  const [sort, setSort] = useState<MaterialSort>('qty_asc');
  /** Sections on by default; off gives one flat list in pure sort order. */
  const [grouped, setGrouped] = useState(true);
  const [filterOpen, setFilterOpen] = useState(false);
  /** Guards against a slow page 1 landing after a newer query has started. */
  const queryId = useRef(0);

  const [dishes, setDishes] = useState<CrewDish[]>([]);
  const [dishesLoading, setDishesLoading] = useState(false);
  const [unlinkedOnly, setUnlinkedOnly] = useState(false);

  const [range, setRange] = useState<Range>('today');
  const [wastage, setWastage] = useState<CrewWastageEntry[]>([]);
  const [wastageTotal, setWastageTotal] = useState(0);
  const [wastageLoading, setWastageLoading] = useState(false);

  const [recording, setRecording] = useState(false);
  /** The wastage picker needs every material, not the page on screen. */
  const [pickerMaterials, setPickerMaterials] = useState<CrewMaterial[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  const flash = (m: string) => { setToast(m); setTimeout(() => setToast(null), 2200); };

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const loadFirstPage = useCallback((opts: { quiet?: boolean } = {}) => {
    const id = ++queryId.current;
    if (!opts.quiet) setLoading(true);
    crewStock.materialsPage({
      search: debounced || undefined,
      state: filter,
      sort, grouped, limit: PAGE, offset: 0,
    })
      .then((r) => {
        if (id !== queryId.current) return;
        setItems(r.data?.items ?? []);
        setCounts(r.data?.counts ?? { out: 0, low: 0, ok: 0, total: 0 });
        setNextOffset(r.data?.nextOffset ?? null);
      })
      .catch(() => { if (id === queryId.current) { setItems([]); setNextOffset(null); } })
      .finally(() => { if (id === queryId.current) { setLoading(false); setRefreshing(false); } });
  }, [debounced, filter, sort, grouped]);

  const loadNextPage = useCallback(() => {
    if (nextOffset == null || paging) return;
    const id = queryId.current;
    setPaging(true);
    crewStock.materialsPage({
      search: debounced || undefined,
      state: filter,
      sort, grouped, limit: PAGE, offset: nextOffset,
    })
      .then((r) => {
        // A filter or sort changed while this page was in flight — drop it
        // rather than splicing rows from the old ordering into the new list.
        if (id !== queryId.current) return;
        setItems((prev) => [...prev, ...(r.data?.items ?? [])]);
        setNextOffset(r.data?.nextOffset ?? null);
      })
      .catch(() => {})
      .finally(() => setPaging(false));
  }, [nextOffset, paging, debounced, filter, sort, grouped]);

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

  // Search, filter and sort each reset to page 1 — they change the ordering, so
  // the rows already on screen no longer belong to the same list.
  useEffect(() => { if (tab === 'materials') loadFirstPage(); }, [tab, loadFirstPage]);

  /**
   * The focus refetch reads the loaders through a ref, NOT through the closure.
   *
   * With `loadFirstPage` captured in a `useCallback([tab, range])` it was frozen
   * at whatever sort and filter were set when the tab last changed — so every
   * focus event (returning from a material, a sheet closing) quietly refetched
   * with the DEFAULTS while the control still showed your choice. That is what
   * made filter and sort look broken.
   */
  const loaders = useRef({ loadFirstPage, loadDishes, loadWastage });
  useEffect(() => { loaders.current = { loadFirstPage, loadDishes, loadWastage }; });

  useFocusEffect(useCallback(() => {
    if (tab === 'materials') loaders.current.loadFirstPage({ quiet: true });
    if (tab === 'dishes') loaders.current.loadDishes();
    if (tab === 'wastage') loaders.current.loadWastage(range);
  }, [tab, range]));

  const openRecordWastage = () => {
    setRecording(true);
    if (pickerMaterials.length === 0) {
      crewStock.materials().then((r) => setPickerMaterials(r.data?.items ?? [])).catch(() => {});
    }
  };

  const switchTab = (t: Tab) => {
    setTab(t);
    if (t === 'dishes' && dishes.length === 0) loadDishes();
    if (t === 'wastage' && wastage.length === 0) loadWastage(range);
  };

  const q = search.trim().toLowerCase();
  const sortLabel = sort === 'qty_asc' ? 'Least first' : sort === 'qty_desc' ? 'Most first' : 'A–Z';
  const filterLabel =
    filter === 'alert' ? 'Needs attention' : filter === 'out' ? 'Out' : filter === 'low' ? 'Low' : null;
  // The button says what is applied, so nobody has to decode a tinted icon.
  const controlLabel = [filterLabel, sortLabel, grouped ? null : 'flat'].filter(Boolean).join(' · ');

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <View style={s.headerBar}>
        <TouchableOpacity style={s.iconBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={22} color={C.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>Stock</Text>
          {tab === 'materials' && (
            <Text style={s.headerSub}>
              {counts.total} material{counts.total === 1 ? '' : 's'}
              {counts.out + counts.low > 0 ? ` · ${counts.out + counts.low} need attention` : ''}
            </Text>
          )}
        </View>
        <TouchableOpacity style={s.iconBtn} onPress={() => router.push('/(staff)/stock/new')} activeOpacity={0.7}>
          <Ionicons name="add" size={24} color={C.primary} />
        </TouchableOpacity>
      </View>

      {/* Underlined bar, not pills — the Ledger direction. The rule runs the
          full width so the tabs read as one strip over the list, and the active
          label goes solid white with the brand underline under it. */}
      <View style={s.tabs}>
        {TABS.map((t) => (
          <TouchableOpacity
            key={t.value}
            style={[s.tab, tab === t.value && s.tabOn]}
            onPress={() => switchTab(t.value)}
            activeOpacity={0.7}
          >
            <Text style={[s.tabText, tab === t.value && s.tabTextOn]} numberOfLines={1}>{t.label}</Text>
          </TouchableOpacity>
        ))}
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
              style={[s.sortBtn, filter !== 'all' && s.sortBtnOn]}
              onPress={() => setFilterOpen(true)} activeOpacity={0.8}
            >
              <Ionicons name="options-outline" size={16} color={filter === 'all' ? C.textSecondary : C.warning} />
              <Text style={[s.sortText, filter !== 'all' && { color: C.warning }]} numberOfLines={1}>{controlLabel}</Text>
            </TouchableOpacity>
          </View>

          {loading ? (
            <View style={s.center}><ActivityIndicator color={C.primary} /></View>
          ) : (
            <FlatList
              data={items}
              keyExtractor={(i) => i.id}
              contentContainerStyle={{ paddingHorizontal: Spacing.lg, paddingBottom: insets.bottom + 40 }}
              keyboardShouldPersistTaps="handled"
              refreshControl={
                <RefreshControl
                  refreshing={refreshing} tintColor={C.textSecondary}
                  onRefresh={() => { setRefreshing(true); loadFirstPage({ quiet: true }); }}
                />
              }
              onEndReachedThreshold={0.4}
              onEndReached={loadNextPage}
              ListHeaderComponent={
                items.length > 0 ? (
                  <View style={s.colHead}>
                    <Text style={s.colLabel}>Material</Text>
                    <TouchableOpacity onPress={() => setFilterOpen(true)} activeOpacity={0.7} hitSlop={8}>
                      <Text style={[s.colLabel, s.colRight, sort !== 'name' && { color: C.textSecondary }]}>
                        In stock {sort === 'qty_asc' ? '↑' : sort === 'qty_desc' ? '↓' : ''}
                      </Text>
                    </TouchableOpacity>
                    <Text style={[s.colLabel, s.colRight]}>State</Text>
                  </View>
                ) : null
              }
              ListEmptyComponent={
                q ? (
                  // The empty search IS the add path — how a new ingredient gets
                  // recorded mid-delivery (§2 C2).
                  <TouchableOpacity
                    style={s.emptyAdd}
                    onPress={() => router.push({ pathname: '/(staff)/stock/new', params: { name: search.trim() } })}
                    activeOpacity={0.8}
                  >
                    <Ionicons name="add-circle-outline" size={18} color={C.primary} />
                    <Text style={s.emptyAddText}>Add “{search.trim()}” as a new material</Text>
                  </TouchableOpacity>
                ) : (
                  <Text style={s.empty}>
                    {filter === 'all' ? 'No materials yet.' : 'Nothing matches that filter.'}
                  </Text>
                )
              }
              ListFooterComponent={
                paging ? <ActivityIndicator color={C.textMuted} style={{ marginVertical: Spacing.lg }} />
                  : nextOffset == null && items.length > 12
                    ? <Text style={s.endNote}>All {counts.total} materials</Text>
                    : null
              }
              renderItem={({ item, index }) => {
                const state = item.state ?? (item.isOut ? 'OUT' : item.isLow ? 'LOW' : 'OK');
                const prev = index > 0 ? items[index - 1] : undefined;
                const prevState = prev ? (prev.state ?? (prev.isOut ? 'OUT' : prev.isLow ? 'LOW' : 'OK')) : undefined;
                // No sections in a flat list — the sort is the only order there.
                const isFirstOfSection = grouped && state !== prevState;
                const sectionCount = state === 'OUT' ? counts.out : state === 'LOW' ? counts.low : counts.ok;
                return (
                  <>
                    {isFirstOfSection && (
                      <View style={s.sectionHead}>
                        <Text style={[s.sectionLabel, { color: SECTION[state].color }]}>
                          {SECTION[state].label} · {sectionCount}
                        </Text>
                        {state === 'OUT' && <Text style={s.sectionNote}>Buy first</Text>}
                      </View>
                    )}
                    <TouchableOpacity
                      style={s.row}
                      activeOpacity={0.7}
                      onPress={() => router.push({ pathname: '/(staff)/stock/[id]', params: { id: item.id } })}
                    >
                      <View style={s.rowMain}>
                        <Text style={s.name} numberOfLines={1}>{item.name}</Text>
                        <Text style={s.rowSub} numberOfLines={1}>
                          {item.usedByCount ? `used in ${item.usedByCount} dish${item.usedByCount === 1 ? '' : 'es'}` : 'not linked to a dish'}
                          {item.lowStockAt != null ? ` · low at ${fmtQty(item.lowStockAt, item.unit)}` : ''}
                        </Text>
                      </View>
                      <Text style={[s.qty, state === 'OUT' && { color: C.danger }, state === 'LOW' && { color: C.warning }]}>
                        {fmtQty(item.currentQty, item.unit)}
                      </Text>
                      <Text style={[s.state, { color: state === 'OUT' ? C.danger : state === 'LOW' ? C.warning : C.textMuted }]}>
                        {state}
                      </Text>
                    </TouchableOpacity>
                  </>
                );
              }}
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
              style={[s.ctlBtn, unlinkedOnly && s.ctlBtnWarn]}
              onPress={() => setUnlinkedOnly((v) => !v)} activeOpacity={0.8}
            >
              <Ionicons name={unlinkedOnly ? 'unlink' : 'link'} size={17} color={unlinkedOnly ? C.warning : C.textSecondary} />
            </TouchableOpacity>
          </View>

          {dishesLoading ? (
            <View style={s.center}><ActivityIndicator color={C.primary} /></View>
          ) : (
            <FlatList
              data={dishes.filter((d) =>
                (!q || d.name.toLowerCase().includes(q)) && (!unlinkedOnly || d.materials === 0))}
              keyExtractor={(d) => d.menuItemId}
              contentContainerStyle={{ paddingHorizontal: Spacing.lg, paddingBottom: insets.bottom + 40 }}
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
                  <Text style={[s.name, { flex: 1 }]} numberOfLines={1}>{item.name}</Text>
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
              contentContainerStyle={{ paddingHorizontal: Spacing.lg, paddingBottom: insets.bottom + 90 }}
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
            onPress={openRecordWastage}
            activeOpacity={0.85}
          >
            <Ionicons name="add" size={20} color="#fff" />
            <Text style={s.fabText}>Record wastage</Text>
          </TouchableOpacity>
        </>
      )}

      <StockFilterSheet
        visible={filterOpen}
        filter={filter}
        sort={sort}
        grouped={grouped}
        counts={counts}
        onClose={() => setFilterOpen(false)}
        // One commit for both choices: each change re-queries, so applying on
        // every tap would fire three requests for one decision.
        onApply={(f, o, g) => { setFilter(f); setSort(o); setGrouped(g); setFilterOpen(false); }}
      />

      <RecordWastageSheet
        visible={recording}
        materials={pickerMaterials}
        onClose={() => setRecording(false)}
        onDone={(m) => { setRecording(false); flash(m); loadWastage(range); loadFirstPage({ quiet: true }); }}
      />

      {toast && <View style={[s.toast, { bottom: insets.bottom + 90 }]}><Text style={s.toastText}>{toast}</Text></View>}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerBar: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
  },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: C.textPrimary, fontSize: 17, fontWeight: '700' },
  headerSub: { color: C.textTertiary, fontSize: 11.5, marginTop: 1 },
  // Each tab takes an equal share of the width so the strip spans the screen
  // and every label has the same target, rather than three labels huddled left.
  tabs: {
    flexDirection: 'row', paddingHorizontal: Spacing.md, marginBottom: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  tab: {
    flex: 1, alignItems: 'center', paddingVertical: 10,
    borderBottomWidth: 2, borderBottomColor: 'transparent', marginBottom: -1,
  },
  tabText: { color: C.textSecondary, fontSize: 13, fontWeight: '600' },
  tabTextOn: { color: C.textPrimary },
  tabOn: { borderBottomColor: C.primary },
  searchRow: { flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md },
  searchWrap: {
    flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: Spacing.md, height: 42,
    backgroundColor: C.surfaceMutedHover, borderRadius: Radius.md, borderWidth: 1, borderColor: C.border,
  },
  searchInput: { flex: 1, color: C.textPrimary, fontSize: 14 },
  ctlBtn: { width: 42, height: 42, borderRadius: Radius.md, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  ctlBtnWarn: { backgroundColor: C.warningSoft, borderColor: C.warningBorder },
  sortBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, height: 42, paddingHorizontal: Spacing.md,
    borderRadius: Radius.md, borderWidth: 1, borderColor: C.border, maxWidth: 190,
  },
  sortBtnOn: { borderColor: C.warningBorder, backgroundColor: C.warningSoft },
  sortText: { color: C.textSecondary, fontSize: 12.5, fontWeight: '600', flexShrink: 1 },
  colHead: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingTop: Spacing.xs, paddingBottom: 7, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  colLabel: {
    color: C.textMuted, fontSize: 10, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase',
    flex: 1,
  },
  colRight: { flex: 0, width: 82, textAlign: 'right' },
  sectionHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: Spacing.lg, paddingBottom: 6,
  },
  sectionLabel: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.9, textTransform: 'uppercase' },
  sectionNote: { color: C.textMuted, fontSize: 10.5, fontWeight: '600' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: C.borderSubtle,
  },
  rowMain: { flex: 1, minWidth: 0 },
  name: { color: C.textPrimary, fontSize: 14.5, fontWeight: '600' },
  rowSub: { color: C.textTertiary, fontSize: 11, marginTop: 2 },
  qty: { width: 82, textAlign: 'right', color: C.textPrimary, fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  state: { width: 34, textAlign: 'right', fontSize: 9.5, fontWeight: '700', letterSpacing: 0.4 },
  notLinked: { color: C.warning, fontSize: 12.5, fontWeight: '600' },
  dishHint: { color: C.textTertiary, fontSize: 12.5, lineHeight: 18, paddingVertical: Spacing.md },
  empty: { color: C.textMuted, textAlign: 'center', marginTop: 40, fontSize: 14 },
  endNote: { color: C.textMuted, textAlign: 'center', fontSize: 11.5, marginTop: Spacing.lg },
  emptyAdd: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 32,
    paddingVertical: 14, borderRadius: Radius.md, borderWidth: 1, borderColor: C.primarySoftBorder, backgroundColor: C.primarySoft,
  },
  emptyAddText: { color: C.primary, fontSize: 14, fontWeight: '600' },
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
