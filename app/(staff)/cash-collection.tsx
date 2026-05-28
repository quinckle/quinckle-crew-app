import React, { useCallback, useEffect, useState, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Image,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Linking,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../../context/AuthContext';
import { crewPayments, type PendingCashRequest, type CollectedCashRecord } from '../../services/api';
import { subscribeChannel } from '../../services/realtime';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';
import { CashCollectionSkeleton } from '../../components/ui/CashCollectionSkeleton';

type Row =
  | { kind: 'sectionHeader'; title: string; subtitle: string }
  | { kind: 'pending'; data: PendingCashRequest }
  | { kind: 'collected'; data: CollectedCashRecord }
  | { kind: 'empty'; message: string };

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.max(0, Math.floor(diffMs / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ago`;
}

function timeOfDay(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata',
  });
}


export default function CashCollectionScreen() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const { staffInfo } = useAuth();

  const [pending, setPending]             = useState<PendingCashRequest[]>([]);
  const [todayCollected, setTodayCollected] = useState<CollectedCashRecord[]>([]);
  const [isLoading, setIsLoading]         = useState(true);
  const [isRefreshing, setIsRefreshing]   = useState(false);
  const [collectingIds]                   = useState<Set<string>>(new Set());
  const scrollY = useRef(new Animated.Value(0)).current;

  const load = useCallback(async () => {
    try {
      const [legacy, intents] = await Promise.all([
        crewPayments.getCashRequests(),
        crewPayments.getPendingPaymentIntents().catch(() => []),
      ]);
      const legacyPending = Array.isArray(legacy?.pending) ? legacy.pending : [];
      const mappedIntents: PendingCashRequest[] = intents.map((i) => ({
        orderId: `intent:${i.id}`,
        intentId: i.id,
        source: 'INTENT',
        intentMethod: i.method,
        sessionId: i.sessionId,
        tableNumber: i.tableNumber,
        amount: Number(i.amount.total ?? 0),
        breakdown: {
          subtotal: Number(i.amount.subtotal ?? 0),
          discount: Number(i.amount.discount ?? 0),
          chargesTotal: Number(i.amount.charges ?? 0),
          taxRate: 0,
          taxAmount: Number(i.amount.tax ?? 0),
          tip: Number(i.amount.tip ?? 0),
          total: Number(i.amount.total ?? 0),
          currency: 'INR',
        },
        customerName: null,
        customerPhone: '',
        requestedAt: i.createdAt,
        method: i.method === 'UPI_DIRECT' ? 'UPI_DIRECT' : 'STAFF_COLLECT',
        upi: i.upi ? { vpa: i.upi.vpa, displayName: i.upi.displayName } : null,
      }));
      setPending([...mappedIntents, ...legacyPending]);
      setTodayCollected(Array.isArray(legacy?.todayCollected) ? legacy.todayCollected : []);
    } catch (err) {
      console.error('[cash-collection] load failed', err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const restaurantId = staffInfo?.restaurantId;
    if (!restaurantId) return;
    const off1 = subscribeChannel(`waiter:${restaurantId}`, 'cash_collection_requested', () => void load());
    const off2 = subscribeChannel(`waiter:${restaurantId}`, 'cash_payment_collected', () => void load());
    // Diner cancelled their pending staff-collect request — remove the stale card.
    const off3 = subscribeChannel(`waiter:${restaurantId}`, 'payment_request_cancelled', () => void load());
    const off4 = subscribeChannel(`waiter:${restaurantId}`, 'payment_intent_created', () => void load());
    const off5 = subscribeChannel(`waiter:${restaurantId}`, 'payment_intent_updated', () => void load());
    return () => { off1(); off2(); off3(); off4(); off5(); };
  }, [staffInfo?.restaurantId, load]);

  const handleRefresh = () => { setIsRefreshing(true); void load(); };

  const handleCollect = (req: PendingCashRequest) => {
    router.push({
      pathname: '/(staff)/payment-collect',
      params: {
        orderId:       req.orderId,
        tableNumber:   String(req.tableNumber),
        amount:        String(req.amount),
        customerName:  req.customerName ?? '',
        customerPhone: req.customerPhone,
        intentId:      req.intentId ?? '',
        intentMethod:  req.intentMethod ?? '',
        upiVpa:        req.upi?.vpa ?? '',
        upiName:       req.upi?.displayName ?? '',
        // Serialize breakdown so the payment-collect screen can render the
        // itemised breakdown without a second API call.
        breakdown:     req.breakdown ? JSON.stringify(req.breakdown) : '',
      },
    });
  };

  const totalDue = pending.reduce((s, p) => s + p.amount, 0);

  const renderHero = () => (
    <View style={s.heroWrap}>
      <Image
        source={require('../../assets/images/hero banner/cash collection screen/hero banner.webp')}
        style={s.heroImage}
        resizeMode="cover"
      />
      <LinearGradient
        colors={['rgba(10,10,11,0.05)', 'rgba(10,10,11,0.75)', QuinckleColors.background]}
        locations={[0, 0.75, 1]}
        style={StyleSheet.absoluteFillObject}
      />
      <View style={s.heroContent}>
        <Text style={s.heroTitle}>Payment Collection</Text>
        {pending.length > 0 ? (
          <Text style={s.heroSub}>{pending.length} pending · ₹{totalDue.toLocaleString('en-IN')} due</Text>
        ) : (
          <Text style={s.heroSub}>All caught up</Text>
        )}
      </View>
    </View>
  );

  const rows: Row[] = [
    { kind: 'sectionHeader', title: 'Pending', subtitle: pending.length === 0 ? 'None' : `${pending.length} · ₹${totalDue.toLocaleString('en-IN')} due` },
    ...(pending.length === 0
      ? [{ kind: 'empty' as const, message: 'No pending requests.' }]
      : pending.map(p => ({ kind: 'pending' as const, data: p }))),
    { kind: 'sectionHeader', title: 'Collected today', subtitle: `${todayCollected.length} payment${todayCollected.length === 1 ? '' : 's'}` },
    ...(todayCollected.length === 0
      ? [{ kind: 'empty' as const, message: 'Nothing collected yet.' }]
      : todayCollected.map(c => ({ kind: 'collected' as const, data: c }))),
  ];

  return (
    <View style={s.root}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Sticky overlay header — fades in as user scrolls past hero */}
      <View style={[s.stickyHeader, { paddingTop: insets.top }]} pointerEvents="box-none">
        <Animated.View style={[s.stickyBg, {
          opacity: scrollY.interpolate({ inputRange: [80, 160], outputRange: [0, 1], extrapolate: 'clamp' }),
        }]} />
        <View style={s.stickyRow}>
          <TouchableOpacity onPress={() => router.back()} activeOpacity={0.6} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="chevron-back" size={24} color={QuinckleColors.textPrimary} />
          </TouchableOpacity>
          <Animated.Text style={[s.stickyTitle, {
            opacity: scrollY.interpolate({ inputRange: [120, 180], outputRange: [0, 1], extrapolate: 'clamp' }),
          }]}>
            Payment Collection
          </Animated.Text>
          <TouchableOpacity onPress={handleRefresh} activeOpacity={0.6} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="refresh-outline" size={20} color={QuinckleColors.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      {isLoading ? (
        <Animated.ScrollView
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
          scrollEventThrottle={16}
          contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.xl }}
        >
          {renderHero()}
          <CashCollectionSkeleton />
        </Animated.ScrollView>
      ) : (
        <Animated.FlatList
          data={rows}
          keyExtractor={(row, i) => {
            if (row.kind === 'pending')      return `p-${row.data.orderId}`;
            if (row.kind === 'collected')    return `c-${row.data.orderId}-${row.data.method}`;
            if (row.kind === 'sectionHeader') return `h-${row.title}`;
            return `e-${i}`;
          }}
          ListHeaderComponent={renderHero}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
          scrollEventThrottle={16}
          renderItem={({ item, index }) => {
            if (item.kind === 'sectionHeader') {
              return (
                <View style={[s.sectionHeader, index === 0 && { marginTop: Spacing.sm }]}>
                  <Text style={s.sectionTitle}>{item.title.toUpperCase()}</Text>
                  <Text style={s.sectionCount}>{item.subtitle}</Text>
                </View>
              );
            }

            if (item.kind === 'empty') {
              return <Text style={s.emptyText}>{item.message}</Text>;
            }

            if (item.kind === 'pending') {
              const p   = item.data;
              const busy = collectingIds.has(p.orderId);
              return (
                <View style={s.pendingCard}>
                  <View style={s.pendingTop}>
                    <Text style={s.pendingTable}>Table {p.tableNumber || '—'}</Text>
                    <Text style={s.pendingTime}>{timeAgo(p.requestedAt)}</Text>
                  </View>
                  <Text style={s.pendingAmount}>₹{p.amount.toLocaleString('en-IN')}</Text>
                  <View style={s.pendingBottom}>
                    <View style={{ flex: 1 }}>
                      <TouchableOpacity onPress={() => Linking.openURL(`tel:${p.customerPhone}`).catch(() => {})} activeOpacity={0.6}>
                        <Text style={s.pendingPhone}>{p.customerPhone}</Text>
                      </TouchableOpacity>
                    </View>
                    <TouchableOpacity
                      style={[s.collectBtn, busy && s.collectBtnBusy]}
                      onPress={() => handleCollect(p)}
                      disabled={busy}
                      activeOpacity={0.8}
                    >
                      {busy
                        ? <ActivityIndicator color="#fff" size="small" />
                        : <Text style={s.collectBtnText}>Collect</Text>}
                    </TouchableOpacity>
                  </View>
                </View>
              );
            }

            // collected row
            const c = item.data;
            return (
              <View style={s.collectedRow}>
                <View style={s.collectedLeft}>
                  <View style={s.collectedTableRow}>
                    <Ionicons name="checkmark-circle" size={14} color={QuinckleColors.success} />
                    <Text style={s.collectedTable}>Table {c.tableNumber || '—'}</Text>
                  </View>
                  <Text style={s.collectedPhone}>{c.customerPhone}</Text>
                  {c.collectedByName && <Text style={s.collectedBy}>{c.collectedByName}</Text>}
                </View>
                <View style={s.collectedRight}>
                  <Text style={s.collectedTime}>{timeOfDay(c.collectedAt)}</Text>
                  <Text style={s.collectedAmount}>₹{c.amount.toLocaleString('en-IN')}</Text>
                </View>
              </View>
            );
          }}
          ItemSeparatorComponent={({ leadingItem }) =>
            leadingItem?.kind === 'collected' ? <View style={s.separator} /> : null
          }
          contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.xl }}
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
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: QuinckleColors.background },

  // Sticky overlay header
  stickyHeader: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100,
  },
  stickyBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: QuinckleColors.background,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: QuinckleColors.border,
  },
  stickyRow: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
  },
  stickyTitle: { color: QuinckleColors.textPrimary, fontSize: 15, fontWeight: '600' },

  // Hero banner
  heroWrap: { height: 220, width: '100%', overflow: 'hidden' },
  heroImage: { width: '100%', height: '100%' },
  heroContent: {
    position: 'absolute', bottom: Spacing.xl, left: Spacing.xl, right: Spacing.xl,
  },
  heroTitle: {
    color: QuinckleColors.textPrimary,
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  heroSub: { color: QuinckleColors.textSecondary, fontSize: 14, fontWeight: '500' },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.sm,
  },
  sectionTitle: {
    color: QuinckleColors.textTertiary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  sectionCount: { color: QuinckleColors.textTertiary, fontSize: 12 },

  emptyText: {
    color: QuinckleColors.textTertiary,
    fontSize: 13,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.md,
  },

  // Pending card
  pendingCard: {
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.sm,
    backgroundColor: QuinckleColors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
  },
  pendingTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  pendingTable: {
    color: QuinckleColors.textTertiary,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  pendingTime: { color: QuinckleColors.textTertiary, fontSize: 11 },
  pendingAmount: {
    color: QuinckleColors.textPrimary,
    fontSize: 36,
    fontWeight: '700',
    letterSpacing: -1,
    marginBottom: 12,
  },
  pendingBottom: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  pendingPhone: { color: QuinckleColors.textTertiary, fontSize: 13, marginTop: 2 },
  collectBtn: {
    backgroundColor: QuinckleColors.primary,
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderRadius: Radius.md,
    minWidth: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  collectBtnBusy: { opacity: 0.5 },
  collectBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },

  // Collected rows
  collectedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: Spacing.xl,
    paddingVertical: 14,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: QuinckleColors.border,
    marginHorizontal: Spacing.xl,
  },
  collectedLeft: { flex: 1, gap: 2 },
  collectedTableRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  collectedTable: {
    color: QuinckleColors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  collectedPhone: { color: QuinckleColors.textTertiary, fontSize: 13 },
  collectedBy: { color: QuinckleColors.textTertiary, fontSize: 11, marginTop: 1 },
  collectedRight: { alignItems: 'flex-end', gap: 2 },
  collectedTime: { color: QuinckleColors.textTertiary, fontSize: 11 },
  collectedAmount: {
    color: QuinckleColors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'],
  },
});
