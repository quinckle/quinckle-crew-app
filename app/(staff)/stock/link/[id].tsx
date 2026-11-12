/**
 * Bulk link — one material into many dishes (CREW_STOCK_PLAN.md §12).
 *
 * Linking only ran dish → material, one dish at a time: open dish, add material,
 * search hundreds, type, save, back, repeat. For the twenty materials that
 * appear across most of a menu that is a fortnight of evenings.
 *
 * **Portions differ per dish**, so there is no single-amount shortcut here: oil
 * is 15 ml in a dal and 40 ml in a biryani. Every row carries its own quantity.
 * What this screen removes is the forty navigations, not the forty decisions.
 *
 * A starting amount fills every row you tick so none is ever blank. Rows you
 * never corrected are saved as ESTIMATES — they still deduct stock, because
 * roughly beats not at all, but they are marked and listed for confirming, and
 * editing one by hand clears the flag.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { crewStock, type CrewDishForMaterial } from '../../../../services/api';
import { QuinckleColors as C, Radius, Spacing } from '../../../../constants/Colors';
import {
  UNIT_LABEL, entryUnitsFor, defaultEntryUnit, fromBase,
  type StockBaseUnit, type StockEntryUnit,
} from '../../../../constants/stock';
import { ErrorLine, PrimaryButton, QtyRow } from '../../../../components/stock/pieces';

type Filter = 'all' | 'linked' | 'unlinked';
const PAGE = 40;

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'unlinked', label: 'Not using it' },
  { value: 'linked', label: 'Using it' },
  { value: 'all', label: 'All' },
];

/** What the row shows and what gets sent. `qty` is in the ENTRY unit. */
type Row = {
  dish: CrewDishForMaterial;
  /** null = not ticked. */
  qty: string | null;
  /** true until somebody types over the starting figure. */
  estimated: boolean;
};

export default function BulkLinkScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [name, setName] = useState('');
  const [base, setBase] = useState<StockBaseUnit>('GRAM');
  const [unit, setUnit] = useState<StockEntryUnit>('KG');
  const [start, setStart] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [counts, setCounts] = useState({ linked: 0, unlinked: 0, total: 0 });
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter>('unlinked');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [loading, setLoading] = useState(true);
  const [paging, setPaging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryId = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  /**
   * Edits survive a filter change or a new page: the rows people have already
   * ticked are keyed by dish and merged into whatever comes back, so switching
   * from "not using it" to "all" mid-pass does not silently drop their work.
   */
  const edits = useRef(new Map<string, { qty: string | null; estimated: boolean }>());

  const rowFor = (dish: CrewDishForMaterial): Row => {
    const edit = edits.current.get(dish.menuItemId);
    if (edit) return { dish, qty: edit.qty, estimated: edit.estimated };
    // An existing link shows its real amount, already measured.
    const existing = dish.qty != null ? fromBase(dish.qty, base) : null;
    return {
      dish,
      qty: existing ? String(existing.qty) : null,
      estimated: dish.isEstimated,
    };
  };

  const load = useCallback((opts: { offset?: number } = {}) => {
    if (!id) return;
    const offset = opts.offset ?? 0;
    const qid = offset === 0 ? ++queryId.current : queryId.current;
    if (offset === 0) setLoading(true); else setPaging(true);
    crewStock.dishesForMaterial(id, { search: debounced || undefined, filter, limit: PAGE, offset })
      .then((r) => {
        if (qid !== queryId.current) return;
        const d = r.data;
        setName(d.material.name);
        setBase(d.material.unit);
        setCounts(d.counts ?? { linked: 0, unlinked: 0, total: 0 });
        setNextOffset(d.nextOffset ?? null);
        const incoming = d.items ?? [];
        setRows((prev) => (offset === 0 ? incoming.map(rowFor) : [...prev, ...incoming.map(rowFor)]));
      })
      .catch(() => { if (qid === queryId.current && offset === 0) setRows([]); })
      .finally(() => { setLoading(false); setPaging(false); });
    // rowFor closes over `base`, which arrives with the first response; re-running
    // on it would refetch for nothing, so it is deliberately not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, debounced, filter]);

  useEffect(() => { load(); }, [load]);

  // The starting amount is only meaningful in the material's own kind of unit.
  useEffect(() => { setUnit(defaultEntryUnit(base)); }, [base]);

  const setRow = (menuItemId: string, next: { qty: string | null; estimated: boolean }) => {
    edits.current.set(menuItemId, next);
    setRows((rs) => rs.map((r) => (r.dish.menuItemId === menuItemId ? { ...r, ...next } : r)));
  };

  const toggle = (row: Row) => {
    if (row.qty != null) {
      // Untick: an already-linked dish becomes an unlink on save.
      setRow(row.dish.menuItemId, { qty: null, estimated: false });
      return;
    }
    const startNum = Number(start);
    if (!Number.isFinite(startNum) || startNum <= 0) {
      setError('Set a starting amount first — then tick the dishes');
      return;
    }
    setError(null);
    setRow(row.dish.menuItemId, { qty: start.trim(), estimated: true });
  };

  const ticked = rows.filter((r) => r.qty != null);
  const estimates = ticked.filter((r) => r.estimated).length;
  const unlinks = rows.filter((r) => r.qty == null && r.dish.qty != null).length;

  const save = async () => {
    if (!id) return;
    const lines: { menuItemId: string; qty: number | null; unit?: StockEntryUnit; isEstimated?: boolean }[] = [];
    for (const r of rows) {
      const wasLinked = r.dish.qty != null;
      if (r.qty == null) {
        if (wasLinked) lines.push({ menuItemId: r.dish.menuItemId, qty: null });
        continue;
      }
      const n = Number(r.qty);
      if (!Number.isFinite(n) || n <= 0) { setError(`Enter an amount for ${r.dish.name}`); return; }
      lines.push({ menuItemId: r.dish.menuItemId, qty: n, unit, isEstimated: r.estimated });
    }
    if (lines.length === 0) { setError('Tick a dish first'); return; }
    setBusy(true); setError(null);
    try {
      await crewStock.linkDishes(id, lines);
      router.back();
    } catch (e: any) {
      setError(e?.message ?? 'Could not save those links');
    } finally {
      setBusy(false);
    }
  };

  const units = entryUnitsFor(base);

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <View style={s.headerBar}>
        <TouchableOpacity style={s.iconBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={22} color={C.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle} numberOfLines={1}>{name || 'Add to dishes'}</Text>
          <Text style={s.headerSub}>
            {counts.linked} of {counts.total} dishes use it
          </Text>
        </View>
        <View style={s.iconBtn} />
      </View>

      <View style={s.startRow}>
        <Text style={s.startLabel}>Start every dish at</Text>
        <QtyRow
          value={start} onChange={setStart} unit={unit} onUnit={setUnit} units={units}
          placeholder="e.g. 10"
        />
        <Text style={s.startHint}>
          Tick a dish to fill it with this. Change any amount that is different — the ones you leave
          are saved as estimates and listed for confirming.
        </Text>
      </View>

      <View style={s.filters}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f.value}
            style={[s.chip, filter === f.value && s.chipOn]}
            onPress={() => setFilter(f.value)}
            activeOpacity={0.8}
          >
            <Text style={[s.chipText, filter === f.value && s.chipTextOn]}>
              {f.label}
              {f.value === 'unlinked' ? ` ${counts.unlinked}` : f.value === 'linked' ? ` ${counts.linked}` : ''}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={s.searchWrap}>
        <Ionicons name="search" size={16} color={C.textMuted} />
        <TextInput
          style={s.searchInput} value={search} onChangeText={setSearch}
          placeholder="Search dishes" placeholderTextColor={C.textMuted}
        />
      </View>

      {loading ? (
        <View style={s.center}><ActivityIndicator color={C.primary} /></View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.dish.menuItemId}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: Spacing.lg, paddingBottom: insets.bottom + 120 }}
          onEndReachedThreshold={0.4}
          onEndReached={() => { if (nextOffset != null && !paging) load({ offset: nextOffset }); }}
          ListEmptyComponent={<Text style={s.empty}>No dishes here.</Text>}
          ListFooterComponent={paging ? <ActivityIndicator color={C.textMuted} style={{ marginVertical: Spacing.lg }} /> : null}
          renderItem={({ item }) => {
            const on = item.qty != null;
            return (
              <View style={s.row}>
                <TouchableOpacity style={s.rowTap} onPress={() => toggle(item)} activeOpacity={0.7}>
                  <View style={[s.box, on && s.boxOn]}>
                    {on && <Ionicons name="checkmark" size={13} color="#fff" />}
                  </View>
                  <Text style={[s.name, !on && { color: C.textSecondary }]} numberOfLines={1}>{item.dish.name}</Text>
                </TouchableOpacity>

                {on ? (
                  <View style={s.qtyWrap}>
                    <TextInput
                      style={[s.qtyInput, item.estimated && s.qtyInputEst]}
                      value={item.qty ?? ''}
                      onChangeText={(v) => setRow(item.dish.menuItemId, { qty: v, estimated: false })}
                      keyboardType="decimal-pad"
                      placeholder="0" placeholderTextColor={C.textMuted}
                    />
                    <Text style={s.qtyUnit}>{UNIT_LABEL[unit]}</Text>
                  </View>
                ) : item.dish.qty != null ? (
                  <Text style={s.willUnlink}>remove</Text>
                ) : null}
              </View>
            );
          }}
        />
      )}

      <View style={[s.footer, { paddingBottom: insets.bottom + Spacing.md }]}>
        <ErrorLine text={error} />
        {estimates > 0 && (
          <Text style={s.estNote}>
            <Text style={{ color: C.warning }}>●</Text> {estimates} amount{estimates === 1 ? '' : 's'} still the
            starting figure — saved as estimates to confirm later.
          </Text>
        )}
        <PrimaryButton
          label={
            ticked.length === 0 && unlinks === 0
              ? 'Tick the dishes that use it'
              : `Link ${ticked.length} dish${ticked.length === 1 ? '' : 'es'}${unlinks ? ` · remove ${unlinks}` : ''}${estimates ? ` · ${estimates} estimated` : ''}`
          }
          onPress={save}
          busy={busy}
          disabled={ticked.length === 0 && unlinks === 0}
        />
      </View>
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
  startRow: {
    marginHorizontal: Spacing.lg, marginBottom: Spacing.md, padding: Spacing.md,
    borderRadius: Radius.md, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface,
  },
  startLabel: {
    color: C.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 0.8,
    textTransform: 'uppercase', marginBottom: 8,
  },
  startHint: { color: C.textTertiary, fontSize: 11.5, lineHeight: 17, marginTop: 8 },
  filters: { flexDirection: 'row', gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md },
  chip: { paddingHorizontal: Spacing.md, paddingVertical: 7, borderRadius: Radius.pill, borderWidth: 1, borderColor: C.border },
  chipOn: { backgroundColor: C.primarySoft, borderColor: C.primarySoftBorder },
  chipText: { color: C.textSecondary, fontSize: 12.5, fontWeight: '600' },
  chipTextOn: { color: C.primary },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: Spacing.lg, marginBottom: Spacing.md,
    paddingHorizontal: Spacing.md, height: 42,
    backgroundColor: C.surfaceMutedHover, borderRadius: Radius.md, borderWidth: 1, borderColor: C.border,
  },
  searchInput: { flex: 1, color: C.textPrimary, fontSize: 14 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: C.borderSubtle,
  },
  rowTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minWidth: 0 },
  box: {
    width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: C.borderStrong,
    alignItems: 'center', justifyContent: 'center',
  },
  boxOn: { backgroundColor: C.primary, borderColor: C.primary },
  name: { flex: 1, color: C.textPrimary, fontSize: 14.5, fontWeight: '500' },
  qtyWrap: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  qtyInput: {
    width: 62, textAlign: 'right', backgroundColor: C.surfaceMutedHover, borderRadius: Radius.sm,
    borderWidth: 1, borderColor: C.border, color: C.textPrimary,
    paddingHorizontal: 8, paddingVertical: 7, fontSize: 14, fontVariant: ['tabular-nums'],
  },
  qtyInputEst: { borderColor: C.warningBorder, color: C.warning },
  qtyUnit: { color: C.textSecondary, fontSize: 12, width: 28 },
  willUnlink: { color: C.danger, fontSize: 11.5, fontWeight: '600' },
  empty: { color: C.textMuted, textAlign: 'center', marginTop: 40, fontSize: 14 },
  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: Spacing.lg, paddingTop: Spacing.md,
    backgroundColor: C.background, borderTopWidth: 1, borderTopColor: C.border,
  },
  estNote: { color: C.textTertiary, fontSize: 11.5, lineHeight: 17, marginBottom: 2 },
});
