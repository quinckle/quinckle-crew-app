/**
 * Record wastage — several lines in one go (CREW_STOCK_PLAN.md §3).
 *
 * A screen, not a sheet. The end-of-day write-off is a list somebody builds up
 * over a minute or two — pick, type, pick again — and a sheet gave it half the
 * height with a keyboard covering the rest. A screen also gets a real back
 * gesture, which a half-built list needs.
 *
 * Each line is either a MATERIAL (a quantity) or a DISH (plates, whose whole
 * recipe comes off stock). The picker queries the server as you type rather than
 * filtering a downloaded list — a venue with 400 materials was pulling all of
 * them to populate a picker.
 *
 * Opened with ?materialId= from a material's own Wastage button, which lands
 * straight on that material's line.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { crewStock, type CrewMaterial, type CrewWastageLine } from '../../../../services/api';
import { QuinckleColors as C, Radius, Spacing } from '../../../../constants/Colors';
import {
  UNIT_LABEL, entryUnitsFor, defaultEntryUnit, reasonLabel,
  type StockEntryUnit, type WastageReason,
} from '../../../../constants/stock';
import { ErrorLine, FieldLabel, PrimaryButton, QtyRow, ReasonChips, sheetStyles } from '../../../../components/stock/pieces';

type Draft =
  | { kind: 'MATERIAL'; material: CrewMaterial; qty: string; unit: StockEntryUnit; reason: WastageReason | null; note: string }
  | { kind: 'DISH'; dish: { menuItemId: string; name: string }; plates: string; reason: WastageReason | null; note: string };

type Built = { key: string; label: string; detail: string; line: CrewWastageLine };

export default function RecordWastageScreen() {
  const insets = useSafeAreaInsets();
  const { materialId } = useLocalSearchParams<{ materialId?: string }>();

  const [built, setBuilt] = useState<Built[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [picking, setPicking] = useState(!materialId);
  const [tab, setTab] = useState<'MATERIAL' | 'DISH'>('MATERIAL');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [materials, setMaterials] = useState<CrewMaterial[]>([]);
  const [dishes, setDishes] = useState<{ menuItemId: string; name: string }[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const queryId = useRef(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Prefill from a material's own Wastage button.
  useEffect(() => {
    if (!materialId) return;
    crewStock.material(materialId)
      .then((r) => setDraft(newMaterialDraft(r.data)))
      .catch(() => { setPicking(true); setError('Could not load that material'); });
  }, [materialId]);

  /** The picker asks the server. 20 rows is plenty when search is a keystroke away. */
  const runSearch = useCallback(() => {
    const id = ++queryId.current;
    setSearching(true);
    const p = tab === 'MATERIAL'
      ? crewStock.materialsPage({ search: debounced || undefined, limit: 20, offset: 0 })
        .then((r) => { if (id === queryId.current) setMaterials(r.data?.items ?? []); })
      // Only dishes WITH a recipe can come off stock as plates.
      : crewStock.dishes(debounced || undefined, 'with', { limit: 20, offset: 0 })
        .then((r) => { if (id === queryId.current) setDishes((r.data ?? []).map((d) => ({ menuItemId: d.menuItemId, name: d.name }))); });
    p.catch(() => {}).finally(() => { if (id === queryId.current) setSearching(false); });
  }, [tab, debounced]);

  useEffect(() => { if (picking) runSearch(); }, [picking, runSearch]);

  const commitDraft = (): CrewWastageLine | null => {
    if (!draft) return null;
    if (!draft.reason) { setError('Pick a reason'); return null; }
    if (draft.kind === 'MATERIAL') {
      const n = Number(draft.qty);
      if (!Number.isFinite(n) || n <= 0) { setError('Enter how much was wasted'); return null; }
      const line: CrewWastageLine = {
        kind: 'MATERIAL', stockItemId: draft.material.id, qty: n, unit: draft.unit,
        reason: draft.reason, note: draft.note.trim() || null,
      };
      setBuilt((b) => [...b, {
        key: `${Date.now()}-${b.length}`,
        label: draft.material.name,
        detail: `${n} ${UNIT_LABEL[draft.unit]} · ${reasonLabel(draft.reason!)}`,
        line,
      }]);
      setDraft(null); setError(null); setSearch('');
      return line;
    }
    const n = Number(draft.plates);
    if (!Number.isFinite(n) || n <= 0) { setError('Enter how many plates'); return null; }
    const line: CrewWastageLine = {
      kind: 'DISH', menuItemId: draft.dish.menuItemId, plates: n,
      reason: draft.reason, note: draft.note.trim() || null,
    };
    setBuilt((b) => [...b, {
      key: `${Date.now()}-${b.length}`,
      label: draft.dish.name,
      detail: `${n} plate${n === 1 ? '' : 's'} · ${reasonLabel(draft.reason!)} · whole recipe comes off`,
      line,
    }]);
    setDraft(null); setError(null); setSearch('');
    return line;
  };

  const save = async () => {
    // A half-typed line on screen counts — saving without it is the easiest way
    // to lose an entry somebody thought they had recorded.
    let lines = built.map((b) => b.line);
    if (draft) {
      const committed = commitDraft();
      if (!committed) return;
      lines = [...lines, committed];
    }
    if (lines.length === 0) { setError('Add a line first'); return; }
    setBusy(true); setError(null);
    try {
      await crewStock.recordWastage(lines);
      router.back();
    } catch (e: any) {
      setError(e?.message ?? 'Could not record the wastage');
    } finally {
      setBusy(false);
    }
  };

  const rows: { key: string; name: string; onPick: () => void }[] = tab === 'MATERIAL'
    ? materials.map((m) => ({
      key: m.id, name: m.name,
      onPick: () => { setDraft(newMaterialDraft(m)); setPicking(false); setError(null); },
    }))
    : dishes.map((d) => ({
      key: d.menuItemId, name: d.name,
      onPick: () => { setDraft({ kind: 'DISH', dish: d, plates: '', reason: null, note: '' }); setPicking(false); setError(null); },
    }));

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      <View style={s.headerBar}>
        <TouchableOpacity style={s.iconBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={22} color={C.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>Record wastage</Text>
          {built.length > 0 && (
            <Text style={s.headerSub}>{built.length} line{built.length === 1 ? '' : 's'} ready</Text>
          )}
        </View>
        <View style={s.iconBtn} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: Spacing.lg, paddingBottom: insets.bottom + 120 }}
        keyboardShouldPersistTaps="handled"
      >
        {built.map((b) => (
          <View key={b.key} style={s.built}>
            <View style={{ flex: 1 }}>
              <Text style={s.builtName}>{b.label}</Text>
              <Text style={s.builtDetail}>{b.detail}</Text>
            </View>
            <TouchableOpacity onPress={() => setBuilt((x) => x.filter((y) => y.key !== b.key))} hitSlop={10} activeOpacity={0.7}>
              <Ionicons name="close" size={16} color={C.textTertiary} />
            </TouchableOpacity>
          </View>
        ))}

        {draft ? (
          <View style={s.draft}>
            <View style={s.draftHead}>
              <Text style={s.draftName} numberOfLines={1}>
                {draft.kind === 'MATERIAL' ? draft.material.name : draft.dish.name}
              </Text>
              <TouchableOpacity onPress={() => { setDraft(null); setPicking(true); }} hitSlop={10} activeOpacity={0.7}>
                <Text style={s.change}>Change</Text>
              </TouchableOpacity>
            </View>

            {draft.kind === 'MATERIAL' ? (
              <QtyRow
                value={draft.qty} onChange={(v) => setDraft({ ...draft, qty: v })}
                unit={draft.unit} onUnit={(u) => setDraft({ ...draft, unit: u })}
                units={entryUnitsFor(draft.material.unit)} autoFocus
              />
            ) : (
              <TextInput
                style={sheetStyles.input} value={draft.plates}
                onChangeText={(v) => setDraft({ ...draft, plates: v })}
                keyboardType="number-pad" placeholder="Plates" placeholderTextColor={C.textMuted} autoFocus
              />
            )}

            <FieldLabel>Reason</FieldLabel>
            <ReasonChips value={draft.reason} onChange={(r) => setDraft({ ...draft, reason: r })} />

            {draft.reason === 'OTHER' && (
              <TextInput
                style={[sheetStyles.input, { marginTop: Spacing.sm }]} value={draft.note}
                onChangeText={(v) => setDraft({ ...draft, note: v })}
                placeholder="What happened" placeholderTextColor={C.textMuted}
              />
            )}

            <TouchableOpacity style={s.addLine} onPress={() => { if (commitDraft()) setPicking(true); }} activeOpacity={0.8}>
              <Ionicons name="add" size={16} color={C.textSecondary} />
              <Text style={s.addLineText}>Add another line</Text>
            </TouchableOpacity>
          </View>
        ) : picking ? (
          <View style={s.picker}>
            <View style={s.tabs}>
              {(['MATERIAL', 'DISH'] as const).map((t) => (
                <TouchableOpacity
                  key={t} style={[s.tab, tab === t && s.tabOn]}
                  onPress={() => { setTab(t); setSearch(''); }} activeOpacity={0.8}
                >
                  <Text style={[s.tabText, tab === t && s.tabTextOn]}>{t === 'MATERIAL' ? 'Material' : 'Dish'}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={s.searchWrap}>
              <Ionicons name="search" size={16} color={C.textMuted} />
              <TextInput
                style={s.searchInput} value={search} onChangeText={setSearch}
                placeholder={tab === 'MATERIAL' ? 'Search materials' : 'Search dishes'}
                placeholderTextColor={C.textMuted}
              />
              {searching && <ActivityIndicator size="small" color={C.textMuted} />}
            </View>

            {rows.map((r) => (
              <TouchableOpacity key={r.key} style={s.pickRow} onPress={r.onPick} activeOpacity={0.75}>
                <Text style={s.pickName} numberOfLines={1}>{r.name}</Text>
                <Ionicons name="chevron-forward" size={15} color={C.textTertiary} />
              </TouchableOpacity>
            ))}

            {!searching && rows.length === 0 && (
              <Text style={s.pickEmpty}>
                {tab === 'DISH'
                  ? 'Only dishes with a recipe can be wasted as plates. The owner sets recipes.'
                  : 'Nothing matches.'}
              </Text>
            )}
          </View>
        ) : (
          <TouchableOpacity style={s.addLine} onPress={() => setPicking(true)} activeOpacity={0.8}>
            <Ionicons name="add" size={16} color={C.textSecondary} />
            <Text style={s.addLineText}>Add line</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      <View style={[s.footer, { paddingBottom: insets.bottom + Spacing.md }]}>
        <ErrorLine text={error} />
        <PrimaryButton
          label={built.length > 1 ? `Save ${built.length} lines` : 'Save'}
          onPress={save}
          busy={busy}
        />
      </View>
    </View>
  );
}

function newMaterialDraft(m: CrewMaterial): Draft {
  return { kind: 'MATERIAL', material: m, qty: '', unit: defaultEntryUnit(m.unit), reason: null, note: '' };
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.background },
  headerBar: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
  },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: C.textPrimary, fontSize: 17, fontWeight: '700' },
  headerSub: { color: C.textTertiary, fontSize: 11.5, marginTop: 1 },
  built: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md,
    borderRadius: Radius.md, borderWidth: 1, borderColor: C.border, marginBottom: Spacing.sm,
  },
  builtName: { color: C.textPrimary, fontSize: 14.5, fontWeight: '600' },
  builtDetail: { color: C.textSecondary, fontSize: 12.5, marginTop: 2 },
  draft: { borderRadius: Radius.md, borderWidth: 1, borderColor: C.borderStrong, padding: Spacing.md },
  draftHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.md, marginBottom: Spacing.sm },
  draftName: { flex: 1, color: C.textPrimary, fontSize: 15, fontWeight: '700' },
  change: { color: C.primary, fontSize: 13, fontWeight: '600' },
  picker: { borderRadius: Radius.md, borderWidth: 1, borderColor: C.border, padding: Spacing.md },
  tabs: { flexDirection: 'row', gap: Spacing.sm },
  tab: { flex: 1, paddingVertical: 9, borderRadius: Radius.md, borderWidth: 1, borderColor: C.border, alignItems: 'center' },
  tabOn: { backgroundColor: C.primarySoft, borderColor: C.primarySoftBorder },
  tabText: { color: C.textSecondary, fontSize: 13.5, fontWeight: '600' },
  tabTextOn: { color: C.primary },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: Spacing.md, marginBottom: Spacing.xs,
    paddingHorizontal: Spacing.md, height: 42,
    backgroundColor: C.surfaceMutedHover, borderRadius: Radius.md, borderWidth: 1, borderColor: C.border,
  },
  searchInput: { flex: 1, color: C.textPrimary, fontSize: 14 },
  pickRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: C.borderSubtle,
  },
  pickName: { flex: 1, color: C.textPrimary, fontSize: 14.5 },
  pickEmpty: { color: C.textMuted, fontSize: 12.5, lineHeight: 18, paddingVertical: Spacing.md },
  addLine: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: Radius.md, borderWidth: 1, borderColor: C.borderStrong,
    borderStyle: 'dashed', marginTop: Spacing.md,
  },
  addLineText: { color: C.textSecondary, fontSize: 13.5, fontWeight: '600' },
  footer: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    paddingHorizontal: Spacing.lg, paddingTop: Spacing.md,
    backgroundColor: C.background, borderTopWidth: 1, borderTopColor: C.border,
  },
});
