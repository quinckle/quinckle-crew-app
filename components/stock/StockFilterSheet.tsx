/**
 * Filter and sort for the materials ledger — the Segmented direction
 * (CREW_STOCK_PLAN.md §3).
 *
 * Filter is ONE exclusive choice out of four, which is exactly what a segmented
 * control is for, and putting it in a segment makes all four options and their
 * counts readable without opening anything else. Sort stays a list: three
 * options whose names are too long to segment.
 *
 * Unlike the rest of the sheets here, this one holds a DRAFT and commits on
 * Apply. Each change re-queries the list, so applying as you tap would fire
 * three requests for one decision — and the Apply button is where the outcome
 * gets stated in advance: "Show 3 materials".
 */

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheet } from '../ui/BottomSheet';
import { QuinckleColors as C, Radius, Spacing } from '../../constants/Colors';
import type { MaterialSort } from '../../services/api';

export type StockStateFilter = 'all' | 'alert' | 'low' | 'out';

/** Short enough to segment on a 390pt phone; the counts carry the detail. */
const FILTERS: { value: StockStateFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'alert', label: 'Attention' },
  { value: 'out', label: 'Out' },
  { value: 'low', label: 'Low' },
];

const SORTS: { value: MaterialSort; label: string; hint: string }[] = [
  { value: 'qty_asc', label: 'Least stock first', hint: 'What runs out next, at the top' },
  { value: 'qty_desc', label: 'Most stock first', hint: 'What you hold most of' },
  { value: 'name', label: 'A to Z', hint: 'By name' },
];

export function StockFilterSheet({ visible, filter, sort, counts, onClose, onApply }: {
  visible: boolean;
  filter: StockStateFilter;
  sort: MaterialSort;
  counts: { out: number; low: number; ok: number; total: number };
  onClose: () => void;
  onApply: (filter: StockStateFilter, sort: MaterialSort) => void;
}) {
  const [draftFilter, setDraftFilter] = useState(filter);
  const [draftSort, setDraftSort] = useState(sort);

  // Reopening after a cancel must show what is actually applied, not the draft
  // that was abandoned last time.
  useEffect(() => {
    if (!visible) return;
    setDraftFilter(filter);
    setDraftSort(sort);
  }, [visible, filter, sort]);

  const countFor = (f: StockStateFilter) =>
    f === 'all' ? counts.total : f === 'alert' ? counts.out + counts.low : f === 'out' ? counts.out : counts.low;

  const resulting = countFor(draftFilter);

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Filter and sort" maxHeightRatio={0.75}>
      <View style={s.body}>
        <Text style={s.group}>Show</Text>
        <View style={s.seg}>
          {FILTERS.map((f) => {
            const on = draftFilter === f.value;
            return (
              <TouchableOpacity
                key={f.value}
                style={[s.segItem, on && s.segItemOn]}
                onPress={() => setDraftFilter(f.value)}
                activeOpacity={0.85}
              >
                <Text style={[s.segLabel, on && s.segLabelOn]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
                  {f.label}
                </Text>
                <Text style={[s.segCount, on && s.segCountOn]} numberOfLines={1}>{countFor(f.value)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={s.group}>Sort</Text>
        {SORTS.map((o) => {
          const on = draftSort === o.value;
          return (
            <TouchableOpacity key={o.value} style={s.row} onPress={() => setDraftSort(o.value)} activeOpacity={0.75}>
              <View style={{ flex: 1 }}>
                <Text style={[s.name, on && s.nameOn]}>{o.label}</Text>
                <Text style={s.hint}>{o.hint}</Text>
              </View>
              {on && <Ionicons name="checkmark" size={18} color={C.primary} />}
            </TouchableOpacity>
          );
        })}

        <Text style={s.foot}>Out always sits above Running low, above Stocked — sorting orders the rows inside each.</Text>

        <TouchableOpacity style={s.apply} onPress={() => onApply(draftFilter, draftSort)} activeOpacity={0.85}>
          <Text style={s.applyText}>
            {resulting === 0 ? 'Nothing to show' : `Show ${resulting} material${resulting === 1 ? '' : 's'}`}
          </Text>
        </TouchableOpacity>
        <View style={{ height: Spacing.md }} />
      </View>
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  // BottomSheet indents its title and gives children nothing — every sheet in
  // this app supplies its own side padding.
  body: { paddingHorizontal: Spacing.xl },
  group: {
    color: C.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 0.8,
    textTransform: 'uppercase', marginTop: Spacing.sm, marginBottom: 8,
  },
  seg: {
    flexDirection: 'row', backgroundColor: C.surfaceMutedHover, borderRadius: Radius.md, padding: 3,
  },
  segItem: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: Radius.sm },
  segItemOn: { backgroundColor: C.primarySoft, borderWidth: 1, borderColor: C.primarySoftBorder, paddingVertical: 7 },
  segLabel: { color: C.textSecondary, fontSize: 12, fontWeight: '600' },
  segLabelOn: { color: C.primary },
  segCount: { color: C.textMuted, fontSize: 14, fontWeight: '700', marginTop: 2, fontVariant: ['tabular-nums'] },
  segCountOn: { color: C.primary },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: C.borderSubtle,
  },
  name: { color: C.textPrimary, fontSize: 15, fontWeight: '500' },
  nameOn: { fontWeight: '700' },
  hint: { color: C.textTertiary, fontSize: 11.5, marginTop: 2 },
  foot: { color: C.textMuted, fontSize: 11.5, lineHeight: 17, marginTop: Spacing.md },
  apply: {
    backgroundColor: C.primary, borderRadius: Radius.md, paddingVertical: 14,
    alignItems: 'center', marginTop: Spacing.lg,
  },
  applyText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
