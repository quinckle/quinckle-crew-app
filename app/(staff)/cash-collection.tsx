// Cash collection screen — staff-only.
//
// Two sections:
//   1. Pending — orders the diner requested cash for, not yet collected.
//      Each row has a [Collect ₹X] button that flips Order.paymentStatus
//      to PAID_CASH and broadcasts cash_payment_collected.
//   2. Today's history — cash collected since IST-midnight.
//
// Session lifecycle is untouched: collecting cash never frees the table.

import React, { useCallback, useEffect, useState, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Linking,
  Alert,
  Image,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../../context/AuthContext';
import { crewPayments, restaurantApi, type PendingCashRequest, type CollectedCashRecord } from '../../services/api';
import { subscribeChannel } from '../../services/realtime';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';
import { CashCollectionSkeleton } from '../../components/ui/CashCollectionSkeleton';
import { CollectionSheet } from '../../components/ui/CollectionSheet';

type Row =
  | { kind: 'sectionHeader'; title: string; subtitle: string }
  | { kind: 'pending'; data: PendingCashRequest }
  | { kind: 'collected'; data: CollectedCashRecord }
  | { kind: 'empty'; message: string };

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.max(0, Math.floor(diffMs / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  return hrs === 1 ? '1 hr ago' : `${hrs} hrs ago`;
}

function timeOfDay(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata',
  });
}

export default function CashCollectionScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { staffInfo } = useAuth();

  const [pending, setPending] = useState<PendingCashRequest[]>([]);
  const [todayCollected, setTodayCollected] = useState<CollectedCashRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Orders currently being submitted — disables button + shows spinner so the
  // waiter can't double-tap and double-confirm.
  const [collectingIds, setCollectingIds] = useState<Set<string>>(new Set());

  // v3 Collection Sheet state.
  const [sheetBill, setSheetBill] = useState<PendingCashRequest | null>(null);
  const [partnerUpi, setPartnerUpi] = useState<{ vpa: string | null; merchantName: string | null }>({ vpa: null, merchantName: null });

  const scrollY = useRef(new Animated.Value(0)).current;

  const renderHeader = () => (
    <View style={styles.heroContainer}>
      <Image
        source={require('../../assets/images/hero banner/cash collection screen/hero banner.webp')}
        style={styles.heroImage}
        resizeMode="cover"
      />
      {/* Dark overlay to fade image into deep background */}
      <LinearGradient
        colors={['rgba(10, 10, 11, 0.1)', 'rgba(10, 10, 11, 0.85)', QuinckleColors.background]}
        locations={[0, 0.8, 1]}
        style={StyleSheet.absoluteFillObject}
      />

      {/* Floating Header Content */}
      <View style={styles.heroTextSection}>
        <Text style={styles.heroTitle}>Payment Collection</Text>
        {pending.length > 0 ? (
          <View style={styles.statsRow}>
            <View style={styles.statPill}>
              <Text style={styles.statPillText}>{pending.length} Pending</Text>
            </View>
            <View style={[styles.statPill, styles.duePill]}>
              <Text style={styles.duePillText}>₹{pending.reduce((s, p) => s + p.amount, 0)} Due</Text>
            </View>
          </View>
        ) : (
          <View style={styles.allCaughtUpPill}>
            <Ionicons name="checkmark-circle-outline" size={14} color={QuinckleColors.success} />
            <Text style={styles.allCaughtUpText}>All Caught Up</Text>
          </View>
        )}
      </View>
    </View>
  );

  const load = useCallback(async () => {
    try {
      const data = await crewPayments.getCashRequests();
      // Guard against any envelope/shape drift — never set state to undefined.
      setPending(Array.isArray(data?.pending) ? data.pending : []);
      setTodayCollected(Array.isArray(data?.todayCollected) ? data.todayCollected : []);
    } catch (err) {
      console.error('[cash-collection] load failed', err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Fetch the partner's branding once on mount — needed for the Collection
  // Sheet's UPI QR (vpa + display name).
  useEffect(() => {
    const restaurantId = staffInfo?.restaurantId;
    if (!restaurantId) return;
    (async () => {
      try {
        const r = await restaurantApi.getBranding(restaurantId);
        setPartnerUpi({
          vpa:          r?.data?.upiId ?? null,
          merchantName: r?.data?.upiDisplayName ?? r?.data?.name ?? null,
        });
      } catch (err) {
        console.warn('[cash-collection] failed to fetch branding', err);
      }
    })();
  }, [staffInfo?.restaurantId]);

  // Live updates from Ably so the list stays fresh across crew devices
  useEffect(() => {
    const restaurantId = staffInfo?.restaurantId;
    if (!restaurantId) return;
    const off1 = subscribeChannel(`waiter:${restaurantId}`, 'cash_collection_requested', () => {
      void load();
    });
    const off2 = subscribeChannel(`waiter:${restaurantId}`, 'cash_payment_collected', () => {
      void load();
    });
    return () => { off1(); off2(); };
  }, [staffInfo?.restaurantId, load]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    void load();
  };

  const handleCollect = async (req: PendingCashRequest) => {
    const staffId = staffInfo?.id;
    if (!staffId) {
      Alert.alert('Not signed in', 'Please reopen the app and sign in again.');
      return;
    }

    // v3: PENDING_STAFF_COLLECTION orders open the Collection Sheet so the
    // staff member can pick Cash / UPI / split right at the table. Legacy
    // PENDING_CASH / PENDING_UPI_DIRECT rows can ALSO use the sheet (the
    // backend /collect endpoint accepts both), so this single path serves
    // every pending payment in the system.
    setSheetBill(req);
  };

  // v3 Collection Sheet submit — called from the sheet with splits[].
  // Returns true on success so the sheet can close + reset its state.
  const handleSheetSubmit = async (splits: { method: 'CASH' | 'UPI_DIRECT'; amount: number }[]): Promise<boolean> => {
    const staffId = staffInfo?.id;
    if (!staffId || !sheetBill) return false;
    setCollectingIds(prev => new Set(prev).add(sheetBill.orderId));
    try {
      await crewPayments.collectPayment(sheetBill.orderId, staffId, splits);
      setPending(prev => prev.filter(p => p.orderId !== sheetBill.orderId));
      setSheetBill(null);
      void load();
      return true;
    } catch (err: any) {
      Alert.alert('Could not record payment', err?.message ?? 'Please try again.');
      return false;
    } finally {
      setCollectingIds(prev => {
        const next = new Set(prev);
        if (sheetBill) next.delete(sheetBill.orderId);
        return next;
      });
    }
  };

  const handleCallCustomer = (phone: string) => {
    Linking.openURL(`tel:${phone}`).catch(() => {});
  };

  // ── Flatten sections into rows for FlatList ────────────────────────────────
  const rows: Row[] = [
    { kind: 'sectionHeader', title: 'Pending', subtitle: `${pending.length} awaiting collection` },
    ...(pending.length === 0
      ? [{ kind: 'empty' as const, message: 'No cash requests right now. Diners paying by cash will appear here.' }]
      : pending.map(p => ({ kind: 'pending' as const, data: p }))),
    { kind: 'sectionHeader', title: 'Collected today', subtitle: `${todayCollected.length} payment${todayCollected.length === 1 ? '' : 's'}` },
    ...(todayCollected.length === 0
      ? [{ kind: 'empty' as const, message: 'Nothing collected yet today.' }]
      : todayCollected.map(c => ({ kind: 'collected' as const, data: c }))),
  ];

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Sticky Top Header Overlay */}
      <View style={[styles.stickyHeader, { paddingTop: insets.top }]}>
        {/* Sticky Background */}
        <Animated.View
          style={[
            styles.stickyHeaderBg,
            {
              opacity: scrollY.interpolate({
                inputRange: [0, 80],
                outputRange: [0, 1],
                extrapolate: 'clamp',
              }),
            },
          ]}
        />
        
        {/* Content Row */}
        <View style={styles.stickyHeaderContent}>
          {/* Back button (left) */}
          <TouchableOpacity onPress={() => router.back()} style={styles.headerActionBtn} activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={22} color={QuinckleColors.textPrimary} />
          </TouchableOpacity>

          {/* Title (center) */}
          <Animated.View
            style={{
              opacity: scrollY.interpolate({
                inputRange: [60, 120],
                outputRange: [0, 1],
                extrapolate: 'clamp',
              }),
            }}
          >
            <Text style={styles.stickyHeaderTitleText}>Payment Collection</Text>
          </Animated.View>

          {/* Refresh button (right) */}
          <TouchableOpacity onPress={handleRefresh} style={styles.headerActionBtn} activeOpacity={0.7}>
            <Ionicons name="refresh" size={20} color={QuinckleColors.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      {isLoading ? (
        <Animated.ScrollView
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { y: scrollY } } }],
            { useNativeDriver: true }
          )}
          scrollEventThrottle={16}
          contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.xl }}
        >
          {renderHeader()}
          <CashCollectionSkeleton />
        </Animated.ScrollView>
      ) : (
        <Animated.FlatList
          data={rows}
          keyExtractor={(row, i) => {
            if (row.kind === 'pending')   return `p-${row.data.orderId}`;
            if (row.kind === 'collected') return `c-${row.data.orderId}-${row.data.method}`;
            if (row.kind === 'sectionHeader') return `h-${row.title}`;
            return `e-${i}`;
          }}
          ListHeaderComponent={renderHeader}
          renderItem={({ item }) => {
            if (item.kind === 'sectionHeader') {
              return (
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>{item.title}</Text>
                  <Text style={styles.sectionSubtitle}>{item.subtitle}</Text>
                </View>
              );
            }
            if (item.kind === 'empty') {
              return <Text style={styles.emptyText}>{item.message}</Text>;
            }
            if (item.kind === 'pending') {
              const p = item.data;
              const busy = collectingIds.has(p.orderId);
              // Method chip — defaults to "Payment" for the new v3 STAFF_COLLECT flow.
              // Legacy in-flight orders still show "Cash" or "UPI Direct" chips.
              const isUpi   = p.method === 'UPI_DIRECT';
              const isStaff = p.method === 'STAFF_COLLECT' || !p.method;
              return (
                <View style={styles.pendingCard}>
                  <View style={styles.cardTopRow}>
                    <View style={styles.tablePill}>
                      <Ionicons name="restaurant-outline" size={12} color={QuinckleColors.primary} />
                      <Text style={styles.tablePillText}>Table {p.tableNumber || '—'}</Text>
                    </View>
                    <View style={[
                      styles.tablePill,
                      isUpi   && { backgroundColor: 'rgba(59,130,246,0.12)', borderColor: 'rgba(59,130,246,0.3)' },
                      isStaff && { backgroundColor: 'rgba(46,125,50,0.12)', borderColor: 'rgba(46,125,50,0.3)' },
                    ]}>
                      <Ionicons
                        name={isUpi ? 'phone-portrait-outline' : isStaff ? 'wallet-outline' : 'cash-outline'}
                        size={11}
                        color={isUpi ? '#60a5fa' : isStaff ? '#86efac' : QuinckleColors.primary}
                      />
                      <Text style={[
                        styles.tablePillText,
                        isUpi   && { color: '#93c5fd' },
                        isStaff && { color: '#bbf7d0' },
                      ]}>
                        {isStaff ? 'Payment' : isUpi ? 'UPI Direct' : 'Cash'}
                      </Text>
                    </View>
                    <Text style={styles.timeAgo}>{timeAgo(p.requestedAt)}</Text>
                  </View>

                  <Text style={styles.customerName}>{p.customerName ?? 'Guest'}</Text>
                  <TouchableOpacity onPress={() => handleCallCustomer(p.customerPhone)} activeOpacity={0.7}>
                    <Text style={styles.customerPhone}>
                      <Ionicons name="call-outline" size={11} /> {p.customerPhone}
                    </Text>
                  </TouchableOpacity>

                  <View style={styles.cardBottomRow}>
                    <Text style={styles.amount}>₹{p.amount}</Text>
                    <TouchableOpacity
                      style={[styles.collectBtn, busy && styles.collectBtnDisabled]}
                      onPress={() => handleCollect(p)}
                      disabled={busy}
                      activeOpacity={0.85}
                    >
                      {busy ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <>
                          <Ionicons name="checkmark-circle" size={16} color="#fff" />
                          <Text style={styles.collectBtnText}>Collect Payment</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              );
            }
            // collected
            const c = item.data;
            const isUpiCollected = c.method === 'UPI_DIRECT';
            return (
              <View style={styles.collectedCard}>
                <View style={styles.cardTopRow}>
                  <View style={styles.collectedPill}>
                    <Ionicons name="checkmark" size={11} color={QuinckleColors.success} />
                    <Text style={styles.collectedPillText}>Table {c.tableNumber || '—'}</Text>
                  </View>
                  <View style={[
                    styles.collectedMethodChip,
                    isUpiCollected && styles.collectedMethodChipUpi,
                  ]}>
                    <Ionicons
                      name={isUpiCollected ? 'phone-portrait-outline' : 'cash-outline'}
                      size={10}
                      color={isUpiCollected ? '#93c5fd' : '#86efac'}
                    />
                    <Text style={[
                      styles.collectedMethodChipText,
                      isUpiCollected && styles.collectedMethodChipTextUpi,
                    ]}>
                      {isUpiCollected ? 'UPI' : 'Cash'}
                    </Text>
                  </View>
                  <Text style={styles.timeAgo}>{timeOfDay(c.collectedAt)}</Text>
                </View>
                <View style={styles.collectedBody}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.collectedCustomer}>{c.customerName ?? 'Guest'} · {c.customerPhone}</Text>
                    {c.collectedByName && (
                      <Text style={styles.collectedBy}>Collected by {c.collectedByName}</Text>
                    )}
                  </View>
                  <Text style={styles.collectedAmount}>₹{c.amount}</Text>
                </View>
              </View>
            );
          }}
          contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.xl }}
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { y: scrollY } } }],
            { useNativeDriver: true }
          )}
          scrollEventThrottle={16}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={QuinckleColors.primary}
              progressViewOffset={220}
            />
          }
        />
      )}

      {/* v3 Collection Sheet — opens when staff taps "Collect Payment" on any pending row. */}
      <CollectionSheet
        visible={!!sheetBill}
        onClose={() => setSheetBill(null)}
        bill={sheetBill ? {
          orderId:       sheetBill.orderId,
          tableNumber:   sheetBill.tableNumber,
          customerName:  sheetBill.customerName,
          customerPhone: sheetBill.customerPhone,
          amount:        sheetBill.amount,
        } : null}
        partner={partnerUpi}
        onConfirm={handleSheetSubmit}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: QuinckleColors.background },
  stickyHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    overflow: 'hidden',
  },
  stickyHeaderBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#141416',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: QuinckleColors.border,
  },
  stickyHeaderContent: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
  },
  headerActionBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  stickyHeaderTitleText: {
    color: QuinckleColors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  heroContainer: {
    height: 220,
    width: '100%',
    position: 'relative',
    overflow: 'hidden',
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroTextSection: {
    position: 'absolute',
    bottom: Spacing.md,
    left: Spacing.lg,
    gap: Spacing.xs,
    maxWidth: '65%',
  },
  heroTitle: {
    color: QuinckleColors.textPrimary,
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  statPill: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  statPillText: {
    color: QuinckleColors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  duePill: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderColor: 'rgba(245, 158, 11, 0.25)',
  },
  duePillText: {
    color: '#F59E0B',
    fontSize: 12,
    fontWeight: '700',
  },
  allCaughtUpPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(34, 197, 94, 0.12)',
    borderColor: 'rgba(34, 197, 94, 0.2)',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    alignSelf: 'flex-start',
  },
  allCaughtUpText: {
    color: QuinckleColors.success,
    fontSize: 12,
    fontWeight: '600',
  },

  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  sectionHeader: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xs,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: QuinckleColors.textPrimary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  sectionSubtitle: { color: QuinckleColors.textTertiary, fontSize: 11 },
  emptyText: {
    color: QuinckleColors.textTertiary,
    fontSize: 13,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    fontStyle: 'italic',
  },

  // Pending card
  pendingCard: {
    backgroundColor: QuinckleColors.surface,
    marginHorizontal: Spacing.md,
    marginVertical: Spacing.xs,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: QuinckleColors.primarySoftBorder,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  tablePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: QuinckleColors.primarySoft,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tablePillText: {
    color: QuinckleColors.primary,
    fontSize: 11,
    fontWeight: '700',
  },
  timeAgo: { color: QuinckleColors.textTertiary, fontSize: 11 },
  customerName: {
    color: QuinckleColors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  customerPhone: {
    color: QuinckleColors.textSecondary,
    fontSize: 13,
    marginBottom: Spacing.md,
  },
  cardBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  amount: {
    color: QuinckleColors.textPrimary,
    fontSize: 22,
    fontWeight: '700',
  },
  collectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: QuinckleColors.primary,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    borderRadius: 999,
    minWidth: 140,
    justifyContent: 'center',
  },
  collectBtnDisabled: { opacity: 0.6 },
  collectBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  // Collected card
  collectedCard: {
    backgroundColor: QuinckleColors.surfaceMuted,
    marginHorizontal: Spacing.md,
    marginVertical: Spacing.xs,
    borderRadius: Radius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: QuinckleColors.borderSubtle,
  },
  collectedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: QuinckleColors.successSoft,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  collectedPillText: {
    color: QuinckleColors.success,
    fontSize: 11,
    fontWeight: '600',
  },
  collectedMethodChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(46,125,50,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(46,125,50,0.25)',
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  collectedMethodChipUpi: {
    backgroundColor: 'rgba(59,130,246,0.12)',
    borderColor: 'rgba(59,130,246,0.25)',
  },
  collectedMethodChipText: {
    color: '#86efac',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  collectedMethodChipTextUpi: {
    color: '#93c5fd',
  },
  collectedBody: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  collectedCustomer: { color: QuinckleColors.textPrimary, fontSize: 13, fontWeight: '500' },
  collectedBy: { color: QuinckleColors.textTertiary, fontSize: 11, marginTop: 2 },
  collectedAmount: {
    color: QuinckleColors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});
