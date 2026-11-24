/**
 * Menu Activity filters: "Done by" (owner, a staffer, or Automatic) and a date
 * range (quick presets or any range picked on a calendar).
 *
 * The calendar is plain JS on purpose: a native date picker would change the
 * app's native fingerprint, and Menu Activity ships as an over-the-air update.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { QuinckleColors, Radius, Spacing, Typography } from '@/constants/Colors';
import { BottomSheet } from '@/components/menu-admin/BottomSheet';
import { adminHistory, type MenuActivityActor } from '@/services/menuAdmin';
import { ActorBadge } from '@/components/menu-admin/menuActivityShared';

// ── Done by ───────────────────────────────────────────────────────────────────

export type ActorFilter = { actorType: MenuActivityActor['actorType']; actorId: string | null; name: string } | null;

export function actorFilterLabel(f: ActorFilter): string {
  if (!f) return 'Anyone';
  return f.actorType === 'SYSTEM' ? 'Automatic' : f.name;
}

export function ActorSheet({
  visible,
  value,
  onClose,
  onPick,
}: {
  visible: boolean;
  value: ActorFilter;
  onClose: () => void;
  onPick: (f: ActorFilter) => void;
}) {
  const [actors, setActors] = useState<MenuActivityActor[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    let live = true;
    setError(null);
    adminHistory
      .actors()
      .then((res) => live && setActors(res.data))
      .catch((e: any) => live && setError(e?.message ?? 'Could not load people'));
    return () => {
      live = false;
    };
  }, [visible]);

  const pick = (f: ActorFilter) => {
    onPick(f);
    onClose();
  };
  const isOn = (a: MenuActivityActor) =>
    !!value && value.actorType === a.actorType && (a.actorType === 'SYSTEM' || value.actorId === a.actorId);

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Done by" maxHeightRatio={0.75}>
      <View style={styles.sheetBody}>
        <Option label="Anyone" on={!value} onPress={() => pick(null)} />
        {!actors && !error && <ActivityIndicator style={{ marginVertical: Spacing.lg }} color={QuinckleColors.primary} />}
        {error && <Text style={styles.error}>{error}</Text>}
        {actors?.map((a) => (
          <Option
            key={`${a.actorType}:${a.actorId ?? a.actorName}`}
            label={a.actorType === 'SYSTEM' ? 'Automatic' : a.actorName}
            sub={`${a.count} change${a.count === 1 ? '' : 's'}`}
            badge={<ActorBadge actorType={a.actorType} actorRole={a.actorRole} />}
            on={isOn(a)}
            onPress={() => pick({ actorType: a.actorType, actorId: a.actorId, name: a.actorName })}
          />
        ))}
      </View>
    </BottomSheet>
  );
}

// ── Date range ────────────────────────────────────────────────────────────────

export type DatePreset = 'ALL' | 'TODAY' | 'YESTERDAY' | '7D' | '30D' | 'MONTH' | 'CUSTOM';
export type DateFilter = { preset: DatePreset; start?: Date; end?: Date };
export const ALL_TIME: DateFilter = { preset: 'ALL' };

const PRESETS: { key: Exclude<DatePreset, 'CUSTOM'>; label: string }[] = [
  { key: 'ALL', label: 'All time' },
  { key: 'TODAY', label: 'Today' },
  { key: 'YESTERDAY', label: 'Yesterday' },
  { key: '7D', label: 'Last 7 days' },
  { key: '30D', label: 'Last 30 days' },
  { key: 'MONTH', label: 'This month' },
];

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
function sameDay(a?: Date, b?: Date): boolean {
  return !!a && !!b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function short(d: Date): string {
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/** The filter as an ISO window: `from` inclusive, `to` exclusive (local days). */
export function dateRange(f: DateFilter): { from: string | null; to: string | null } {
  const today = startOfDay(new Date());
  let from: Date | null = null;
  let to: Date | null = null;
  switch (f.preset) {
    case 'TODAY':
      from = today;
      break;
    case 'YESTERDAY':
      from = addDays(today, -1);
      to = today;
      break;
    case '7D':
      from = addDays(today, -6);
      break;
    case '30D':
      from = addDays(today, -29);
      break;
    case 'MONTH':
      from = new Date(today.getFullYear(), today.getMonth(), 1);
      break;
    case 'CUSTOM':
      if (f.start) from = startOfDay(f.start);
      if (f.end ?? f.start) to = addDays(startOfDay((f.end ?? f.start)!), 1);
      break;
  }
  return { from: from ? from.toISOString() : null, to: to ? to.toISOString() : null };
}

export function dateFilterLabel(f: DateFilter): string {
  if (f.preset !== 'CUSTOM') return PRESETS.find((p) => p.key === f.preset)!.label;
  if (!f.start) return 'All time';
  if (!f.end || sameDay(f.start, f.end)) return short(f.start);
  // "10–14 Nov" when both ends share a month, so the filter button stays readable.
  if (f.start.getFullYear() === f.end.getFullYear() && f.start.getMonth() === f.end.getMonth()) {
    return `${f.start.getDate()}–${short(f.end)}`;
  }
  return `${short(f.start)} – ${short(f.end)}`;
}

export function DateSheet({
  visible,
  value,
  onClose,
  onPick,
}: {
  visible: boolean;
  value: DateFilter;
  onClose: () => void;
  onPick: (f: DateFilter) => void;
}) {
  const [start, setStart] = useState<Date | undefined>(value.preset === 'CUSTOM' ? value.start : undefined);
  const [end, setEnd] = useState<Date | undefined>(value.preset === 'CUSTOM' ? value.end : undefined);

  useEffect(() => {
    if (!visible) return;
    setStart(value.preset === 'CUSTOM' ? value.start : undefined);
    setEnd(value.preset === 'CUSTOM' ? value.end : undefined);
  }, [visible, value]);

  const pickPreset = (key: Exclude<DatePreset, 'CUSTOM'>) => {
    onPick({ preset: key });
    onClose();
  };

  // First tap sets the start; the second sets the end (in either order).
  const tapDay = (d: Date) => {
    if (!start || end) {
      setStart(d);
      setEnd(undefined);
    } else if (d < start) {
      setEnd(start);
      setStart(d);
    } else {
      setEnd(d);
    }
  };

  const apply = () => {
    if (!start) return;
    onPick({ preset: 'CUSTOM', start, end: end ?? start });
    onClose();
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Date" maxHeightRatio={0.9}>
      <View style={styles.sheetBody}>
        <View style={styles.presets}>
          {PRESETS.map((p) => {
            const on = value.preset === p.key;
            return (
              <TouchableOpacity key={p.key} style={[styles.preset, on && styles.presetOn]} onPress={() => pickPreset(p.key)} activeOpacity={0.8}>
                <Text style={[styles.presetText, on && styles.presetTextOn]}>{p.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={styles.section}>Or pick dates</Text>
        <RangeCalendar start={start} end={end} onTap={tapDay} />
        <Text style={styles.rangeHint}>
          {!start ? 'Tap a day, then another to make a range' : !end ? `${short(start)} — tap an end day, or apply for just this day` : `${short(start)} – ${short(end)}`}
        </Text>
        <TouchableOpacity style={[styles.apply, !start && { opacity: 0.4 }]} disabled={!start} onPress={apply} activeOpacity={0.85}>
          <Text style={styles.applyText}>Apply dates</Text>
        </TouchableOpacity>
      </View>
    </BottomSheet>
  );
}

const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** Month grid, Monday first. Future days are disabled — nothing has happened yet. */
function RangeCalendar({ start, end, onTap }: { start?: Date; end?: Date; onTap: (d: Date) => void }) {
  const today = startOfDay(new Date());
  const [month, setMonth] = useState(() => {
    const anchor = start ?? today;
    return new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  });

  const cells = useMemo(() => {
    const lead = (month.getDay() + 6) % 7; // Monday = 0
    const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const out: (Date | null)[] = Array.from({ length: lead }, () => null);
    for (let i = 1; i <= days; i++) out.push(new Date(month.getFullYear(), month.getMonth(), i));
    while (out.length % 7) out.push(null);
    return out;
  }, [month]);

  const atCurrentMonth = month.getFullYear() === today.getFullYear() && month.getMonth() === today.getMonth();
  const inRange = (d: Date) => !!start && !!end && d > start && d < end;

  return (
    <View style={styles.cal}>
      <View style={styles.calHead}>
        <TouchableOpacity onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} style={styles.calNav} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={18} color={QuinckleColors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.calTitle}>{month.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</Text>
        <TouchableOpacity
          onPress={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
          style={[styles.calNav, atCurrentMonth && { opacity: 0.25 }]}
          disabled={atCurrentMonth}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-forward" size={18} color={QuinckleColors.textPrimary} />
        </TouchableOpacity>
      </View>
      {/* One row per week: a single wrapping row of 1/7-width cells can fit
          only six on some screen widths, sliding dates under the wrong weekday. */}
      <View style={styles.calRow}>
        {WEEKDAYS.map((w, i) => (
          <Text key={i} style={styles.calWeekday}>{w}</Text>
        ))}
      </View>
      {Array.from({ length: cells.length / 7 }, (_, w) => (
        <View key={w} style={styles.calRow}>
          {cells.slice(w * 7, w * 7 + 7).map((d, j) => {
            const i = w * 7 + j;
            if (!d) return <View key={i} style={styles.calCell} />;
            const future = d > today;
            const edge = sameDay(d, start) || sameDay(d, end);
            const mid = inRange(d);
            return (
              <TouchableOpacity key={i} style={styles.calCell} disabled={future} onPress={() => onTap(d)} activeOpacity={0.7}>
                <View style={[styles.calDay, mid && styles.calDayMid, edge && styles.calDayEdge]}>
                  <Text
                    style={[
                      styles.calDayText,
                      future && { color: QuinckleColors.textMuted, opacity: 0.4 },
                      sameDay(d, today) && !edge && { color: QuinckleColors.primary },
                      edge && { color: '#fff', fontWeight: '700' },
                    ]}
                  >
                    {d.getDate()}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </View>
  );
}

// ── Bits ──────────────────────────────────────────────────────────────────────

function Option({ label, sub, badge, on, onPress }: { label: string; sub?: string; badge?: React.ReactNode; on: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.option} onPress={onPress} activeOpacity={0.75}>
      <View style={{ flex: 1 }}>
        <View style={styles.optionTop}>
          <Text style={[styles.optionLabel, on && { color: QuinckleColors.primary }]} numberOfLines={1}>{label}</Text>
          {badge}
        </View>
        {sub && <Text style={styles.optionSub}>{sub}</Text>}
      </View>
      {on && <Ionicons name="checkmark" size={18} color={QuinckleColors.primary} />}
    </TouchableOpacity>
  );
}

/** The two filter buttons under the tabs, plus Clear when anything is set. */
export function FilterBar({
  actor,
  date,
  onActor,
  onDate,
  onClear,
}: {
  actor: ActorFilter;
  date: DateFilter;
  onActor: () => void;
  onDate: () => void;
  onClear: () => void;
}) {
  const anySet = !!actor || date.preset !== 'ALL';
  return (
    <View style={styles.bar}>
      <FilterButton icon="person-outline" label={actorFilterLabel(actor)} on={!!actor} onPress={onActor} />
      <FilterButton icon="calendar-outline" label={dateFilterLabel(date)} on={date.preset !== 'ALL'} onPress={onDate} />
      {anySet && (
        <TouchableOpacity onPress={onClear} style={styles.clear} activeOpacity={0.7}>
          <Text style={styles.clearText}>Clear</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function FilterButton({ icon, label, on, onPress }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; on: boolean; onPress: () => void }) {
  const color = on ? QuinckleColors.primary : QuinckleColors.textSecondary;
  return (
    <TouchableOpacity style={[styles.fbtn, on && styles.fbtnOn]} onPress={onPress} activeOpacity={0.8}>
      <Ionicons name={icon} size={14} color={color} />
      <Text style={[styles.fbtnText, { color }]} numberOfLines={1}>{label}</Text>
      <Ionicons name="chevron-down" size={12} color={color} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  // The sheet scrolls its own content; this only lines rows up with its title.
  sheetBody: { paddingHorizontal: Spacing.xl },
  error: { ...Typography.caption, color: QuinckleColors.danger, padding: Spacing.md },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: QuinckleColors.borderSubtle,
  },
  optionTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  optionLabel: { ...Typography.bodyStrong, color: QuinckleColors.textPrimary, flexShrink: 1 },
  optionSub: { ...Typography.caption, color: QuinckleColors.textMuted, marginTop: 2 },

  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  preset: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: Radius.pill, borderWidth: 1, borderColor: QuinckleColors.border },
  presetOn: { borderColor: QuinckleColors.primarySoftBorder, backgroundColor: QuinckleColors.primarySoft },
  presetText: { ...Typography.caption, color: QuinckleColors.textSecondary },
  presetTextOn: { color: QuinckleColors.primary, fontWeight: '600' },
  section: { ...Typography.micro, color: QuinckleColors.textMuted, marginTop: Spacing.lg, marginBottom: Spacing.sm, letterSpacing: 0.6, textTransform: 'uppercase' },

  cal: { borderWidth: 1, borderColor: QuinckleColors.border, borderRadius: Radius.lg, padding: Spacing.sm },
  calHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.xs },
  calNav: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  calTitle: { ...Typography.bodyStrong, color: QuinckleColors.textPrimary },
  calRow: { flexDirection: 'row' },
  calWeekday: { flex: 1, textAlign: 'center', ...Typography.micro, color: QuinckleColors.textMuted, paddingVertical: 4 },
  calCell: { flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  calDay: { width: '86%', height: '86%', borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center' },
  calDayMid: { backgroundColor: QuinckleColors.primarySoft, borderRadius: Radius.sm },
  calDayEdge: { backgroundColor: QuinckleColors.primary },
  calDayText: { ...Typography.caption, color: QuinckleColors.textPrimary },
  rangeHint: { ...Typography.caption, color: QuinckleColors.textSecondary, textAlign: 'center', marginTop: Spacing.sm },
  apply: { marginTop: Spacing.md, marginBottom: Spacing.sm, backgroundColor: QuinckleColors.primary, borderRadius: Radius.md, paddingVertical: 12, alignItems: 'center' },
  applyText: { ...Typography.bodyStrong, color: '#fff' },

  bar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: Spacing.sm },
  fbtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    maxWidth: '44%',
  },
  fbtnOn: { borderColor: QuinckleColors.primarySoftBorder, backgroundColor: QuinckleColors.primarySoft },
  fbtnText: { ...Typography.caption, flexShrink: 1 },
  clear: { marginLeft: 'auto', paddingHorizontal: 6, paddingVertical: 6 },
  clearText: { ...Typography.caption, color: QuinckleColors.primary },
});
