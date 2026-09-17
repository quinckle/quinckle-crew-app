/**
 * Recipe — which materials a dish uses, and how much (CREW_STOCK_PLAN.md §3).
 *
 * This is the screen that makes every other number true: until a dish is linked,
 * selling it deducts nothing. It lives under the STOCK capability because it
 * changes no menu content — not the name, not the price, not availability — only
 * how much stock a sale takes out.
 *
 * Amounts are typed in the material's kitchen unit and sent as such; the server
 * converts to base units. No ₹ anywhere: cost per plate and food-cost % are the
 * owner's view of this same data.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { crewStock, type CrewMaterial } from '../../../../services/api';
import { QuinckleColors as C, Radius, Spacing } from '../../../../constants/Colors';
import {
  entryUnitsFor, defaultEntryUnit, fmtQty, fromBase, toBase, type StockEntryUnit,
} from '../../../../constants/stock';
import { ErrorLine, PrimaryButton, QtyRow } from '../../../../components/stock/pieces';
import { MaterialPickerSheet } from '../../../../components/stock/MaterialPickerSheet';

type Line = {
  stockItemId: string;
  name: string;
  /** The material's base unit — what `inStock` is measured in. */
  base: 'GRAM' | 'ML' | 'PCS';
  qty: string;
  unit: StockEntryUnit;
  inStock: number;
};

export default function RecipeScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [name, setName] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [materials, setMaterials] = useState<CrewMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!id) return;
    Promise.all([crewStock.recipe(id), crewStock.materials()])
      .then(([r, m]) => {
        setName(r.data?.name ?? '');
        setMaterials(m.data?.items ?? []);
        setLines((r.data?.lines ?? []).map((l) => {
          // Stored in base units; shown in the unit a kitchen says out loud, so
          // a 150 g line reads "150 g" and a 2 kg line reads "2 kg".
          const entry = fromBase(l.qty, l.unit);
          return {
            stockItemId: l.stockItemId,
            name: l.name,
            base: l.unit,
            qty: String(entry.qty),
            unit: entry.unit,
            inStock: l.inStock,
          };
        }));
        setFailed(false);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const addMaterial = (m: CrewMaterial) => {
    setPicking(false);
    setError(null);
    setLines((ls) => [...ls, {
      stockItemId: m.id, name: m.name, base: m.unit,
      qty: '', unit: defaultEntryUnit(m.unit), inStock: m.currentQty,
    }]);
  };

  const save = async () => {
    if (!id) return;
    const payload: { stockItemId: string; qty: number; unit: StockEntryUnit }[] = [];
    for (const l of lines) {
      const n = Number(l.qty);
      if (!Number.isFinite(n) || n <= 0) { setError(`Enter how much ${l.name} one plate uses`); return; }
      payload.push({ stockItemId: l.stockItemId, qty: n, unit: l.unit });
    }
    setBusy(true); setError(null);
    try {
      await crewStock.setRecipe(id, payload);
      router.back();
    } catch (e: any) {
      setError(e?.message ?? 'Could not save the recipe');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <View style={[s.container, s.center, { paddingTop: insets.top }]}><ActivityIndicator color={C.primary} /></View>;
  }

  if (failed) {
    return (
      <View style={[s.container, s.center, { paddingTop: insets.top }]}>
        <Text style={s.empty}>Could not load this dish.</Text>
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
        <Text style={s.headerTitle} numberOfLines={1}>{name}</Text>
        <View style={s.iconBtn} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: Spacing.lg, paddingBottom: insets.bottom + 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={s.lede}>What one plate uses. Selling it takes this much out of stock.</Text>

        {lines.length === 0 && (
          <Text style={s.empty}>Nothing linked yet — this dish takes nothing out of stock when it sells.</Text>
        )}

        {lines.map((l, i) => (
          <View key={l.stockItemId} style={s.line}>
            <View style={s.lineHead}>
              <Text style={s.lineName} numberOfLines={1}>{l.name}</Text>
              <TouchableOpacity
                onPress={() => setLines((ls) => ls.filter((x) => x.stockItemId !== l.stockItemId))}
                hitSlop={10} activeOpacity={0.7}
              >
                <Ionicons name="close" size={16} color={C.textTertiary} />
              </TouchableOpacity>
            </View>

            {/* Same dropdown as every other quantity in the section — a chip
                per unit stopped fitting once weight had six of them. */}
            <QtyRow
              value={l.qty}
              onChange={(v) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: v } : x)))}
              unit={l.unit}
              onUnit={(u) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, unit: u } : x)))}
              units={entryUnitsFor(l.base)}
            />

            <Text style={s.lineMeta}>
              {fmtQty(l.inStock, l.base)} in stock
              {Number(l.qty) > 0 && toBase(Number(l.qty), l.unit) > 0
                ? ` · about ${Math.floor(l.inStock / toBase(Number(l.qty), l.unit))} plates left`
                : ''}
            </Text>
          </View>
        ))}

        <TouchableOpacity style={s.add} onPress={() => setPicking(true)} activeOpacity={0.8}>
          <Ionicons name="add" size={16} color={C.textSecondary} />
          <Text style={s.addText}>Add material</Text>
        </TouchableOpacity>

        <ErrorLine text={error} />
        <PrimaryButton label="Save recipe" onPress={save} busy={busy} />
      </ScrollView>

      <MaterialPickerSheet
        visible={picking}
        materials={materials}
        exclude={lines.map((l) => l.stockItemId)}
        onClose={() => setPicking(false)}
        onPick={addMaterial}
      />
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
  lede: { color: C.textSecondary, fontSize: 13, lineHeight: 19, marginBottom: Spacing.lg },
  line: { borderRadius: Radius.md, borderWidth: 1, borderColor: C.border, padding: Spacing.md, marginBottom: Spacing.sm },
  lineHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm },
  lineName: { flex: 1, color: C.textPrimary, fontSize: 14.5, fontWeight: '600' },
  lineMeta: { color: C.textTertiary, fontSize: 11.5, marginTop: 6 },
  add: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: Radius.md, borderWidth: 1, borderColor: C.borderStrong,
    borderStyle: 'dashed', marginTop: Spacing.sm,
  },
  addText: { color: C.textSecondary, fontSize: 13.5, fontWeight: '600' },
  empty: { color: C.textMuted, fontSize: 13.5, marginBottom: Spacing.md, lineHeight: 19 },
  retry: { marginTop: Spacing.lg, paddingHorizontal: Spacing.xl, paddingVertical: 10, borderRadius: Radius.md, borderWidth: 1, borderColor: C.border },
  retryText: { color: C.textPrimary, fontSize: 14, fontWeight: '600' },
});
