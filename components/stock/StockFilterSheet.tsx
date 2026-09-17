/**
 * Filter and sort for the materials ledger (CREW_STOCK_PLAN.md §3).
 *
 * A sheet rather than two icon buttons: the icons carried their state in a tint
 * nobody reads mid-shift, and there was no way to see what was applied without
 * decoding them. Here every option is named, the applied ones are ticked, and
 * the list re-queries the moment one is tapped — no Apply button to forget.
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheet } from '../ui/BottomSheet';
import { QuinckleColors as C, Spacing } from '../../constants/Colors';
import type { MaterialSort } from '../../services/api';

export type StockStateFilter = 'all' | 'alert' | 'low' | 'out';

const FILTERS: { value: StockStateFilter; label: string; hint: string }[] = [
  { value: 'all', label: 'Everything', hint: 'All three sections' },
  { value: 'alert', label: 'Needs attention', hint: 'Out and running low' },
  { value: 'out', label: 'Out only', hint: 'Nothing left' },
  { value: 'low', label: 'Running low only', hint: 'At or below its low level' },
];

const SORTS: { value: MaterialSort; label: string; hint: string }[] = [
  { value: 'qty_asc', label: 'Least stock first', hint: 'What runs out next, at the top' },
  { value: 'qty_desc', label: 'Most stock first', hint: 'What you hold most of' },
  { value: 'name', label: 'A to Z', hint: 'By name' },
];

export function StockFilterSheet({ visible, filter, sort, counts, onClose, onFilter, onSort }: {
  visible: boolean;
  filter: StockStateFilter;
  sort: MaterialSort;
  counts: { out: number; low: number; ok: number; total: number };
  onClose: () => void;
  onFilter: (f: StockStateFilter) => void;
  onSort: (s: MaterialSort) => void;
}) {
  const countFor = (f: StockStateFilter) =>
    f === 'all' ? counts.total : f === 'alert' ? counts.out + counts.low : f === 'out' ? counts.out : counts.low;

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Filter and sort" maxHeightRatio={0.8}>
      <Text style={s.group}>Show</Text>
      {FILTERS.map((f) => (
        <TouchableOpacity key={f.value} style={s.row} onPress={() => onFilter(f.value)} activeOpacity={0.75}>
          <View style={{ flex: 1 }}>
            <Text style={[s.label, filter === f.value && s.labelOn]}>{f.label}</Text>
            <Text style={s.hint}>{f.hint}</Text>
          </View>
          <Text style={s.count}>{countFor(f.value)}</Text>
          {filter === f.value && <Ionicons name="checkmark" size={18} color={C.primary} />}
        </TouchableOpacity>
      ))}

      <Text style={s.group}>Sort within each section</Text>
      {SORTS.map((o) => (
        <TouchableOpacity key={o.value} style={s.row} onPress={() => onSort(o.value)} activeOpacity={0.75}>
          <View style={{ flex: 1 }}>
            <Text style={[s.label, sort === o.value && s.labelOn]}>{o.label}</Text>
            <Text style={s.hint}>{o.hint}</Text>
          </View>
          {sort === o.value && <Ionicons name="checkmark" size={18} color={C.primary} />}
        </TouchableOpacity>
      ))}

      <Text style={s.foot}>Out always sits above Running low, above Stocked — sorting orders the rows inside each.</Text>
      <View style={{ height: Spacing.xl }} />
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  group: {
    color: C.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 0.8,
    textTransform: 'uppercase', marginTop: Spacing.md, marginBottom: 4,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: C.borderSubtle,
  },
  label: { color: C.textPrimary, fontSize: 15, fontWeight: '500' },
  labelOn: { fontWeight: '700' },
  hint: { color: C.textTertiary, fontSize: 11.5, marginTop: 2 },
  count: { color: C.textSecondary, fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  foot: { color: C.textMuted, fontSize: 11.5, lineHeight: 17, marginTop: Spacing.lg },
});
