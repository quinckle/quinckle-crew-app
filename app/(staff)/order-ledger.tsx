import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  Animated,
  Easing,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { crewSessions, type LedgerSession, type LedgerSummary, type LedgerRange } from '../../services/api';
import { QuinckleColors, Radius, Spacing, Typography } from '../../constants/Colors';
import { BottomSheet } from '../../components/ui/BottomSheet';
import { RangeCalendar } from '../../components/ui/RangeCalendar';

// ── Filter options (mirror the partner Order Ledger) ──────────────────────────
const RANGES: { key: LedgerRange; label: string }[] = [
  { key: 'today',     label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'week',      label: 'This Week' },
  { key: 'month',     label: 'This Month' },
];
type FilterCategory = 'period' | 'status' | 'payment' | 'channel';
const FILTER_CATEGORIES: { key: FilterCategory; label: string }[] = [
  { key: 'period',  label: 'Period' },
  { key: 'status',  label: 'Status' },
  { key: 'payment', label: 'Payment' },
  { key: 'channel', label: 'Channel' },
];

// Local YYYY-MM-DD — matches the day-string format the ledger backend parses.
function toDayStr(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}
function fmtDayShort(d: Date): string {
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
function customRangeLabel(from: Date, to: Date): string {
  return from.getTime() === to.getTime() ? fmtDayShort(from) : `${fmtDayShort(from)} – ${fmtDayShort(to)}`;
}
const STATUS_FILTERS = [
  { key: 'all',          label: 'All' },
  { key: 'paid',         label: 'Paid' },
  { key: 'open',         label: 'Open' },
  { key: 'cash_pending', label: 'Payment Pending' },
  { key: 'cancelled',    label: 'Cancelled' },
  { key: 'closed',       label: 'Closed' },
];
const METHOD_FILTERS = [
  { key: 'all',             label: 'All Methods' },
  { key: 'upi_direct',      label: 'UPI Direct' },
  { key: 'payment_gateway', label: 'Gateway' },
  { key: 'cash',            label: 'Cash' },
];

const CHANNEL_FILTERS = [
  { key: 'all',      label: 'All Channels' },
  { key: 'DINE_IN',  label: 'Dine-in' },
  { key: 'TAKEAWAY', label: 'Takeaway' },
];

const LIMIT = 20;

// ── Small formatters ──────────────────────────────────────────────────────────
function fmtMoney(n: number): string {
  return `₹${Math.round(Number(n) || 0).toLocaleString('en-IN')}`;
}
function fmtTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}
function normalizeMethod(raw: unknown): string | null {
  const s = String(raw ?? '').trim().toUpperCase();
  if (!s) return null;
  if (s.includes('CASH')) return 'CASH';
  if (s.includes('UPI')) return 'UPI_DIRECT';
  if (s.includes('ONLINE') || s.includes('PG') || s.includes('RAZORPAY') || s.includes('GATEWAY') || s.includes('CARD')) return 'PAYMENT_GATEWAY';
  return null;
}

const METHOD_META: Record<string, { label: string; color: string; bg: string }> = {
  CASH:            { label: 'Cash',       color: QuinckleColors.warning, bg: 'rgba(245,158,11,0.12)' },
  UPI_DIRECT:      { label: 'UPI Direct', color: '#A855F7',              bg: 'rgba(168,85,247,0.12)' },
  PAYMENT_GATEWAY: { label: 'Gateway',    color: QuinckleColors.info,    bg: 'rgba(59,130,246,0.12)' },
};

function sessionStatusMeta(s: LedgerSession): { label: string; color: string } {
  const v = s.statusView ?? s.status;
  switch (v) {
    case 'PAID':         return { label: 'Paid',         color: QuinckleColors.success };
    case 'OPEN':         return { label: 'Open',         color: QuinckleColors.warning };
    case 'CASH_PENDING': return { label: 'Payment Pending', color: QuinckleColors.warning };
    case 'CANCELLED':    return { label: 'Cancelled',    color: QuinckleColors.danger };
    default:             return { label: 'Closed',       color: QuinckleColors.textTertiary };
  }
}

function sessionMethods(s: LedgerSession): string[] {
  const top = (s.paymentMethodsUsed ?? [])
    .map(normalizeMethod)
    .filter((m): m is string => Boolean(m));
  if (top.length > 0) return [...new Set(top)];
  const fromPayment = normalizeMethod(s.payment?.method);
  if (fromPayment) return [fromPayment];
  const fromOrders = (s.orders ?? []).flatMap((o) => {
    const methods = o.paymentSummary?.methods ?? [];
    if (methods.length > 0) return methods.map(normalizeMethod).filter((m): m is string => Boolean(m));
    const inferred = normalizeMethod(o.paymentStatus);
    return inferred ? [inferred] : [];
  });
  return [...new Set(fromOrders)];
}

// ── Radio option list ─────────────────────────────────────────────────────────
function OptionList<T extends string>({ options, value, onChange }: {
  options: { key: T; label: string }[]; value: T; onChange(v: T): void;
}) {
  return (
    <View>
      {options.map((opt) => {
        const active = opt.key === value;
        return (
          <TouchableOpacity
            key={opt.key}
            style={fmStyles.optionRow}
            onPress={() => onChange(opt.key)}
            activeOpacity={0.6}
          >
            <Text style={[fmStyles.optionLabel, active && fmStyles.optionLabelActive]}>{opt.label}</Text>
            <View style={[fmStyles.radioOuter, active && fmStyles.radioOuterActive]}>
              {active && <View style={fmStyles.radioInner} />}
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// Period options: presets + a "Custom range" row that reveals an inline calendar.
// Fixed allowance for the calendar's tallest possible month (6 rows) — the reveal
// animates a clip height rather than relying on LayoutAnimation, which is
// unreliable under the New Architecture (this app has newArchEnabled).
const CALENDAR_CLIP_HEIGHT = 336;

function PeriodOptions({
  range, customActive, customFrom, customTo, onPickRange, onActivateCustom, onCustomChange,
}: {
  range: LedgerRange; customActive: boolean; customFrom: Date | null; customTo: Date | null;
  onPickRange(v: LedgerRange): void; onActivateCustom(): void; onCustomChange(f: Date | null, t: Date | null): void;
}) {
  const clipHeight = useRef(new Animated.Value(customActive ? CALENDAR_CLIP_HEIGHT : 0)).current;

  useEffect(() => {
    Animated.timing(clipHeight, {
      toValue: customActive ? CALENDAR_CLIP_HEIGHT : 0,
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [customActive, clipHeight]);

  return (
    <View>
      {RANGES.map((opt) => {
        const active = !customActive && opt.key === range;
        return (
          <TouchableOpacity
            key={opt.key}
            style={fmStyles.optionRow}
            onPress={() => onPickRange(opt.key)}
            activeOpacity={0.6}
          >
            <Text style={[fmStyles.optionLabel, active && fmStyles.optionLabelActive]}>{opt.label}</Text>
            <View style={[fmStyles.radioOuter, active && fmStyles.radioOuterActive]}>
              {active && <View style={fmStyles.radioInner} />}
            </View>
          </TouchableOpacity>
        );
      })}

      <TouchableOpacity style={fmStyles.optionRow} onPress={onActivateCustom} activeOpacity={0.6}>
        <Text style={[fmStyles.optionLabel, customActive && fmStyles.optionLabelActive]}>
          {customActive && customFrom && customTo ? customRangeLabel(customFrom, customTo) : 'Custom range'}
        </Text>
        <View style={[fmStyles.radioOuter, customActive && fmStyles.radioOuterActive]}>
          {customActive && <View style={fmStyles.radioInner} />}
        </View>
      </TouchableOpacity>

      <Animated.View style={[fmStyles.calendarClip, { height: clipHeight }]}>
        <View style={fmStyles.calendarWrap}>
          <RangeCalendar from={customFrom} to={customTo} onChange={onCustomChange} />
        </View>
      </Animated.View>
    </View>
  );
}

// Per-row height used to predict each panel's natural content height so the right
// column can animate smoothly between categories (and into/out of the custom
// calendar) without depending on LayoutAnimation/onLayout timing.
const OPTION_ROW_HEIGHT = 46;

function panelHeight(category: FilterCategory, customActive: boolean): number {
  if (category === 'status')  return STATUS_FILTERS.length * OPTION_ROW_HEIGHT;
  if (category === 'payment') return METHOD_FILTERS.length * OPTION_ROW_HEIGHT;
  if (category === 'channel') return CHANNEL_FILTERS.length * OPTION_ROW_HEIGHT;
  // period: presets + the "Custom range" row, plus the calendar when open
  return (RANGES.length + 1) * OPTION_ROW_HEIGHT + (customActive ? CALENDAR_CLIP_HEIGHT : 0);
}

// ── Split-column filter modal (ported from the partner Order Ledger) ──────────
function FiltersModal({
  visible, onClose, range, statusFilter, methodFilter, channelFilter,
  customActive, customFrom, customTo,
  onPickRange, onPickStatus, onPickMethod, onPickChannel, onActivateCustom, onCustomChange,
  onReset, activeFilterCount, resultCount,
}: {
  visible: boolean; onClose(): void;
  range: LedgerRange; statusFilter: string; methodFilter: string; channelFilter: string;
  customActive: boolean; customFrom: Date | null; customTo: Date | null;
  onPickRange(v: LedgerRange): void; onPickStatus(v: string): void; onPickMethod(v: string): void;
  onPickChannel(v: string): void;
  onActivateCustom(): void; onCustomChange(f: Date | null, t: Date | null): void;
  onReset(): void; activeFilterCount: number; resultCount: number;
}) {
  const [category, setCategory] = useState<FilterCategory>('period');
  useEffect(() => { if (visible) setCategory('period'); }, [visible]);

  const isCategoryActive = (key: FilterCategory) => {
    if (key === 'period')  return customActive || range !== 'today';
    if (key === 'status')  return statusFilter !== 'all';
    if (key === 'channel') return channelFilter !== 'all';
    return methodFilter !== 'all';
  };

  // A single animated height drives the right column for every transition —
  // switching categories, and opening/closing the custom calendar — so the
  // whole sheet resizes with one consistent, buttery motion.
  const rightHeight = useRef(new Animated.Value(panelHeight(category, customActive))).current;
  useEffect(() => {
    Animated.timing(rightHeight, {
      toValue: panelHeight(category, customActive),
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [category, customActive, rightHeight]);

  return (
    <BottomSheet visible={visible} onClose={onClose} maxHeightRatio={0.94}>
      <View style={fmStyles.header}>
        <Text style={fmStyles.headerTitle}>Filters</Text>
        <View style={fmStyles.headerRight}>
          {activeFilterCount > 0 && (
            <TouchableOpacity onPress={onReset} hitSlop={8} activeOpacity={0.6}>
              <Text style={fmStyles.headerReset}>Reset</Text>
            </TouchableOpacity>
          )}
          <Text style={fmStyles.headerResultCount}>{`${resultCount} result${resultCount !== 1 ? 's' : ''}`}</Text>
        </View>
      </View>

      <View style={fmStyles.splitBody}>
        {/* Left — filter categories */}
        <View style={fmStyles.leftCol}>
          {FILTER_CATEGORIES.map((c) => {
            const active = c.key === category;
            return (
              <TouchableOpacity
                key={c.key}
                style={[fmStyles.catRow, active && fmStyles.catRowActive]}
                onPress={() => setCategory(c.key)}
                activeOpacity={0.7}
              >
                {active && <View style={fmStyles.catAccent} />}
                <Text style={[fmStyles.catLabel, active && fmStyles.catLabelActive]} numberOfLines={1}>
                  {c.label}
                </Text>
                {isCategoryActive(c.key) && <View style={fmStyles.catDot} />}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Right — options for the selected category. All three panels stay
            mounted (absolute-stacked) so switching tabs never unmounts the
            calendar's animated state; only opacity/height transition. */}
        <Animated.View style={[fmStyles.rightCol, { height: rightHeight }]}>
          <View style={[fmStyles.rightLayer, category !== 'period' && fmStyles.rightLayerHidden]} pointerEvents={category === 'period' ? 'auto' : 'none'}>
            <PeriodOptions
              range={range} customActive={customActive} customFrom={customFrom} customTo={customTo}
              onPickRange={onPickRange} onActivateCustom={onActivateCustom} onCustomChange={onCustomChange}
            />
          </View>
          <View style={[fmStyles.rightLayer, category !== 'status' && fmStyles.rightLayerHidden]} pointerEvents={category === 'status' ? 'auto' : 'none'}>
            <OptionList options={STATUS_FILTERS} value={statusFilter} onChange={onPickStatus} />
          </View>
          <View style={[fmStyles.rightLayer, category !== 'payment' && fmStyles.rightLayerHidden]} pointerEvents={category === 'payment' ? 'auto' : 'none'}>
            <OptionList options={METHOD_FILTERS} value={methodFilter} onChange={onPickMethod} />
          </View>
          <View style={[fmStyles.rightLayer, category !== 'channel' && fmStyles.rightLayerHidden]} pointerEvents={category === 'channel' ? 'auto' : 'none'}>
            <OptionList options={CHANNEL_FILTERS} value={channelFilter} onChange={onPickChannel} />
          </View>
        </Animated.View>
      </View>
    </BottomSheet>
  );
}

const fmStyles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl, paddingBottom: Spacing.md,
  },
  headerTitle: { ...Typography.title, color: QuinckleColors.textPrimary },
  headerRight: { alignItems: 'flex-end', gap: 4 },
  headerReset: { ...Typography.caption, color: QuinckleColors.primary, fontWeight: '700' as const },
  headerResultCount: { ...Typography.micro, color: QuinckleColors.textMuted },

  splitBody: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: QuinckleColors.border,
  },

  // Left column — vertically stacked category labels
  leftCol: {
    width: 112, paddingVertical: Spacing.sm,
    borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: QuinckleColors.border,
  },
  catRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: Spacing.md, paddingHorizontal: Spacing.lg,
  },
  catRowActive: { backgroundColor: QuinckleColors.surfaceElevated },
  catAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, backgroundColor: QuinckleColors.primary },
  catLabel: { ...Typography.caption, color: QuinckleColors.textSecondary, flexShrink: 1 },
  catLabelActive: { color: QuinckleColors.textPrimary, fontWeight: '700' as const },
  catDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: QuinckleColors.primary, marginLeft: Spacing.xs },

  // Right column — options for the selected category
  rightCol: { flex: 1, position: 'relative', overflow: 'hidden' },
  rightLayer: {
    position: 'absolute', top: 0, left: 0, right: 0,
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
  },
  rightLayerHidden: { opacity: 0 },
  optionRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: Spacing.md,
  },
  optionLabel: { ...Typography.body, color: QuinckleColors.textSecondary },
  optionLabelActive: { color: QuinckleColors.textPrimary, fontWeight: '600' as const },
  radioOuter: {
    width: 18, height: 18, borderRadius: 9,
    borderWidth: 1.5, borderColor: QuinckleColors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  radioOuterActive: { borderColor: QuinckleColors.primary },
  radioInner: { width: 9, height: 9, borderRadius: 4.5, backgroundColor: QuinckleColors.primary },

  calendarClip: { overflow: 'hidden' },
  calendarWrap: {
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: QuinckleColors.border,
    paddingTop: Spacing.sm,
  },
});

function PaymentChip({ method }: { method: string }) {
  const meta = METHOD_META[method] ?? { label: method, color: QuinckleColors.textMuted, bg: QuinckleColors.surfaceElevated };
  return (
    <View style={[styles.payChip, { backgroundColor: meta.bg }]}>
      <Text style={[styles.payChipText, { color: meta.color }]}>{meta.label}</Text>
    </View>
  );
}

// ── Session row ───────────────────────────────────────────────────────────────
function SessionCard({ session, onPress }: { session: LedgerSession; onPress: () => void }) {
  const st = sessionStatusMeta(session);
  const methods = sessionMethods(session);
  const totalItems = (session.orders ?? []).reduce((sum, o) => sum + (o.items ?? []).reduce((s2, i) => s2 + (i.qty ?? 0), 0), 0);
  const displayTotal = session.grandTotal || session.billTotal || session.foodSubtotal || 0;
  const isCancelled = (session.statusView ?? session.status) === 'CANCELLED';
  // A fully-voided session has ₹0 payable — show the struck original instead of "—".
  const struckTotal = isCancelled ? (session.cancelledValue ?? 0) : 0;
  const isTakeaway = session.channel === 'TAKEAWAY';
  // Same shape for both channels: a generic label up top, the specific
  // identifier (pickup token / table id) down next to the duration — makes
  // takeaway and dine-in cards read as one uniform layout.
  const identifier = isTakeaway
    ? (session.pickupToken ?? 'TK')
    : session.tableNumber != null ? `T-${String(session.tableNumber).padStart(2, '0')}` : 'Walk-in';
  const timeStr =
    identifier + '  ·  ' +
    fmtTime(session.openedAt) +
    (session.closedAt ? ` – ${fmtTime(session.closedAt)}` : '') +
    (session.durationMins > 0 ? ` · ${session.durationMins}m` : '');

  return (
    <TouchableOpacity style={styles.sessionRow} onPress={onPress} activeOpacity={0.6}>
      <View style={[styles.sessionDot, { backgroundColor: st.color }]} />
      <View style={{ flex: 1 }}>
        <View style={styles.sessionTopRow}>
          <Text style={styles.sessionRef}>
            {isTakeaway ? 'Takeaway' : 'Dine in'}
            <Text style={styles.sessionShort}>{session.sessionRef ? `  ${session.sessionRef}` : ''}</Text>
          </Text>
          {isCancelled && struckTotal > 0 ? (
            <Text style={styles.sessionAmountStruck}>{fmtMoney(struckTotal)}</Text>
          ) : (
            <Text style={styles.sessionAmount}>{displayTotal > 0 ? fmtMoney(displayTotal) : '—'}</Text>
          )}
        </View>
        <View style={styles.sessionBottomRow}>
          <Text style={styles.sessionMeta} numberOfLines={1}>{timeStr}</Text>
          <View style={styles.sessionRight}>
            <Text style={styles.sessionMeta}>{totalItems} item{totalItems !== 1 ? 's' : ''}</Text>
            {methods.length > 0 && (
              <View style={styles.payChips}>
                {methods.map((m) => <PaymentChip key={m} method={m} />)}
              </View>
            )}
            <Text style={[styles.sessionStatus, { color: st.color }]}>{st.label}</Text>
          </View>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={16} color={QuinckleColors.textTertiary} />
    </TouchableOpacity>
  );
}

// ── Summary strip ─────────────────────────────────────────────────────────────
function SummaryStrip({ summary, onRevenuePress }: { summary: LedgerSummary | null; onRevenuePress: () => void }) {
  return (
    <View style={styles.summaryRow}>
      <View style={styles.summaryStat}>
        <Text style={styles.summaryValue} numberOfLines={1}>{summary ? String(summary.totalSessions) : '—'}</Text>
        <Text style={styles.summaryLabel} numberOfLines={1}>Sessions</Text>
      </View>
      <View style={styles.summaryDivider} />
      <TouchableOpacity
        style={styles.summaryStat}
        onPress={onRevenuePress}
        activeOpacity={0.7}
        disabled={!summary?.paymentBreakdown}
      >
        <View style={styles.summaryValueRow}>
          <Text style={styles.summaryValue} numberOfLines={1}>{summary ? fmtMoney(summary.totalRevenue) : '—'}</Text>
          <Ionicons name="chevron-down" size={13} color={QuinckleColors.textTertiary} style={{ marginLeft: 3 }} />
        </View>
        <Text style={styles.summaryLabel} numberOfLines={1}>Revenue · tap for split</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function OrderLedger() {
  const insets = useSafeAreaInsets();

  const [sessions, setSessions]       = useState<LedgerSession[]>([]);
  const [summary, setSummary]         = useState<LedgerSummary | null>(null);
  const [pages, setPages]             = useState(1);
  const [page, setPage]               = useState(1);
  const [loading, setLoading]         = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing]   = useState(false);
  const [error, setError]             = useState<string | null>(null);

  const [range, setRange]             = useState<LedgerRange>('today');
  const [customActive, setCustomActive] = useState(false);
  const [customFrom, setCustomFrom]   = useState<Date | null>(null);
  const [customTo, setCustomTo]       = useState<Date | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [methodFilter, setMethodFilter] = useState('all');
  const [channelFilter, setChannelFilter] = useState('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch]           = useState('');
  const [filterOpen, setFilterOpen]   = useState(false);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [total, setTotal]             = useState(0);

  // Debounce the search box into the applied search filter.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const fetchPage = useCallback(
    async (pageToLoad: number, mode: 'replace' | 'append' | 'refresh') => {
      if (mode === 'replace') setLoading(true);
      if (mode === 'append') setLoadingMore(true);
      setError(null);
      try {
        const useCustom = customActive && customFrom != null && customTo != null;
        const filterParams = search
          ? { sessionRef: search }
          : useCustom
            ? { from: toDayStr(customFrom!), to: toDayStr(customTo!), status: statusFilter, method: methodFilter, channel: channelFilter as 'DINE_IN' | 'TAKEAWAY' | 'all' }
            : { range, status: statusFilter, method: methodFilter, channel: channelFilter as 'DINE_IN' | 'TAKEAWAY' | 'all' };
        const res = await crewSessions.getHistory({
          ...filterParams,
          page: pageToLoad,
          limit: LIMIT,
        });
        setSummary(res.summary);
        setTotal(res.total);
        setPages(res.pages);
        setPage(res.page);
        setSessions((prev) => (mode === 'append' ? [...prev, ...res.sessions] : res.sessions));
      } catch (e: any) {
        setError(e?.message ?? 'Failed to load order ledger');
        if (mode !== 'append') setSessions([]);
      } finally {
        setLoading(false);
        setLoadingMore(false);
        setRefreshing(false);
      }
    },
    [range, statusFilter, methodFilter, channelFilter, search, customActive, customFrom, customTo],
  );

  // Reload from page 1 whenever a filter changes.
  useEffect(() => {
    fetchPage(1, 'replace');
  }, [fetchPage]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchPage(1, 'refresh');
  }, [fetchPage]);

  const onEndReached = useCallback(() => {
    if (!loadingMore && !loading && page < pages) {
      fetchPage(page + 1, 'append');
    }
  }, [loadingMore, loading, page, pages, fetchPage]);

  const openDetail = useCallback((s: LedgerSession) => {
    router.push({ pathname: '/(staff)/order-detail', params: { id: s.id, ref: s.sessionRef ?? '' } });
  }, []);

  // Picking a filter clears any active session-ref search so the filter applies.
  const pickRange = useCallback((v: LedgerRange) => { setSearchInput(''); setSearch(''); setCustomActive(false); setRange(v); }, []);
  const activateCustom = useCallback(() => { setSearchInput(''); setSearch(''); setCustomActive(true); }, []);
  const onCustomChange = useCallback((f: Date | null, t: Date | null) => { setCustomFrom(f); setCustomTo(t); }, []);
  const pickStatus = useCallback((k: string) => { setSearchInput(''); setSearch(''); setStatusFilter(k); }, []);
  const pickMethod = useCallback((k: string) => { setSearchInput(''); setSearch(''); setMethodFilter(k); }, []);
  const pickChannel = useCallback((k: string) => { setSearchInput(''); setSearch(''); setChannelFilter(k); }, []);
  const resetFilters = useCallback(() => {
    setRange('today'); setStatusFilter('all'); setMethodFilter('all'); setChannelFilter('all');
    setCustomActive(false); setCustomFrom(null); setCustomTo(null);
  }, []);

  // A custom range only counts as "active" once a day is chosen.
  const customComplete = customActive && customFrom != null && customTo != null;
  const isSingleDay = customComplete && customFrom!.getTime() === customTo!.getTime();
  const dateFilterActive = customActive ? customComplete : range !== 'today';
  const customLabel = customComplete
    ? (isSingleDay ? fmtDayShort(customFrom!) : `${fmtDayShort(customFrom!)} – ${fmtDayShort(customTo!)}`)
    : 'Custom';

  // Count of non-default filters — shown as a badge on the filter button.
  const activeFilterCount =
    (dateFilterActive ? 1 : 0) + (statusFilter !== 'all' ? 1 : 0) + (methodFilter !== 'all' ? 1 : 0) + (channelFilter !== 'all' ? 1 : 0);
  const rangeLabel = customActive
    ? customLabel
    : RANGES.find((r) => r.key === range)?.label ?? 'Today';

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header bar */}
      <View style={styles.headerBar}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={22} color={QuinckleColors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Order Ledger</Text>
        <View style={styles.btnPlaceholder} />
      </View>

      {/* Search + Filter button */}
      <View style={styles.searchRow}>
        <View style={styles.searchWrap}>
          <Ionicons name="search" size={16} color={QuinckleColors.textTertiary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by session ref (e.g. S-AB12CD)"
            placeholderTextColor={QuinckleColors.textTertiary}
            value={searchInput}
            onChangeText={setSearchInput}
            autoCapitalize="characters"
            returnKeyType="search"
          />
          {searchInput.length > 0 && (
            <TouchableOpacity onPress={() => setSearchInput('')} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={QuinckleColors.textTertiary} />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity
          style={[styles.filterBtn, activeFilterCount > 0 && styles.filterBtnActive]}
          onPress={() => setFilterOpen(true)}
          activeOpacity={0.7}
        >
          <Ionicons
            name="options-outline"
            size={20}
            color={activeFilterCount > 0 ? QuinckleColors.primary : QuinckleColors.textSecondary}
          />
          {activeFilterCount > 0 && (
            <View style={styles.filterBadge}>
              <Text style={styles.filterBadgeText}>{activeFilterCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Active filter summary (hidden while searching by ref) */}
      {!search && (
        <Text style={styles.filterSummary} numberOfLines={1}>
          {rangeLabel}
          {statusFilter !== 'all' ? ` · ${STATUS_FILTERS.find((f) => f.key === statusFilter)?.label}` : ''}
          {methodFilter !== 'all' ? ` · ${METHOD_FILTERS.find((f) => f.key === methodFilter)?.label}` : ''}
          {channelFilter !== 'all' ? ` · ${CHANNEL_FILTERS.find((f) => f.key === channelFilter)?.label}` : ''}
        </Text>
      )}

      <FlatList
        data={sessions}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + Spacing.huge }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={QuinckleColors.primary} />
        }
        onEndReached={onEndReached}
        onEndReachedThreshold={0.4}
        ListHeaderComponent={<SummaryStrip summary={summary} onRevenuePress={() => setBreakdownOpen(true)} />}
        ItemSeparatorComponent={() => <View style={styles.divider} />}
        renderItem={({ item }) => <SessionCard session={item} onPress={() => openDetail(item)} />}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            {loading ? (
              <ActivityIndicator size="small" color={QuinckleColors.primary} />
            ) : error ? (
              <>
                <Ionicons name="alert-circle-outline" size={32} color={QuinckleColors.danger} />
                <Text style={styles.emptyText}>{error}</Text>
                <TouchableOpacity onPress={() => fetchPage(1, 'replace')} style={styles.retryBtn}>
                  <Text style={styles.retryText}>Retry</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Ionicons name="receipt-outline" size={32} color={QuinckleColors.textTertiary} />
                <Text style={styles.emptyText}>No orders for this filter.</Text>
              </>
            )}
          </View>
        }
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.footerLoad}>
              <ActivityIndicator size="small" color={QuinckleColors.primary} />
            </View>
          ) : null
        }
      />

      {/* Filter modal */}
      <FiltersModal
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        range={range} statusFilter={statusFilter} methodFilter={methodFilter} channelFilter={channelFilter}
        customActive={customActive} customFrom={customFrom} customTo={customTo}
        onPickRange={pickRange} onPickStatus={pickStatus} onPickMethod={pickMethod} onPickChannel={pickChannel}
        onActivateCustom={activateCustom} onCustomChange={onCustomChange}
        onReset={resetFilters}
        activeFilterCount={activeFilterCount}
        resultCount={total}
      />

      {/* Revenue breakdown modal — opened by tapping Revenue */}
      <BottomSheet visible={breakdownOpen} onClose={() => setBreakdownOpen(false)} title="Revenue breakdown">
        <View style={styles.breakdownModal}>
          {summary?.paymentBreakdown ? (
            <>
              {([
                { label: 'Cash', amount: summary.paymentBreakdown.cash, color: QuinckleColors.warning },
                { label: 'UPI Direct', amount: summary.paymentBreakdown.upiDirect, color: '#A855F7' },
                { label: 'Gateway', amount: summary.paymentBreakdown.gateway, color: QuinckleColors.info },
              ]).map((r) => {
                const pct = summary.totalRevenue > 0 ? Math.round((r.amount / summary.totalRevenue) * 100) : 0;
                return (
                  <View key={r.label} style={styles.bdRow}>
                    <View style={styles.bdLeft}>
                      <View style={[styles.bdDot, { backgroundColor: r.color }]} />
                      <Text style={styles.bdLabel}>{r.label}</Text>
                      <Text style={styles.bdPct}>{pct}%</Text>
                    </View>
                    <Text style={styles.bdAmount}>{fmtMoney(r.amount)}</Text>
                  </View>
                );
              })}
              <View style={styles.bdDivider} />
              <View style={styles.bdRow}>
                <Text style={styles.bdTotalLabel}>Total revenue</Text>
                <Text style={styles.bdTotalAmount}>{fmtMoney(summary.totalRevenue)}</Text>
              </View>
            </>
          ) : (
            <Text style={styles.bdEmpty}>No collected payments in this range.</Text>
          )}
        </View>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: QuinckleColors.background },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: QuinckleColors.border,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: Radius.md,
    backgroundColor: QuinckleColors.surfaceMuted,
    borderWidth: 1, borderColor: QuinckleColors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  btnPlaceholder: { width: 38, height: 38 },
  headerTitle: { color: QuinckleColors.textPrimary, fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
  },
  searchWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    height: 44,
    borderRadius: Radius.md,
    backgroundColor: QuinckleColors.surfaceMuted,
    borderWidth: 1, borderColor: QuinckleColors.border,
  },
  searchInput: { flex: 1, color: QuinckleColors.textPrimary, fontSize: 14, paddingVertical: 0 },
  filterBtn: {
    width: 44, height: 44, borderRadius: Radius.md,
    backgroundColor: QuinckleColors.surfaceMuted,
    borderWidth: 1, borderColor: QuinckleColors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  filterBtnActive: { backgroundColor: QuinckleColors.primarySoft, borderColor: QuinckleColors.primarySoftBorder },
  filterBadge: {
    position: 'absolute', top: -5, right: -5,
    minWidth: 17, height: 17, borderRadius: 9, paddingHorizontal: 4,
    backgroundColor: QuinckleColors.primary,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: QuinckleColors.background,
  },
  filterBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  filterSummary: {
    color: QuinckleColors.textTertiary, fontSize: 12, fontWeight: '600',
    marginHorizontal: Spacing.lg, marginTop: Spacing.sm,
  },

  listContent: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg },

  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: QuinckleColors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1, borderColor: QuinckleColors.border,
    paddingVertical: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  summaryStat: { flex: 1, alignItems: 'center', paddingHorizontal: 4 },
  summaryValueRow: { flexDirection: 'row', alignItems: 'center' },
  summaryDivider: { width: 1, height: 28, backgroundColor: QuinckleColors.border },
  summaryValue: { color: QuinckleColors.textPrimary, fontSize: 16, fontWeight: '800', letterSpacing: -0.3 },
  summaryLabel: { color: QuinckleColors.textTertiary, fontSize: 10, fontWeight: '600', marginTop: 3, textTransform: 'uppercase', letterSpacing: 0.4 },

  divider: { height: 1, backgroundColor: QuinckleColors.borderSubtle },

  sessionRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md },
  sessionDot: { width: 8, height: 8, borderRadius: 4 },
  sessionTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sessionRef: { color: QuinckleColors.textPrimary, fontSize: 14, fontWeight: '700' },
  sessionShort: { color: QuinckleColors.textTertiary, fontSize: 11, fontWeight: '500' },
  sessionAmount: { color: QuinckleColors.textPrimary, fontSize: 14, fontWeight: '700' },
  sessionAmountStruck: { color: QuinckleColors.textTertiary, fontSize: 14, fontWeight: '700', textDecorationLine: 'line-through' },
  sessionBottomRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 5 },
  sessionMeta: { color: QuinckleColors.textTertiary, fontSize: 11.5, flexShrink: 1 },
  sessionRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  sessionStatus: { fontSize: 11.5, fontWeight: '700' },
  payChips: { flexDirection: 'row', gap: 4 },
  payChip: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: Radius.sm },
  payChipText: { fontSize: 10, fontWeight: '700' },

  emptyState: { alignItems: 'center', justifyContent: 'center', paddingTop: 64, gap: Spacing.md },
  emptyText: { color: QuinckleColors.textTertiary, fontSize: 13, textAlign: 'center', paddingHorizontal: Spacing.xl },
  retryBtn: {
    marginTop: Spacing.sm, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm,
    borderRadius: Radius.md, backgroundColor: QuinckleColors.primarySoft,
    borderWidth: 1, borderColor: QuinckleColors.primarySoftBorder,
  },
  retryText: { color: QuinckleColors.primary, fontSize: 13, fontWeight: '700' },
  footerLoad: { paddingVertical: Spacing.lg, alignItems: 'center' },

  // Revenue breakdown modal
  breakdownModal: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.xs, paddingBottom: Spacing.sm },
  bdRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: Spacing.md },
  bdLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  bdDot: { width: 9, height: 9, borderRadius: 5 },
  bdLabel: { color: QuinckleColors.textPrimary, fontSize: 14, fontWeight: '600' },
  bdPct: { color: QuinckleColors.textTertiary, fontSize: 12, fontWeight: '600' },
  bdAmount: { color: QuinckleColors.textPrimary, fontSize: 14, fontWeight: '700' },
  bdDivider: { height: 1, backgroundColor: QuinckleColors.border, marginVertical: Spacing.xs },
  bdTotalLabel: { color: QuinckleColors.textPrimary, fontSize: 14, fontWeight: '800' },
  bdTotalAmount: { color: QuinckleColors.primary, fontSize: 16, fontWeight: '800' },
  bdEmpty: { color: QuinckleColors.textTertiary, fontSize: 13, textAlign: 'center', paddingVertical: Spacing.xl },
});
