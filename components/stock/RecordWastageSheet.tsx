/**
 * Record wastage — several lines in one go (CREW_STOCK_PLAN.md §3).
 *
 * The end-of-day write-off is one action, not eight: a line is either a MATERIAL
 * (a quantity) or a DISH (plates, whose whole recipe comes off stock). The sheet
 * has two stages — the lines you have built, and the one you are editing — so a
 * picker never has to open on top of a picker.
 *
 * Opened with `prefillMaterial` from a material's own Wastage button; it lands
 * straight on the edit stage with that material chosen.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheet } from '../ui/BottomSheet';
import { QuinckleColors as C, Radius, Spacing } from '../../constants/Colors';
import {
  UNIT_LABEL, entryUnitsFor, defaultEntryUnit, reasonLabel,
  type StockEntryUnit, type WastageReason,
} from '../../constants/stock';
import { crewStock, type CrewMaterial, type CrewWastageLine } from '../../services/api';
import { ErrorLine, FieldLabel, PrimaryButton, QtyRow, ReasonChips, sheetStyles } from './pieces';

type Draft =
  | { kind: 'MATERIAL'; material: CrewMaterial; qty: string; unit: StockEntryUnit; reason: WastageReason | null; note: string }
  | { kind: 'DISH'; dish: { menuItemId: string; name: string }; plates: string; reason: WastageReason | null; note: string };

type Built = { key: string; label: string; detail: string; line: CrewWastageLine };

export function RecordWastageSheet({ visible, materials, prefillMaterial, onClose, onDone }: {
  visible: boolean;
  materials: CrewMaterial[];
  prefillMaterial?: CrewMaterial | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [built, setBuilt] = useState<Built[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [picking, setPicking] = useState(false);
  const [search, setSearch] = useState('');
  const [dishes, setDishes] = useState<{ menuItemId: string; name: string }[] | null>(null);
  const [tab, setTab] = useState<'MATERIAL' | 'DISH'>('MATERIAL');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setBuilt([]); setSearch(''); setError(null); setTab('MATERIAL');
    if (prefillMaterial) {
      setDraft(newMaterialDraft(prefillMaterial));
      setPicking(false);
    } else {
      setDraft(null);
      setPicking(true);
    }
  }, [visible, prefillMaterial]);

  // Dishes are only fetched when someone actually opens that tab — most wastage
  // is raw material, and the list is a second round trip.
  useEffect(() => {
    if (tab === 'DISH' && dishes === null) {
      crewStock.dishes()
        .then((r) => setDishes((r.data ?? []).map((d) => ({ menuItemId: d.menuItemId, name: d.name }))))
        .catch(() => setDishes([]));
    }
  }, [tab, dishes]);

  const filteredMaterials = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? materials.filter((m) => m.name.toLowerCase().includes(q)) : materials;
  }, [materials, search]);

  const filteredDishes = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = dishes ?? [];
    return q ? all.filter((d) => d.name.toLowerCase().includes(q)) : all;
  }, [dishes, search]);

  const commitDraft = () => {
    if (!draft) return false;
    if (!draft.reason) { setError('Pick a reason'); return false; }
    if (draft.kind === 'MATERIAL') {
      const n = Number(draft.qty);
      if (!Number.isFinite(n) || n <= 0) { setError('Enter how much was wasted'); return false; }
      setBuilt((b) => [...b, {
        key: `${Date.now()}-${b.length}`,
        label: draft.material.name,
        detail: `${n} ${UNIT_LABEL[draft.unit]} · ${reasonLabel(draft.reason!)}`,
        line: { kind: 'MATERIAL', stockItemId: draft.material.id, qty: n, unit: draft.unit, reason: draft.reason!, note: draft.note.trim() || null },
      }]);
    } else {
      const n = Number(draft.plates);
      if (!Number.isFinite(n) || n <= 0) { setError('Enter how many plates'); return false; }
      setBuilt((b) => [...b, {
        key: `${Date.now()}-${b.length}`,
        label: draft.dish.name,
        detail: `${n} plate${n === 1 ? '' : 's'} · ${reasonLabel(draft.reason!)} · whole recipe comes off`,
        line: { kind: 'DISH', menuItemId: draft.dish.menuItemId, plates: n, reason: draft.reason!, note: draft.note.trim() || null },
      }]);
    }
    setDraft(null); setError(null); setSearch('');
    return true;
  };

  const save = async () => {
    // A half-typed line on screen counts — saving with it unwritten is the
    // easiest way to lose an entry someone thought they had recorded.
    let lines = built.map((b) => b.line);
    if (draft) {
      if (!commitDraft()) return;
      lines = [...lines, lastLineFromDraft(draft)];
    }
    if (lines.length === 0) { setError('Add a line first'); return; }
    setBusy(true); setError(null);
    try {
      await crewStock.recordWastage(lines);
      onDone(`${lines.length} ${lines.length === 1 ? 'entry' : 'entries'} recorded`);
    } catch (e: any) {
      setError(e?.message ?? 'Could not record the wastage');
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Record wastage">
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {built.map((b) => (
          <View key={b.key} style={st.builtRow}>
            <View style={{ flex: 1 }}>
              <Text style={st.builtName}>{b.label}</Text>
              <Text style={st.builtDetail}>{b.detail}</Text>
            </View>
            <TouchableOpacity onPress={() => setBuilt((x) => x.filter((y) => y.key !== b.key))} hitSlop={8} activeOpacity={0.7}>
              <Ionicons name="close" size={16} color={C.textTertiary} />
            </TouchableOpacity>
          </View>
        ))}

        {draft ? (
          <View style={st.draft}>
            <View style={st.draftHead}>
              <Text style={st.draftName}>{draft.kind === 'MATERIAL' ? draft.material.name : draft.dish.name}</Text>
              <TouchableOpacity onPress={() => { setDraft(null); setPicking(true); }} hitSlop={8} activeOpacity={0.7}>
                <Text style={st.changeText}>Change</Text>
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
                style={sheetStyles.input} value={draft.plates} onChangeText={(v) => setDraft({ ...draft, plates: v })}
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

            <TouchableOpacity style={st.addLine} onPress={() => { if (commitDraft()) setPicking(true); }} activeOpacity={0.8}>
              <Ionicons name="add" size={16} color={C.textSecondary} />
              <Text style={st.addLineText}>Add another line</Text>
            </TouchableOpacity>
          </View>
        ) : picking ? (
          <View style={st.picker}>
            <View style={st.tabs}>
              {(['MATERIAL', 'DISH'] as const).map((t) => (
                <TouchableOpacity key={t} style={[st.tab, tab === t && st.tabOn]} onPress={() => { setTab(t); setSearch(''); }} activeOpacity={0.8}>
                  <Text style={[st.tabText, tab === t && st.tabTextOn]}>{t === 'MATERIAL' ? 'Material' : 'Dish'}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TextInput
              style={[sheetStyles.input, { marginTop: Spacing.md }]} value={search} onChangeText={setSearch}
              placeholder={tab === 'MATERIAL' ? 'Search materials' : 'Search dishes'} placeholderTextColor={C.textMuted}
            />

            {tab === 'DISH' && dishes === null ? (
              <ActivityIndicator color={C.primary} style={{ marginVertical: Spacing.lg }} />
            ) : (
              <View style={{ marginTop: Spacing.sm }}>
                {(tab === 'MATERIAL' ? filteredMaterials.slice(0, 8) : filteredDishes.slice(0, 8)).map((row: any) => (
                  <TouchableOpacity
                    key={tab === 'MATERIAL' ? row.id : row.menuItemId}
                    style={st.pickRow}
                    activeOpacity={0.75}
                    onPress={() => {
                      setDraft(tab === 'MATERIAL'
                        ? newMaterialDraft(row as CrewMaterial)
                        : { kind: 'DISH', dish: row, plates: '', reason: null, note: '' });
                      setPicking(false); setError(null);
                    }}
                  >
                    <Text style={st.pickName}>{row.name}</Text>
                    <Ionicons name="chevron-forward" size={15} color={C.textTertiary} />
                  </TouchableOpacity>
                ))}
                {tab === 'DISH' && filteredDishes.length === 0 && (
                  <Text style={sheetStyles.hint}>Only dishes that have a recipe can be wasted as plates. The owner sets recipes.</Text>
                )}
              </View>
            )}
          </View>
        ) : (
          <TouchableOpacity style={st.addLine} onPress={() => setPicking(true)} activeOpacity={0.8}>
            <Ionicons name="add" size={16} color={C.textSecondary} />
            <Text style={st.addLineText}>Add line</Text>
          </TouchableOpacity>
        )}

        <ErrorLine text={error} />
        <PrimaryButton label={built.length > 1 ? `Save ${built.length} lines` : 'Save'} onPress={save} busy={busy} />
        <View style={{ height: Spacing.xl }} />
      </ScrollView>
    </BottomSheet>
  );
}

function newMaterialDraft(m: CrewMaterial): Draft {
  return { kind: 'MATERIAL', material: m, qty: '', unit: defaultEntryUnit(m.unit), reason: null, note: '' };
}

/** The line `commitDraft` just pushed — rebuilt so `save` can send it without a re-render. */
function lastLineFromDraft(draft: Draft): CrewWastageLine {
  return draft.kind === 'MATERIAL'
    ? { kind: 'MATERIAL', stockItemId: draft.material.id, qty: Number(draft.qty), unit: draft.unit, reason: draft.reason!, note: draft.note.trim() || null }
    : { kind: 'DISH', menuItemId: draft.dish.menuItemId, plates: Number(draft.plates), reason: draft.reason!, note: draft.note.trim() || null };
}

const st = StyleSheet.create({
  builtRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md,
    borderRadius: Radius.md, borderWidth: 1, borderColor: C.border, marginBottom: Spacing.sm,
  },
  builtName: { color: C.textPrimary, fontSize: 14.5, fontWeight: '600' },
  builtDetail: { color: C.textSecondary, fontSize: 12.5, marginTop: 2 },
  draft: { borderRadius: Radius.md, borderWidth: 1, borderColor: C.borderStrong, padding: Spacing.md },
  draftHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm },
  draftName: { color: C.textPrimary, fontSize: 15, fontWeight: '700' },
  changeText: { color: C.primary, fontSize: 13, fontWeight: '600' },
  picker: { borderRadius: Radius.md, borderWidth: 1, borderColor: C.border, padding: Spacing.md },
  tabs: { flexDirection: 'row', gap: Spacing.sm },
  tab: { flex: 1, paddingVertical: 9, borderRadius: Radius.md, borderWidth: 1, borderColor: C.border, alignItems: 'center' },
  tabOn: { backgroundColor: C.primarySoft, borderColor: C.primarySoftBorder },
  tabText: { color: C.textSecondary, fontSize: 13.5, fontWeight: '600' },
  tabTextOn: { color: C.primary },
  pickRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: C.borderSubtle,
  },
  pickName: { color: C.textPrimary, fontSize: 14.5 },
  addLine: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: Radius.md, borderWidth: 1, borderColor: C.borderStrong,
    borderStyle: 'dashed', marginTop: Spacing.md,
  },
  addLineText: { color: C.textSecondary, fontSize: 13.5, fontWeight: '600' },
});
