/**
 * The Menu linking tab's header (CREW_STOCK_PLAN.md §12).
 *
 * A flat alphabetical list of dish names answered neither question that matters
 * at 200 dishes: how much of the menu deducts anything at all, and where to
 * start. This answers both — a coverage bar per category, and the unlinked
 * dishes that are actually SELLING, because linking the twelfth dessert first is
 * wasted effort.
 *
 * The per-row chips that used to live here went with the switch to cards — a
 * card carries a material count, and you open a dish to see what is in it.
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { QuinckleColors as C, Radius, Spacing } from '../../constants/Colors';
import type { CrewLinkingOverview } from '../../services/api';

export function PriorityBanner({ priority, onPick }: {
  priority: CrewLinkingOverview['priority'];
  onPick: (menuItemId: string) => void;
}) {
  if (priority.dishes.length === 0) return null;
  const n = priority.dishes.length;
  return (
    <View style={s.prio}>
      <Text style={s.prioTitle}>Start with {n === 1 ? 'this one' : `these ${n}`}</Text>
      <Text style={s.prioSub}>
        Unlinked, and {priority.sharePct}% of what sold in the last {priority.days} days.
        Everything else can wait.
      </Text>
      <View style={s.prioList}>
        {priority.dishes.map((d) => (
          <TouchableOpacity key={d.menuItemId} style={s.prioChip} onPress={() => onPick(d.menuItemId)} activeOpacity={0.8}>
            <Text style={s.prioChipText} numberOfLines={1}>{d.name}</Text>
            <Text style={s.prioChipUnits}>{d.units}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

/** One category's linked-vs-total bar. Amber until it is finished, green when done. */
export function CoverageRow({ category, linked, total }: { category: string; linked: number; total: number }) {
  const pct = total > 0 ? Math.round((linked / total) * 100) : 0;
  const done = total > 0 && linked === total;
  return (
    <View style={s.covRow}>
      <Text style={s.covName} numberOfLines={1}>{category}</Text>
      <View style={s.bar}>
        <View style={[s.barFill, { width: `${pct}%`, backgroundColor: done ? C.success : C.warning }]} />
      </View>
      <Text style={s.covCount}>{linked}/{total}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  prio: {
    backgroundColor: C.warningSoft, borderWidth: 1, borderColor: C.warningBorder,
    borderRadius: Radius.md, padding: Spacing.md, marginBottom: Spacing.md,
  },
  prioTitle: { color: C.warning, fontSize: 12.5, fontWeight: '700' },
  prioSub: { color: C.textSecondary, fontSize: 11.5, lineHeight: 17, marginTop: 3 },
  prioList: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: Spacing.sm },
  prioChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%',
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
    borderRadius: Radius.pill, paddingHorizontal: Spacing.md, paddingVertical: 6,
  },
  prioChipText: { color: C.textPrimary, fontSize: 12.5, fontWeight: '600', flexShrink: 1 },
  prioChipUnits: { color: C.textTertiary, fontSize: 11, fontVariant: ['tabular-nums'] },
  covRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingTop: Spacing.lg, paddingBottom: 7 },
  covName: {
    color: C.textSecondary, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.9,
    textTransform: 'uppercase', maxWidth: '45%',
  },
  bar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: C.surfaceMutedHover, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 2 },
  covCount: { color: C.textTertiary, fontSize: 10.5, fontWeight: '600', fontVariant: ['tabular-nums'] },
});
