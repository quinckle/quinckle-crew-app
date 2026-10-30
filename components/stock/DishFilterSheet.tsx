/**
 * Filter for the Menu linking tab (CREW_STOCK_PLAN.md §12).
 *
 * Same shape as the materials filter: one control beside the search box, a
 * bottom sheet behind it, a draft committed by an Apply button that states the
 * outcome. A row of course chips was fine for four courses and unreadable for
 * fifteen — a sheet scrolls.
 *
 * "Amounts to confirm" lives here too. The bulk linker can create dozens of
 * estimated amounts in one save, and until now nothing in the app could list
 * them back.
 */

import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheet } from '../ui/BottomSheet';
import { QuinckleColors as C, Radius, Spacing } from '../../constants/Colors';
import type { CrewLinkingOverview } from '../../services/api';

export type DishFilter = 'all' | 'without' | 'estimated';

const SHOW: { value: DishFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'without', label: 'Not linked' },
  { value: 'estimated', label: 'To confirm' },
];

export function DishFilterSheet({ visible, filter, category, overview, estimatedCount, onClose, onApply }: {
  visible: boolean;
  filter: DishFilter;
  /** null = every course. */
  category: string | null;
  overview: CrewLinkingOverview | null;
  /** How many dishes carry an unconfirmed amount, for the segment. */
  estimatedCount: number;
  onClose: () => void;
  onApply: (filter: DishFilter, category: string | null) => void;
}) {
  const [draftFilter, setDraftFilter] = useState(filter);
  const [draftCategory, setDraftCategory] = useState(category);

  useEffect(() => {
    if (!visible) return;
    setDraftFilter(filter);
    setDraftCategory(category);
  }, [visible, filter, category]);

  const coverage = overview?.coverage ?? [];
  const chosen = draftCategory ? coverage.find((c) => c.category === draftCategory) : null;
  // What Apply will show: the course's dish count, or the whole menu's.
  const resulting = draftFilter === 'all'
    ? (chosen ? chosen.total : overview?.total ?? 0)
    : draftFilter === 'without'
      ? (chosen ? chosen.total - chosen.linked : (overview?.total ?? 0) - (overview?.linked ?? 0))
      : estimatedCount;

  const countFor = (f: DishFilter) =>
    f === 'all' ? overview?.total ?? 0
      : f === 'without' ? (overview?.total ?? 0) - (overview?.linked ?? 0)
        : estimatedCount;

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Filter dishes" maxHeightRatio={0.8}>
      <View style={s.body}>
        <Text style={s.group}>Show</Text>
        <View style={s.seg}>
          {SHOW.map((o) => {
            const on = draftFilter === o.value;
            return (
              <TouchableOpacity
                key={o.value}
                style={[s.segItem, on && s.segItemOn]}
                onPress={() => setDraftFilter(o.value)}
                activeOpacity={0.85}
              >
                <Text style={[s.segLabel, on && s.segLabelOn]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
                  {o.label}
                </Text>
                <Text style={[s.segCount, on && s.segCountOn]}>{countFor(o.value)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {draftFilter === 'estimated' && (
          <Text style={s.note}>
            Amounts that came from a bulk link and were never checked against the dish. Opening one and
            typing over the number confirms it.
          </Text>
        )}

        <Text style={s.group}>Course</Text>
      </View>

      <ScrollView style={s.list} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={s.body}>
          <TouchableOpacity style={s.row} onPress={() => setDraftCategory(null)} activeOpacity={0.75}>
            <Text style={[s.name, draftCategory === null && s.nameOn]}>Every course</Text>
            <Text style={s.count}>{overview?.linked ?? 0}/{overview?.total ?? 0}</Text>
            {draftCategory === null && <Ionicons name="checkmark" size={18} color={C.primary} />}
          </TouchableOpacity>
          {coverage.map((c) => {
            const on = draftCategory === c.category;
            const done = c.total > 0 && c.linked === c.total;
            return (
              <TouchableOpacity key={c.category} style={s.row} onPress={() => setDraftCategory(c.category)} activeOpacity={0.75}>
                <Text style={[s.name, on && s.nameOn]} numberOfLines={1}>{c.category}</Text>
                <Text style={[s.count, done && { color: C.success }]}>{c.linked}/{c.total}</Text>
                {on && <Ionicons name="checkmark" size={18} color={C.primary} />}
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      <View style={s.body}>
        <TouchableOpacity style={s.apply} onPress={() => onApply(draftFilter, draftCategory)} activeOpacity={0.85}>
          <Text style={s.applyText}>
            {resulting === 0 ? 'Nothing to show' : `Show ${resulting} dish${resulting === 1 ? '' : 'es'}`}
          </Text>
        </TouchableOpacity>
        <View style={{ height: Spacing.md }} />
      </View>
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  // BottomSheet pads its title and nothing else.
  body: { paddingHorizontal: Spacing.xl },
  list: { maxHeight: 240 },
  group: {
    color: C.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 0.8,
    textTransform: 'uppercase', marginTop: Spacing.sm, marginBottom: 8,
  },
  seg: { flexDirection: 'row', backgroundColor: C.surfaceMutedHover, borderRadius: Radius.md, padding: 3 },
  segItem: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: Radius.sm },
  segItemOn: { backgroundColor: C.primarySoft, borderWidth: 1, borderColor: C.primarySoftBorder, paddingVertical: 7 },
  segLabel: { color: C.textSecondary, fontSize: 12, fontWeight: '600' },
  segLabelOn: { color: C.primary },
  segCount: { color: C.textMuted, fontSize: 14, fontWeight: '700', marginTop: 2, fontVariant: ['tabular-nums'] },
  segCountOn: { color: C.primary },
  note: { color: C.textTertiary, fontSize: 11.5, lineHeight: 17, marginTop: 8 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: C.borderSubtle,
  },
  name: { flex: 1, color: C.textPrimary, fontSize: 15, fontWeight: '500' },
  nameOn: { fontWeight: '700' },
  count: { color: C.textSecondary, fontSize: 12.5, fontWeight: '600', fontVariant: ['tabular-nums'] },
  apply: {
    backgroundColor: C.primary, borderRadius: Radius.md, paddingVertical: 14,
    alignItems: 'center', marginTop: Spacing.lg,
  },
  applyText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
