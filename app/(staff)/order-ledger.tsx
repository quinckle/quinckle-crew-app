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
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { crewSessions, type LedgerSession, type LedgerSummary, type LedgerRange } from '../../services/api';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';

// ── Filter options (mirror the partner Order Ledger) ──────────────────────────
const RANGES: { key: LedgerRange; label: string }[] = [
  { key: 'today',     label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'week',      label: 'This Week' },
  { key: 'month',     label: 'This Month' },
];
const STATUS_FILTERS = [
  { key: 'all',          label: 'All' },
  { key: 'paid',         label: 'Paid' },
  { key: 'open',         label: 'Open' },
  { key: 'cash_pending', label: 'Cash Pending' },
  { key: 'closed',       label: 'Closed' },
];
const METHOD_FILTERS = [
  { key: 'all',             label: 'All Methods' },
  { key: 'upi_direct',      label: 'UPI Direct' },
  { key: 'payment_gateway', label: 'Gateway' },
  { key: 'cash',            label: 'Cash' },
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
    case 'CASH_PENDING': return { label: 'Cash Pending', color: QuinckleColors.warning };
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

// ── Chip ──────────────────────────────────────────────────────────────────────
function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.chip, active && styles.chipActive]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

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
  const timeStr =
    fmtTime(session.openedAt) +
    (session.closedAt ? ` – ${fmtTime(session.closedAt)}` : '') +
    (session.durationMins > 0 ? ` · ${session.durationMins}m` : '');

  return (
    <TouchableOpacity style={styles.sessionRow} onPress={onPress} activeOpacity={0.6}>
      <View style={[styles.sessionDot, { backgroundColor: st.color }]} />
      <View style={{ flex: 1 }}>
        <View style={styles.sessionTopRow}>
          <Text style={styles.sessionRef}>
            {session.tableNumber != null ? `Table ${session.tableNumber}` : 'Walk-in'}
            <Text style={styles.sessionShort}>{session.sessionRef ? `  ${session.sessionRef}` : ''}</Text>
          </Text>
          <Text style={styles.sessionAmount}>{displayTotal > 0 ? fmtMoney(displayTotal) : '—'}</Text>
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
function SummaryStrip({ summary }: { summary: LedgerSummary | null }) {
  const stats = [
    { label: 'Sessions', value: summary ? String(summary.totalSessions) : '—' },
    { label: 'Revenue',  value: summary ? fmtMoney(summary.totalRevenue) : '—' },
    { label: 'Avg Bill', value: summary ? fmtMoney(summary.avgBill) : '—' },
    { label: "Quinckle's Cut", value: summary ? fmtMoney(summary.quincklesCut) : '—' },
  ];
  return (
    <View style={styles.summaryRow}>
      {stats.map((s, i) => (
        <React.Fragment key={s.label}>
          {i > 0 && <View style={styles.summaryDivider} />}
          <View style={styles.summaryStat}>
            <Text style={styles.summaryValue} numberOfLines={1}>{s.value}</Text>
            <Text style={styles.summaryLabel} numberOfLines={1}>{s.label}</Text>
          </View>
        </React.Fragment>
      ))}
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
  const [statusFilter, setStatusFilter] = useState('all');
  const [methodFilter, setMethodFilter] = useState('all');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch]           = useState('');

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
        const res = await crewSessions.getHistory({
          ...(search ? { sessionRef: search } : { range, status: statusFilter, method: methodFilter }),
          page: pageToLoad,
          limit: LIMIT,
        });
        setSummary(res.summary);
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
    [range, statusFilter, methodFilter, search],
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

      {/* Search */}
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

      {/* Filters — hidden while a session-ref search is active */}
      {!search && (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {RANGES.map((r) => (
              <FilterChip key={r.key} label={r.label} active={range === r.key} onPress={() => setRange(r.key)} />
            ))}
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
            {STATUS_FILTERS.map((f) => (
              <FilterChip key={f.key} label={f.label} active={statusFilter === f.key} onPress={() => setStatusFilter(f.key)} />
            ))}
            <View style={styles.chipSep} />
            {METHOD_FILTERS.map((f) => (
              <FilterChip key={f.key} label={f.label} active={methodFilter === f.key} onPress={() => setMethodFilter(f.key)} />
            ))}
          </ScrollView>
        </>
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
        ListHeaderComponent={<SummaryStrip summary={summary} />}
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

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    paddingHorizontal: Spacing.md,
    height: 42,
    borderRadius: Radius.md,
    backgroundColor: QuinckleColors.surfaceMuted,
    borderWidth: 1, borderColor: QuinckleColors.border,
  },
  searchInput: { flex: 1, color: QuinckleColors.textPrimary, fontSize: 14, paddingVertical: 0 },

  chipRow: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, gap: Spacing.sm },
  chipSep: { width: 1, backgroundColor: QuinckleColors.border, marginHorizontal: Spacing.xs, alignSelf: 'stretch' },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
    borderRadius: Radius.pill,
    backgroundColor: QuinckleColors.surfaceMuted,
    borderWidth: 1, borderColor: QuinckleColors.border,
  },
  chipActive: { backgroundColor: QuinckleColors.primarySoft, borderColor: QuinckleColors.primarySoftBorder },
  chipText: { color: QuinckleColors.textSecondary, fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: QuinckleColors.primary },

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
});
