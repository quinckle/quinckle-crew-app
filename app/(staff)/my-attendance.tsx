/**
 * My Attendance — a staffer's own days (concept A, chosen 2026-11-19).
 *
 * Today card → range chips → summary → month calendar. Tapping a day opens a
 * sheet with clock in / clock out / total and every punch with where it came
 * from (self at the station, owner from the Partner app, or auto-closed).
 *
 * Load-bearing rule from the backend: a day with NO record is not an absence.
 * Only an explicit ABSENT row is shown as absent; empty past days are neutral.
 *
 * All dates are IST business dates (YYYY-MM-DD) as the server returns them.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';
import { BottomSheet } from '../../components/ui/BottomSheet';
import { RangeCalendar } from '../../components/ui/RangeCalendar';
import {
  crewMyAttendance,
  type MyAttendanceData,
  type MyAttendanceDay,
  type MyAttendancePunch,
} from '../../services/api';

// ── Colours: green = in, blue = out; leave teal and owner violet so neither
//    is confused with a blue clock-out. ──────────────────────────────────────
const C = {
  in: QuinckleColors.success,
  out: QuinckleColors.info,
  half: QuinckleColors.warning,
  absent: QuinckleColors.danger,
  leave: '#2DD4BF',
  leaveSoft: 'rgba(45,212,191,0.12)',
  leaveBorder: 'rgba(45,212,191,0.40)',
  owner: '#C4B5FD',
  ownerSoft: 'rgba(167,139,250,0.14)',
};
const MAX_RANGE_DAYS = 93;
const IST_MS = 330 * 60_000;
const DAY_MS = 86_400_000;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ── Date helpers (keys are YYYY-MM-DD; maths in UTC so the phone's zone is irrelevant)
const pad = (n: number) => String(n).padStart(2, '0');
const keyOf = (y: number, m0: number, d: number) => `${y}-${pad(m0 + 1)}-${pad(d)}`;
const parseKey = (k: string) => { const [y, m, d] = k.split('-').map(Number); return { y, m0: m - 1, d }; };
const keyMs = (k: string) => { const p = parseKey(k); return Date.UTC(p.y, p.m0, p.d); };
const msKey = (ms: number) => { const d = new Date(ms); return keyOf(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
const addDays = (k: string, n: number) => msKey(keyMs(k) + n * DAY_MS);
const dowOf = (k: string) => new Date(keyMs(k)).getUTCDay();
const istTodayKey = () => msKey(Date.now() + IST_MS);
const daysInMonth = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
const localToKey = (d: Date) => keyOf(d.getFullYear(), d.getMonth(), d.getDate());
const keyToLocal = (k: string) => { const p = parseKey(k); return new Date(p.y, p.m0, p.d); };
const shortDate = (k: string) => { const p = parseKey(k); return `${p.d} ${MON_SHORT[p.m0]}`; };
const longDate = (k: string) => { const p = parseKey(k); return `${DOW[dowOf(k)]}, ${p.d} ${MON_SHORT[p.m0]} ${p.y}`; };

function fmtTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + IST_MS);
  let h = d.getUTCHours();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${pad(d.getUTCMinutes())} ${ap}`;
}
const fmtDur = (min: number) => `${Math.floor(min / 60)}h ${pad(Math.max(0, Math.round(min % 60)))}m`;

// ── Day derivations ───────────────────────────────────────────────────────────
type Shown = 'P' | 'H' | 'A' | 'L' | 'T';
const isOpen = (day?: MyAttendanceDay) => !!day && day.punches.length > 0 && day.punches[day.punches.length - 1].kind === 'IN';

/** Closed minutes from the server, plus the running segment if still on shift. */
function workedNow(day: MyAttendanceDay, now: number): number {
  const closed = day.workedMinutes ?? 0;
  if (!isOpen(day)) {
    if (day.workedMinutes == null && day.checkInAt && day.checkOutAt) {
      // Owner-marked day with times but no punch log.
      return (new Date(day.checkOutAt).getTime() - new Date(day.checkInAt).getTime()) / 60_000;
    }
    return closed;
  }
  const lastIn = new Date(day.punches[day.punches.length - 1].at).getTime();
  return closed + Math.max(0, (now - lastIn) / 60_000);
}

function shownStatus(day: MyAttendanceDay, todayKey: string): Shown {
  if (day.date === todayKey && isOpen(day)) return 'T';
  return ({ PRESENT: 'P', HALF_DAY: 'H', ABSENT: 'A', LEAVE: 'L' } as const)[day.status];
}

type SrcKind = 'self' | 'owner' | 'auto';
function punchSource(p: MyAttendancePunch): { label: string; icon: React.ComponentProps<typeof Ionicons>['name']; kind: SrcKind } {
  if (p.source === 'AUTO_CLOSE' || p.method === 'SYSTEM') return { label: 'Auto-closed by system', icon: 'time-outline', kind: 'auto' };
  if (p.source === 'OWNER_EDIT' || p.method === 'OWNER_MARKED') return { label: 'Owner · Partner app', icon: 'person-outline', kind: 'owner' };
  switch (p.method) {
    case 'STATION_QR': return { label: 'Self · Station QR', icon: 'qr-code-outline', kind: 'self' };
    case 'STATION_FACE': return { label: 'Self · Face at station', icon: 'scan-outline', kind: 'self' };
    case 'GEOFENCE': return { label: 'Self · Location', icon: 'location-outline', kind: 'self' };
    default: return { label: 'Self · PIN at station', icon: 'keypad-outline', kind: 'self' };
  }
}

const STATUS_META: Record<Shown, { label: string; color: string; soft: string; border: string }> = {
  P: { label: 'Present', color: C.in, soft: QuinckleColors.successSoft, border: QuinckleColors.successBorder },
  H: { label: 'Half day', color: C.half, soft: QuinckleColors.warningSoft, border: QuinckleColors.warningBorder },
  A: { label: 'Absent', color: C.absent, soft: QuinckleColors.dangerSoft, border: QuinckleColors.dangerBorder },
  L: { label: 'Leave', color: C.leave, soft: C.leaveSoft, border: C.leaveBorder },
  T: { label: 'On shift', color: QuinckleColors.primary, soft: QuinckleColors.primarySoft, border: QuinckleColors.primarySoftBorder },
};

// ── Data ──────────────────────────────────────────────────────────────────────
type Fetched = { data: MyAttendanceData | null; loading: boolean; error: string | null };

function useAttendance(from: string, to: string, reloadKey: number): Fetched {
  const [state, setState] = useState<Fetched>({ data: null, loading: true, error: null });
  useEffect(() => {
    let alive = true;
    setState(s => ({ ...s, loading: true, error: null }));
    crewMyAttendance.get(from, to)
      .then(res => { if (alive) setState({ data: res.data, loading: false, error: null }); })
      .catch(e => { if (alive) setState(s => ({ data: s.data, loading: false, error: e?.message ?? 'Could not load attendance' })); });
    return () => { alive = false; };
  }, [from, to, reloadKey]);
  return state;
}

type RangeKind = 'week' | 'month' | 'custom';

// ── Screen ────────────────────────────────────────────────────────────────────
export default function MyAttendanceScreen() {
  const insets = useSafeAreaInsets();
  const [reloadKey, setReloadKey] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [todayKey, setTodayKey] = useState(istTodayKey());

  const [rangeKind, setRangeKind] = useState<RangeKind>('month');
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [draft, setDraft] = useState<{ from: Date | null; to: Date | null }>({ from: null, to: null });

  const t = parseKey(todayKey);
  const [month, setMonth] = useState({ y: t.y, m0: t.m0 });
  const [selected, setSelected] = useState<string | null>(null);

  // Live clock for the open shift.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => { clearInterval(id); };
  }, []);

  // Refetch whenever the screen regains focus (e.g. after punching at the station).
  const first = useRef(true);
  useFocusEffect(useCallback(() => {
    if (first.current) { first.current = false; return; }
    setReloadKey(k => k + 1);
  }, []));

  const range = useMemo(() => {
    if (rangeKind === 'custom' && custom) return custom;
    if (rangeKind === 'week') {
      const back = (dowOf(todayKey) + 6) % 7; // Monday-start week
      return { from: addDays(todayKey, -back), to: todayKey };
    }
    return { from: keyOf(t.y, t.m0, 1), to: todayKey };
  }, [rangeKind, custom, todayKey, t.y, t.m0]);

  const monthFrom = keyOf(month.y, month.m0, 1);
  const monthEndKey = keyOf(month.y, month.m0, daysInMonth(month.y, month.m0));
  const monthTo = monthEndKey < todayKey ? monthEndKey : todayKey;

  const summaryQ = useAttendance(range.from, range.to, reloadKey);
  const sameAsMonth = range.from === monthFrom && range.to === monthTo;
  const monthQ = useAttendance(monthFrom, monthTo, reloadKey);
  const todayQ = useAttendance(todayKey, todayKey, reloadKey);

  // The server's business day wins over the phone's clock (day start hour).
  useEffect(() => {
    const st = todayQ.data?.today;
    if (st && st !== todayKey) setTodayKey(st);
  }, [todayQ.data?.today, todayKey]);

  const monthDays = useMemo(() => {
    const map = new Map<string, MyAttendanceDay>();
    for (const d of (sameAsMonth ? summaryQ.data : monthQ.data)?.days ?? monthQ.data?.days ?? []) map.set(d.date, d);
    return map;
  }, [monthQ.data, summaryQ.data, sameAsMonth]);

  const todayDay = todayQ.data?.days.find(d => d.date === todayKey);
  const enabled = todayQ.data?.enabled ?? summaryQ.data?.enabled ?? true;

  const selectedDay = selected ? (monthDays.get(selected) ?? (selected === todayKey ? todayDay : undefined)) : undefined;

  const onRefresh = () => setReloadKey(k => k + 1);
  const firstLoad = !todayQ.data && !summaryQ.data && (todayQ.loading || summaryQ.loading);

  const openPicker = () => {
    setDraft({ from: keyToLocal(range.from), to: keyToLocal(range.to) });
    setPickerOpen(true);
  };
  const draftDays = draft.from && draft.to ? Math.round((keyMs(localToKey(draft.to)) - keyMs(localToKey(draft.from))) / DAY_MS) + 1 : 0;
  const applyCustom = () => {
    if (!draft.from || !draft.to || draftDays > MAX_RANGE_DAYS) return;
    const from = localToKey(draft.from), to = localToKey(draft.to);
    setCustom({ from, to });
    setRangeKind('custom');
    const p = parseKey(from);
    setMonth({ y: p.y, m0: p.m0 });
    setPickerOpen(false);
  };

  const rangeLabel = rangeKind === 'week' ? 'This week' : rangeKind === 'month' ? 'This month' : `${shortDate(range.from)} – ${shortDate(range.to)}`;
  const atCurrentMonth = month.y === t.y && month.m0 === t.m0;

  return (
    <View style={[styles.container, { paddingTop: insets.top + Spacing.sm }]}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="arrow-back" size={22} color={QuinckleColors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>My attendance</Text>
        <View style={{ width: 22 }} />
      </View>

      {firstLoad ? (
        <View style={styles.center}><ActivityIndicator color={QuinckleColors.primary} /></View>
      ) : !enabled ? (
        <View style={styles.center}>
          <Ionicons name="calendar-outline" size={36} color={QuinckleColors.textTertiary} />
          <Text style={styles.emptyTitle}>{"Attendance isn't on yet"}</Text>
          <Text style={styles.emptySub}>{"Your restaurant hasn't turned on attendance. Ask your manager."}</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.xxl }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={false} onRefresh={onRefresh} tintColor={QuinckleColors.primary} />}
        >
          {(summaryQ.error || monthQ.error || todayQ.error) && (
            <TouchableOpacity style={styles.errorBar} onPress={onRefresh} activeOpacity={0.8}>
              <Ionicons name="cloud-offline-outline" size={15} color={QuinckleColors.danger} />
              <Text style={styles.errorText}>{"Couldn't load. Tap to retry."}</Text>
            </TouchableOpacity>
          )}

          <TodayCard day={todayDay} todayKey={todayKey} now={now} onPress={() => todayDay && setSelected(todayKey)} />

          {/* Range chips */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            <Chip label="This week" on={rangeKind === 'week'} onPress={() => { setRangeKind('week'); setMonth({ y: t.y, m0: t.m0 }); }} />
            <Chip label="This month" on={rangeKind === 'month'} onPress={() => { setRangeKind('month'); setMonth({ y: t.y, m0: t.m0 }); }} />
            <Chip
              label={rangeKind === 'custom' ? rangeLabel : 'Custom'}
              icon="calendar-outline"
              on={rangeKind === 'custom'}
              onPress={openPicker}
            />
          </ScrollView>

          {/* Summary */}
          <View style={styles.card}>
            <View style={styles.sumHead}>
              <Text style={styles.label}>{rangeLabel.toUpperCase()}</Text>
              <Text style={styles.sumWorked}>{summaryQ.data ? `${fmtDur(summaryQ.data.summary.workedMinutes)} worked` : '—'}</Text>
            </View>
            <View style={styles.stats}>
              <Stat n={summaryQ.data?.summary.present} label="Present" color={C.in} />
              <Stat n={summaryQ.data?.summary.halfDay} label="Half day" color={C.half} />
              <Stat n={summaryQ.data?.summary.absent} label="Absent" color={C.absent} />
              <Stat n={summaryQ.data?.summary.leave} label="Leave" color={C.leave} last />
            </View>
          </View>

          {/* Calendar */}
          <View style={styles.card}>
            <View style={styles.calHead}>
              <Text style={styles.calTitle}>{MONTHS[month.m0]} {month.y}</Text>
              <View style={styles.navRow}>
                {monthQ.loading && <ActivityIndicator size="small" color={QuinckleColors.textTertiary} style={{ marginRight: 6 }} />}
                <TouchableOpacity
                  style={styles.navBtn}
                  onPress={() => setMonth(m => (m.m0 === 0 ? { y: m.y - 1, m0: 11 } : { y: m.y, m0: m.m0 - 1 }))}
                >
                  <Ionicons name="chevron-back" size={15} color={QuinckleColors.textSecondary} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.navBtn, atCurrentMonth && { opacity: 0.35 }]}
                  disabled={atCurrentMonth}
                  onPress={() => setMonth(m => (m.m0 === 11 ? { y: m.y + 1, m0: 0 } : { y: m.y, m0: m.m0 + 1 }))}
                >
                  <Ionicons name="chevron-forward" size={15} color={QuinckleColors.textSecondary} />
                </TouchableOpacity>
              </View>
            </View>
            <MonthGrid
              y={month.y}
              m0={month.m0}
              days={monthDays}
              todayKey={todayKey}
              range={range}
              selected={selected}
              now={now}
              onPick={setSelected}
            />
            <View style={styles.legend}>
              <Legend color={C.in} soft={QuinckleColors.successSoft} label="Present" />
              <Legend color={C.half} soft={QuinckleColors.warningSoft} label="Half day" />
              <Legend color={C.absent} soft={QuinckleColors.dangerSoft} label="Absent" />
              <Legend color={C.leave} soft="transparent" dashed label="Leave" />
            </View>
          </View>
        </ScrollView>
      )}

      {/* Day detail */}
      <BottomSheet visible={!!selected} onClose={() => setSelected(null)} maxHeightRatio={0.86}>
        {selected && <DayDetail dateKey={selected} day={selectedDay} todayKey={todayKey} now={now} />}
      </BottomSheet>

      {/* Custom range */}
      <BottomSheet visible={pickerOpen} onClose={() => setPickerOpen(false)} title="Custom range">
        <View style={{ paddingHorizontal: Spacing.lg }}>
          <View style={styles.presetRow}>
            <Chip label="Last 7 days" on={false} onPress={() => setDraft({ from: keyToLocal(addDays(todayKey, -6)), to: keyToLocal(todayKey) })} />
            <Chip
              label="Last month"
              on={false}
              onPress={() => {
                const y = t.m0 === 0 ? t.y - 1 : t.y, m0 = t.m0 === 0 ? 11 : t.m0 - 1;
                setDraft({ from: new Date(y, m0, 1), to: new Date(y, m0, daysInMonth(y, m0)) });
              }}
            />
            <Chip label="Last 90 days" on={false} onPress={() => setDraft({ from: keyToLocal(addDays(todayKey, -89)), to: keyToLocal(todayKey) })} />
          </View>
          <RangeCalendar
            from={draft.from}
            to={draft.to}
            maxDate={keyToLocal(todayKey)}
            onChange={(from, to) => setDraft({ from, to })}
          />
          {draftDays > MAX_RANGE_DAYS && (
            <Text style={styles.rangeWarn}>Pick up to {MAX_RANGE_DAYS} days at a time.</Text>
          )}
          <TouchableOpacity
            style={[styles.applyBtn, (!draft.from || draftDays > MAX_RANGE_DAYS) && { opacity: 0.4 }]}
            disabled={!draft.from || draftDays > MAX_RANGE_DAYS}
            onPress={applyCustom}
            activeOpacity={0.85}
          >
            <Text style={styles.applyText}>
              {draft.from && draft.to ? `Show ${draftDays} day${draftDays === 1 ? '' : 's'}` : 'Pick dates'}
            </Text>
          </TouchableOpacity>
        </View>
      </BottomSheet>
    </View>
  );
}

// ── Pieces ────────────────────────────────────────────────────────────────────

function StatusPill({ s }: { s: Shown }) {
  const m = STATUS_META[s];
  return (
    <View style={[styles.pill, { backgroundColor: m.soft, borderColor: m.border }]}>
      <View style={[styles.pillDot, { backgroundColor: m.color }]} />
      <Text style={[styles.pillText, { color: m.color }]}>{m.label}</Text>
    </View>
  );
}

function SourceBadge({ p }: { p: MyAttendancePunch }) {
  const s = punchSource(p);
  const color = s.kind === 'owner' ? C.owner : s.kind === 'auto' ? QuinckleColors.warning : QuinckleColors.textSecondary;
  const bg = s.kind === 'owner' ? C.ownerSoft : s.kind === 'auto' ? QuinckleColors.warningSoft : QuinckleColors.surfaceElevated;
  return (
    <View style={[styles.src, { backgroundColor: bg }]}>
      <Ionicons name={s.icon} size={11} color={color} />
      <Text style={[styles.srcText, { color }]}>{s.label}</Text>
    </View>
  );
}

function Chip({ label, on, onPress, icon }: { label: string; on: boolean; onPress: () => void; icon?: React.ComponentProps<typeof Ionicons>['name'] }) {
  return (
    <TouchableOpacity style={[styles.chip, on && styles.chipOn]} onPress={onPress} activeOpacity={0.75}>
      {icon && <Ionicons name={icon} size={13} color={on ? '#fff' : QuinckleColors.textSecondary} />}
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Stat({ n, label, color, last }: { n?: number; label: string; color: string; last?: boolean }) {
  return (
    <View style={[styles.stat, !last && styles.statDivider]}>
      <Text style={[styles.statN, { color }]}>{n ?? '—'}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Legend({ color, soft, label, dashed }: { color: string; soft: string; label: string; dashed?: boolean }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendSw, { backgroundColor: soft, borderColor: color, borderStyle: dashed ? 'dashed' : 'solid' }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

function TodayCard({ day, todayKey, now, onPress }: { day?: MyAttendanceDay; todayKey: string; now: number; onPress: () => void }) {
  const p = parseKey(todayKey);
  const open = isOpen(day);
  const firstPunch = day?.punches[0];
  const lastPunch = day?.punches[day.punches.length - 1];
  const inAt = firstPunch?.at ?? day?.checkInAt ?? null;
  const outAt = !open ? (lastPunch?.kind === 'OUT' ? lastPunch.at : day?.checkOutAt ?? null) : null;

  let pill: React.ReactNode = null;
  if (day) pill = <StatusPill s={shownStatus(day, todayKey)} />;
  else pill = <View style={[styles.pill, { borderColor: QuinckleColors.border }]}><Text style={[styles.pillText, { color: QuinckleColors.textTertiary }]}>Not clocked in</Text></View>;

  const big = day && (day.status === 'PRESENT' || day.status === 'HALF_DAY') ? fmtDur(workedNow(day, now)) : day?.status === 'ABSENT' ? 'Absent' : day?.status === 'LEAVE' ? 'On leave' : '0h 00m';

  return (
    <TouchableOpacity style={[styles.card, styles.todayCard]} activeOpacity={day ? 0.8 : 1} onPress={onPress}>
      <View style={styles.rowBetween}>
        <Text style={styles.label}>TODAY · {DOW[dowOf(todayKey)].toUpperCase()} {p.d} {MON_SHORT[p.m0].toUpperCase()}</Text>
        {pill}
      </View>
      <Text style={styles.todayBig}>{big}</Text>
      {firstPunch ? (
        <View style={styles.todaySub}>
          <Text style={styles.todaySubText}>{open ? 'On shift since ' : 'Clocked in at '}<Text style={styles.strong}>{fmtTime(firstPunch.at)}</Text></Text>
          <SourceBadge p={firstPunch} />
        </View>
      ) : !day ? (
        <Text style={styles.todaySubText}>Clock in at the attendance station when you start.</Text>
      ) : null}
      {day?.status !== 'ABSENT' && day?.status !== 'LEAVE' && (
        <View style={styles.todayRow}>
          <View style={styles.todayBox}>
            <Text style={styles.label}>CLOCK IN</Text>
            <Text style={[styles.todayBoxVal, { color: inAt ? C.in : QuinckleColors.textMuted }]}>{inAt ? fmtTime(inAt) : '—'}</Text>
          </View>
          <View style={styles.todayBox}>
            <Text style={styles.label}>CLOCK OUT</Text>
            <Text style={[styles.todayBoxVal, { color: outAt ? C.out : QuinckleColors.textMuted }]}>{outAt ? fmtTime(outAt) : '—'}</Text>
          </View>
        </View>
      )}
    </TouchableOpacity>
  );
}

function MonthGrid({ y, m0, days, todayKey, range, selected, now, onPick }: {
  y: number; m0: number; days: Map<string, MyAttendanceDay>; todayKey: string;
  range: { from: string; to: string }; selected: string | null; now: number; onPick: (k: string) => void;
}) {
  const lead = new Date(Date.UTC(y, m0, 1)).getUTCDay();
  const n = daysInMonth(y, m0);
  const cells: (string | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= n; d++) cells.push(keyOf(y, m0, d));
  while (cells.length % 7) cells.push(null);

  return (
    <View style={{ paddingHorizontal: 10, paddingBottom: 10 }}>
      <View style={styles.dowRow}>
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((c, i) => <Text key={i} style={styles.dowText}>{c}</Text>)}
      </View>
      <View style={styles.grid}>
        {cells.map((k, i) => {
          if (!k) return <View key={`b${i}`} style={styles.cellWrap} />;
          const day = days.get(k);
          const future = k > todayKey;
          const outOfRange = k < range.from || k > range.to;
          const s = day ? shownStatus(day, todayKey) : null;
          const isToday = k === todayKey;
          const m = s ? STATUS_META[s] : null;
          const sub = !day ? '' : s === 'A' ? 'ABS' : s === 'L' ? 'LV' : s === 'T' ? 'NOW' : s === 'H' ? '½' : `${Math.floor(workedNow(day, now) / 60)}h`;
          const cellStyle = [
            styles.cell,
            s === 'P' && { backgroundColor: m!.soft },
            s === 'A' && { backgroundColor: m!.soft },
            s === 'H' && { backgroundColor: m!.soft, borderColor: m!.border },
            s === 'L' && { borderColor: m!.border, borderStyle: 'dashed' as const },
            (s === 'T' || (isToday && !day)) && { borderColor: QuinckleColors.primary, backgroundColor: QuinckleColors.primarySoft },
            outOfRange && !future && { opacity: 0.3 },
            selected === k && styles.cellSel,
          ];
          const color = m ? m.color : isToday ? QuinckleColors.primary : future ? QuinckleColors.textMuted : QuinckleColors.textSecondary;
          return (
            <View key={k} style={styles.cellWrap}>
              <TouchableOpacity style={cellStyle} disabled={future} onPress={() => onPick(k)} activeOpacity={0.7}>
                <Text style={[styles.cellNum, { color }]}>{parseKey(k).d}</Text>
                {!!sub && <Text style={[styles.cellSub, { color }]}>{sub}</Text>}
              </TouchableOpacity>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function DayDetail({ dateKey, day, todayKey, now }: { dateKey: string; day?: MyAttendanceDay; todayKey: string; now: number }) {
  const head = (pill: React.ReactNode) => (
    <View style={styles.dtHead}>
      <View style={{ flex: 1 }}>
        <Text style={styles.dtTitle}>{longDate(dateKey)}</Text>
        {dateKey === todayKey && <Text style={styles.dtSub}>Today</Text>}
      </View>
      {pill}
    </View>
  );

  if (!day) {
    return (
      <View style={styles.dtWrap}>
        {head(<View style={[styles.pill, { borderColor: QuinckleColors.border }]}><Text style={[styles.pillText, { color: QuinckleColors.textTertiary }]}>No record</Text></View>)}
        <Trio inAt={null} outAt={null} total={null} />
        <Callout tone="neutral" icon="information-circle-outline" title="Nothing recorded">
          No punch and nothing marked by your owner. This day is not counted as absent.
        </Callout>
      </View>
    );
  }

  const s = shownStatus(day, todayKey);
  if (day.status === 'ABSENT' || day.status === 'LEAVE') {
    return (
      <View style={styles.dtWrap}>
        {head(<StatusPill s={s} />)}
        <Trio inAt={null} outAt={null} total={0} />
        {day.status === 'ABSENT' ? (
          <Callout tone="bad" icon="person-outline" title="Marked absent">
            Recorded by your owner. No clock in, no clock out on this day.{day.note ? `\nNote: ${day.note}` : ''}
          </Callout>
        ) : (
          <Callout tone="owner" icon="person-outline" title="On leave">
            Marked by your owner.{day.note ? `\nNote: ${day.note}` : ''}
          </Callout>
        )}
        <Text style={styles.footHint}>Something wrong? Tell your manager.</Text>
      </View>
    );
  }

  const punches = day.punches;
  const open = isOpen(day);
  const inAt = punches[0]?.at ?? day.checkInAt;
  const outAt = open ? null : punches.length ? (punches[punches.length - 1].kind === 'OUT' ? punches[punches.length - 1].at : null) : day.checkOutAt;
  const total = workedNow(day, now);
  const ownerOnly = punches.length === 0 && day.method === 'OWNER_MARKED';
  const ownerAny = ownerOnly || punches.some(p => punchSource(p).kind === 'owner');
  const ins = punches.filter(p => p.kind === 'IN').length;

  return (
    <View style={styles.dtWrap}>
      {head(<StatusPill s={s} />)}
      <Trio inAt={inAt} outAt={outAt} total={total} totalLabel={open ? 'So far' : 'Total'} />

      {punches.length > 0 && (
        <View style={styles.punches}>
          <Text style={[styles.label, { marginBottom: Spacing.md }]}>PUNCHES{ins > 1 ? ` · ${ins} SEGMENTS` : ''}</Text>
          {punches.map((p, i) => {
            const next = punches[i + 1];
            const isIn = p.kind === 'IN';
            return (
              <React.Fragment key={`${p.at}-${i}`}>
                <PunchRow kindLabel={p.kind} color={isIn ? C.in : C.out} soft={isIn ? QuinckleColors.successSoft : QuinckleColors.infoSoft} time={fmtTime(p.at)}>
                  <SourceBadge p={p} />
                </PunchRow>
                {!isIn && next?.kind === 'IN' && (
                  <PunchRow kindLabel="BRK" dashed time={null}>
                    <Text style={styles.brk}>Break · {fmtDur((new Date(next.at).getTime() - new Date(p.at).getTime()) / 60_000)} (not counted)</Text>
                  </PunchRow>
                )}
                {isIn && !next && (
                  <PunchRow kindLabel="…" dashed time={null} last>
                    <Text style={styles.brk}>{dateKey === todayKey ? 'Not clocked out yet' : 'No clock out recorded'}</Text>
                  </PunchRow>
                )}
              </React.Fragment>
            );
          })}
        </View>
      )}

      {ownerAny && (
        <Callout tone="owner" icon="person-outline" title="Entered by your owner">
          {ownerOnly ? 'Marked from the Partner app, not punched at the station.' : 'Some times were entered or corrected from the Partner app.'}
        </Callout>
      )}
      {day.autoClosed && (
        <Callout tone="warn" icon="time-outline" title="Clock out was missed">
          The system closed the shift at day end. These hours stay flagged until your manager corrects them.
        </Callout>
      )}
      {day.status === 'HALF_DAY' && (
        <Callout tone="neutral" icon="information-circle-outline">
          Counted as a <Text style={styles.strong}>half day</Text>.
        </Callout>
      )}
      {!!day.note && (
        <Callout tone="neutral" icon="chatbox-outline" title="Note">{day.note}</Callout>
      )}
      {(day.autoClosed || ownerAny || day.flaggedForReview) && (
        <Text style={styles.footHint}>Something wrong? Tell your manager.</Text>
      )}
    </View>
  );
}

function Trio({ inAt, outAt, total, totalLabel = 'Total' }: { inAt: string | null; outAt: string | null; total: number | null; totalLabel?: string }) {
  return (
    <View style={styles.trio}>
      <View style={[styles.trioCell, styles.trioDivider]}>
        <Text style={styles.trioLabel}>Clock in</Text>
        <Text style={[styles.trioVal, { color: inAt ? C.in : QuinckleColors.textMuted }]}>{inAt ? fmtTime(inAt) : '—'}</Text>
      </View>
      <View style={[styles.trioCell, styles.trioDivider]}>
        <Text style={styles.trioLabel}>Clock out</Text>
        <Text style={[styles.trioVal, { color: outAt ? C.out : QuinckleColors.textMuted }]}>{outAt ? fmtTime(outAt) : '—'}</Text>
      </View>
      <View style={[styles.trioCell, { backgroundColor: QuinckleColors.surfaceElevated }]}>
        <Text style={styles.trioLabel}>{totalLabel}</Text>
        <Text style={[styles.trioVal, total == null && { color: QuinckleColors.textMuted }]}>{total == null ? '—' : fmtDur(total)}</Text>
      </View>
    </View>
  );
}

function PunchRow({ kindLabel, color, soft, dashed, time, last, children }: {
  kindLabel: string; color?: string; soft?: string; dashed?: boolean; time: string | null; last?: boolean; children: React.ReactNode;
}) {
  return (
    <View style={styles.punch}>
      {!last && <View style={styles.punchLine} />}
      <View style={[styles.pk, dashed ? styles.pkDashed : { backgroundColor: soft }]}>
        <Text style={[styles.pkText, { color: dashed ? QuinckleColors.textTertiary : color }]}>{kindLabel}</Text>
      </View>
      <View style={{ flex: 1, paddingTop: time ? 0 : 6 }}>
        {time && <Text style={styles.punchTime}>{time}</Text>}
        <View style={{ marginTop: time ? 4 : 0, flexDirection: 'row' }}>{children}</View>
      </View>
    </View>
  );
}

function Callout({ tone, icon, title, children }: {
  tone: 'bad' | 'warn' | 'owner' | 'neutral'; icon: React.ComponentProps<typeof Ionicons>['name']; title?: string; children: React.ReactNode;
}) {
  const t = {
    bad: { bg: QuinckleColors.dangerSoft, fg: '#FCA5A5' },
    warn: { bg: QuinckleColors.warningSoft, fg: '#FCD34D' },
    owner: { bg: C.ownerSoft, fg: C.owner },
    neutral: { bg: QuinckleColors.surfaceElevated, fg: QuinckleColors.textSecondary },
  }[tone];
  return (
    <View style={[styles.callout, { backgroundColor: t.bg }]}>
      <Ionicons name={icon} size={16} color={t.fg} style={{ marginTop: 1 }} />
      <View style={{ flex: 1 }}>
        {title && <Text style={[styles.calloutTitle, { color: t.fg }]}>{title}</Text>}
        <Text style={[styles.calloutText, { color: t.fg }]}>{children}</Text>
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const TNUM = { fontVariant: ['tabular-nums' as const] };

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: QuinckleColors.background },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: QuinckleColors.border,
    marginBottom: Spacing.md,
  },
  topBarTitle: { color: QuinckleColors.textPrimary, fontSize: 16, fontWeight: '600' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xxl, gap: Spacing.sm },
  emptyTitle: { color: QuinckleColors.textPrimary, fontSize: 16, fontWeight: '700', marginTop: Spacing.sm },
  emptySub: { color: QuinckleColors.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 19 },
  errorBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: Spacing.lg, marginBottom: Spacing.md,
    padding: Spacing.md, borderRadius: Radius.md, backgroundColor: QuinckleColors.dangerSoft,
  },
  errorText: { color: QuinckleColors.danger, fontSize: 13, fontWeight: '600' },

  card: {
    backgroundColor: QuinckleColors.surface, borderWidth: 1, borderColor: QuinckleColors.border,
    borderRadius: Radius.lg, marginHorizontal: Spacing.lg, marginBottom: Spacing.md,
  },
  label: { color: QuinckleColors.textTertiary, fontSize: 10.5, fontWeight: '700', letterSpacing: 1 },
  strong: { color: QuinckleColors.textPrimary, fontWeight: '700' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  todayCard: { padding: Spacing.md + 2 },
  todayBig: { color: QuinckleColors.textPrimary, fontSize: 30, fontWeight: '800', letterSpacing: -1, marginTop: Spacing.sm, ...TNUM },
  todaySub: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  todaySubText: { color: QuinckleColors.textSecondary, fontSize: 12.5, marginTop: 2 },
  todayRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
  todayBox: { flex: 1, backgroundColor: QuinckleColors.surfaceElevated, borderRadius: Radius.sm + 2, paddingVertical: 8, paddingHorizontal: 10 },
  todayBoxVal: { fontSize: 14, fontWeight: '700', marginTop: 3, ...TNUM },

  pill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
  pillDot: { width: 7, height: 7, borderRadius: 4 },
  pillText: { fontSize: 11, fontWeight: '700' },

  src: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 },
  srcText: { fontSize: 11, fontWeight: '600' },

  chips: { gap: 6, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: Radius.pill, borderWidth: 1, borderColor: QuinckleColors.border, backgroundColor: QuinckleColors.surface,
  },
  chipOn: { backgroundColor: QuinckleColors.primary, borderColor: QuinckleColors.primary },
  chipText: { color: QuinckleColors.textSecondary, fontSize: 12.5, fontWeight: '600' },
  chipTextOn: { color: '#fff' },

  sumHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingTop: 12, paddingBottom: 10 },
  sumWorked: { color: QuinckleColors.textPrimary, fontSize: 13, fontWeight: '700', ...TNUM },
  stats: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: QuinckleColors.borderSubtle },
  stat: { flex: 1, alignItems: 'center', paddingVertical: 12 },
  statDivider: { borderRightWidth: 1, borderRightColor: QuinckleColors.borderSubtle },
  statN: { fontSize: 20, fontWeight: '800', letterSpacing: -0.5, ...TNUM },
  statLabel: { color: QuinckleColors.textTertiary, fontSize: 10.5, fontWeight: '600', marginTop: 2 },

  calHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingTop: 14, paddingBottom: 8 },
  calTitle: { color: QuinckleColors.textPrimary, fontSize: 15, fontWeight: '700' },
  navRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  navBtn: { width: 28, height: 28, borderRadius: 8, borderWidth: 1, borderColor: QuinckleColors.border, alignItems: 'center', justifyContent: 'center' },
  dowRow: { flexDirection: 'row' },
  dowText: { flex: 1, textAlign: 'center', color: QuinckleColors.textTertiary, fontSize: 10.5, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 },
  cellWrap: { width: `${100 / 7}%`, padding: 2.5 },
  cell: {
    aspectRatio: 1 / 1.05, borderRadius: 10, borderWidth: 1.5, borderColor: 'transparent',
    alignItems: 'center', justifyContent: 'center',
  },
  cellSel: { borderColor: QuinckleColors.textPrimary },
  cellNum: { fontSize: 13.5, fontWeight: '700', ...TNUM },
  cellSub: { fontSize: 8.5, fontWeight: '700', marginTop: 1, opacity: 0.9 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, paddingHorizontal: 14, paddingBottom: 14 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendSw: { width: 11, height: 11, borderRadius: 3, borderWidth: 1 },
  legendText: { color: QuinckleColors.textSecondary, fontSize: 11, fontWeight: '600' },

  dtWrap: { paddingBottom: Spacing.lg },
  dtHead: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.lg + 2, paddingTop: Spacing.sm, paddingBottom: Spacing.md },
  dtTitle: { color: QuinckleColors.textPrimary, fontSize: 18, fontWeight: '700', letterSpacing: -0.3 },
  dtSub: { color: QuinckleColors.textTertiary, fontSize: 12, marginTop: 2 },
  trio: { flexDirection: 'row', marginHorizontal: Spacing.lg, borderWidth: 1, borderColor: QuinckleColors.border, borderRadius: Radius.md + 2, overflow: 'hidden' },
  trioCell: { flex: 1, paddingVertical: 12, paddingHorizontal: 10 },
  trioDivider: { borderRightWidth: 1, borderRightColor: QuinckleColors.borderSubtle },
  trioLabel: { color: QuinckleColors.textTertiary, fontSize: 11, fontWeight: '600' },
  trioVal: { color: QuinckleColors.textPrimary, fontSize: 16, fontWeight: '800', letterSpacing: -0.4, marginTop: 4, ...TNUM },

  punches: { paddingHorizontal: Spacing.lg + 2, paddingTop: Spacing.lg },
  punch: { flexDirection: 'row', gap: 12, paddingBottom: 14 },
  punchLine: { position: 'absolute', left: 13, top: 28, bottom: 0, width: 2, backgroundColor: QuinckleColors.borderSubtle },
  pk: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  pkDashed: { borderWidth: 1.5, borderStyle: 'dashed', borderColor: QuinckleColors.border },
  pkText: { fontSize: 9.5, fontWeight: '800' },
  punchTime: { color: QuinckleColors.textPrimary, fontSize: 14.5, fontWeight: '700', ...TNUM },
  brk: { color: QuinckleColors.textTertiary, fontSize: 12, fontWeight: '600' },

  callout: { flexDirection: 'row', gap: 9, marginHorizontal: Spacing.lg, marginTop: Spacing.md, padding: 12, borderRadius: Radius.md },
  calloutTitle: { fontSize: 12.5, fontWeight: '700', marginBottom: 2 },
  calloutText: { fontSize: 12.5, lineHeight: 18 },
  footHint: { color: QuinckleColors.textTertiary, fontSize: 12, textAlign: 'center', marginTop: Spacing.lg },

  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: Spacing.md },
  rangeWarn: { color: QuinckleColors.warning, fontSize: 12, fontWeight: '600', marginTop: Spacing.sm },
  applyBtn: { marginTop: Spacing.md, paddingVertical: 14, borderRadius: Radius.md, backgroundColor: QuinckleColors.primary, alignItems: 'center' },
  applyText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
