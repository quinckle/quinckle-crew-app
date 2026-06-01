import React, { useCallback, useEffect, useState, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
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
import { CollectionSheet } from '../../components/ui/CollectionSheet';

type Row =
  | { kind: 'sectionHeader'; title: string; subtitle: string }
  | { kind: 'pending'; data: PendingCashRequest }
  | { kind: 'collected'; data: CollectedCashRecord }
  | { kind: 'empty'; message: string };
type TabKey = 'active' | 'confirmed';

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
  const [collectingIds, setCollectingIds] = useState<Set<string>>(new Set());
  const [intentBusyIds, setIntentBusyIds] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab]         = useState<TabKey>('active');
  const [openMenuOrderId, setOpenMenuOrderId] = useState<string | null>(null);
  const [upiSuccessingOrderId, setUpiSuccessingOrderId] = useState<string | null>(null);
  const [collectionOpen, setCollectionOpen] = useState(false);
  const [collectionReq, setCollectionReq] = useState<PendingCashRequest | null>(null);
  const scrollY = useRef(new Animated.Value(0)).current;
  const successSweep = useRef(new Animated.Value(0)).current;

  const load = useCallback(async () => {
    try {
      const [legacy, intents] = await Promise.all([
        crewPayments.getCashRequests(),
        crewPayments.getPendingPaymentIntents().catch(() => []),
      ]);
      const legacyPending = Array.isArray(legacy?.pending) ? legacy.pending : [];
      const mappedIntents: PendingCashRequest[] = intents.map((i) => ({
        // Normalize intent method defensively — backend may return case variants.
        // We keep a strict UPI_DIRECT flag so cards render in the right bucket.
        ...(() => {
          const m = String((i as any).method ?? '').toUpperCase();
          const hasUpiPayload = !!(i as any).upi?.vpa;
          const isUpi = m.includes('UPI') || hasUpiPayload;
          return {
            orderId: `intent:${i.id}`,
            intentId: i.id,
            source: 'INTENT',
            intentMethod: isUpi ? 'UPI_DIRECT' : 'STAFF_COLLECT',
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
            method: isUpi ? 'UPI_DIRECT' : 'STAFF_COLLECT',
            upi: i.upi ? { vpa: i.upi.vpa, displayName: i.upi.displayName } : null,
          };
        })(),
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

  const buildCollectIdempotencyKey = (orderId: string, amount: number) =>
    `crew-collect:${orderId}:UPI_DIRECT:${Number(amount).toFixed(2)}`;

  const handleCollect = (req: PendingCashRequest) => {
    setCollectionReq(req);
    setCollectionOpen(true);
  };
  const markIntentBusy = (intentId: string, busy: boolean) => {
    setIntentBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(intentId);
      else next.delete(intentId);
      return next;
    });
  };
  const markOrderBusy = (orderId: string, busy: boolean) => {
    setCollectingIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(orderId);
      else next.delete(orderId);
      return next;
    });
  };
  const handleConfirmUpiDirect = async (req: PendingCashRequest) => {
    if (req.intentId) markIntentBusy(req.intentId, true);
    else markOrderBusy(req.orderId, true);
    try {
      if (req.intentId) {
        await crewPayments.confirmPaymentIntent(req.intentId);
      } else {
        const staffId = staffInfo?.id;
        if (!staffId) return;
        await crewPayments.collectPayment(
          req.orderId,
          staffId,
          [{ method: 'UPI_DIRECT', amount: req.amount }],
          buildCollectIdempotencyKey(req.orderId, req.amount),
        );
      }
      setOpenMenuOrderId(null);
      setUpiSuccessingOrderId(req.orderId);
      successSweep.setValue(0);
      Animated.timing(successSweep, {
        toValue: 1,
        duration: 700,
        useNativeDriver: true,
      }).start();
      setTimeout(async () => {
        await load();
        setUpiSuccessingOrderId(null);
        successSweep.setValue(0);
      }, 780);
    } catch (err) {
      console.error('[cash-collection] confirm UPI direct failed', err);
    } finally {
      if (req.intentId) markIntentBusy(req.intentId, false);
      else markOrderBusy(req.orderId, false);
    }
  };
  const handleCancelUpiDirect = async (req: PendingCashRequest) => {
    // Cancel API exists only for intent-backed requests.
    if (!req.intentId) return;
    markIntentBusy(req.intentId, true);
    try {
      await crewPayments.rejectPaymentIntent(req.intentId, 'Cancelled by staff');
      await load();
    } catch (err) {
      console.error('[cash-collection] cancel UPI direct failed', err);
    } finally {
      markIntentBusy(req.intentId, false);
    }
  };

  const totalDue = pending.reduce((s, p) => s + p.amount, 0);

  const onCollectionConfirm = async (
    splits: { method: 'CASH' | 'UPI_DIRECT'; amount: number }[],
  ): Promise<boolean> => {
    const req = collectionReq;
    const staffId = staffInfo?.id;
    if (!req) throw new Error('Payment request not found.');
    if (!staffId) throw new Error('Staff profile missing. Please log in again.');
    if (req.intentId) {
      await crewPayments.confirmPaymentIntent(req.intentId);
    } else {
      await crewPayments.collectPayment(
        req.orderId,
        staffId,
        splits,
        `crew-collect:${req.orderId}:${splits.map(s => `${s.method}:${Number(s.amount).toFixed(2)}`).join('|')}`,
      );
    }
    setCollectionOpen(false);
    setCollectionReq(null);
    await load();
    return true;
  };

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

  const renderTabBar = () => (
    <View style={s.tabBarWrap}>
      <View style={s.tabBar}>
        <TouchableOpacity
          style={[s.tabBtn, activeTab === 'active' && s.tabBtnActive]}
          onPress={() => setActiveTab('active')}
          activeOpacity={0.8}
        >
          <Text style={[s.tabBtnText, activeTab === 'active' && s.tabBtnTextActive]}>
            Active Requests
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.tabBtn, activeTab === 'confirmed' && s.tabBtnActive]}
          onPress={() => setActiveTab('confirmed')}
          activeOpacity={0.8}
        >
          <Text style={[s.tabBtnText, activeTab === 'confirmed' && s.tabBtnTextActive]}>
            Confirmed Paid
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const rows: Row[] = activeTab === 'active'
    ? [
        { kind: 'sectionHeader', title: 'Active Requests', subtitle: pending.length === 0 ? 'None' : `${pending.length} · ₹${totalDue.toLocaleString('en-IN')} due` },
        ...(pending.length === 0
          ? [{ kind: 'empty' as const, message: 'No active requests.' }]
          : pending.map(p => ({ kind: 'pending' as const, data: p }))),
      ]
    : [
        { kind: 'sectionHeader', title: 'Confirmed Paid', subtitle: `${todayCollected.length} payment${todayCollected.length === 1 ? '' : 's'}` },
        ...(todayCollected.length === 0
          ? [{ kind: 'empty' as const, message: 'Nothing confirmed yet.' }]
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
          contentContainerStyle={{ paddingBottom: insets.bottom + 88 }}
        >
          {renderHero()}
          {renderTabBar()}
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
          ListHeaderComponent={() => (
            <View>
              {renderHero()}
              {renderTabBar()}
            </View>
          )}
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
              const methodRaw = String(p.intentMethod ?? p.method ?? '').toUpperCase();
              const isUpiDirect = methodRaw.includes('UPI') || !!p.upi?.vpa;
              const intentBusy = !!(p.intentId && intentBusyIds.has(p.intentId));
              const orderBusy = collectingIds.has(p.orderId);
              const menuOpen = openMenuOrderId === p.orderId;
              const isSuccessing = upiSuccessingOrderId === p.orderId;
              const screenWidth = Dimensions.get('window').width;
              const sweepTranslate = successSweep.interpolate({
                inputRange: [0, 1],
                outputRange: [-screenWidth, 0],
              });
              return (
                <View style={[s.pendingCard, isUpiDirect ? s.pendingCardUpi : s.pendingCardStaff]}>
                  {isSuccessing && (
                    <Animated.View
                      pointerEvents="none"
                      style={[
                        StyleSheet.absoluteFillObject,
                        {
                          backgroundColor: '#18a957',
                          transform: [{ translateX: sweepTranslate }],
                        },
                      ]}
                    />
                  )}
                  <View style={s.pendingTop}>
                    <View style={s.pendingTitleRow}>
                      <Text style={s.pendingTableTitle}>{`T${p.tableNumber || '—'}`}</Text>
                      <View style={[s.methodBadge, isUpiDirect ? s.methodBadgeUpi : s.methodBadgeStaff, s.methodBadgeInline]}>
                        <Text style={[s.methodBadgeText, isUpiDirect ? s.methodBadgeTextUpi : s.methodBadgeTextStaff]}>
                          {isUpiDirect ? 'UPI DIRECT' : 'PAY VIA STAFF'}
                        </Text>
                      </View>
                    </View>
                    <View style={s.pendingTopRight}>
                      <Text style={s.pendingTime}>{timeAgo(p.requestedAt)}</Text>
                      {isUpiDirect && (
                        <View style={s.menuWrap}>
                          <TouchableOpacity
                            style={s.menuBtn}
                            onPress={() => setOpenMenuOrderId(menuOpen ? null : p.orderId)}
                            activeOpacity={0.7}
                            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          >
                            <Ionicons name="ellipsis-vertical" size={14} color={QuinckleColors.textTertiary} />
                          </TouchableOpacity>
                          {menuOpen && (
                            <View style={s.menuPanel}>
                              <TouchableOpacity
                                style={s.menuItem}
                                onPress={() => {
                                  setOpenMenuOrderId(null);
                                  void handleCancelUpiDirect(p);
                                }}
                                disabled={intentBusy || orderBusy || !p.intentId}
                                activeOpacity={0.75}
                              >
                                <Text style={s.menuItemDanger}>Cancel request</Text>
                              </TouchableOpacity>
                            </View>
                          )}
                        </View>
                      )}
                    </View>
                  </View>
                  {!isSuccessing ? (
                    <>
                      <View style={s.pendingBody}>
                        <View style={s.pendingAmountBlock}>
                          <Text style={s.pendingAmountLabel}>Amount due</Text>
                          <Text style={s.pendingAmount}>₹{p.amount.toLocaleString('en-IN')}</Text>
                        </View>
                        <View style={s.pendingMetaRow}>
                          {p.customerName ? <Text style={s.pendingName}>{p.customerName}</Text> : null}
                          <TouchableOpacity onPress={() => Linking.openURL(`tel:${p.customerPhone}`).catch(() => {})} activeOpacity={0.6}>
                            <Text style={s.pendingPhone}>{p.customerPhone || 'No phone'}</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                      {isUpiDirect ? (
                        <TouchableOpacity
                          style={[s.collectBtn, s.collectBtnFull, intentBusy && s.collectBtnBusy]}
                          onPress={() => { void handleConfirmUpiDirect(p); }}
                          disabled={intentBusy || orderBusy}
                          activeOpacity={0.8}
                        >
                          {intentBusy || orderBusy
                            ? <ActivityIndicator color="#fff" size="small" />
                            : <Text style={s.collectBtnText}>Confirm Paid</Text>}
                        </TouchableOpacity>
                      ) : (
                        <TouchableOpacity
                          style={[s.collectBtn, s.collectBtnFull, busy && s.collectBtnBusy]}
                          onPress={() => handleCollect(p)}
                          disabled={busy}
                          activeOpacity={0.8}
                        >
                          {busy
                            ? <ActivityIndicator color="#fff" size="small" />
                            : <Text style={s.collectBtnText}>Collect</Text>}
                        </TouchableOpacity>
                      )}
                    </>
                  ) : (
                    <View style={s.successConfirmWrap}>
                      <View style={s.successIcon}>
                        <Ionicons name="checkmark" size={24} color="#fff" />
                      </View>
                      <Text style={s.successTitle}>Confirmed collected</Text>
                      <Text style={s.successSub}>Moving to confirmed paid</Text>
                    </View>
                  )}
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
                    {String(c.method).toLowerCase() === 'upi_direct' && (
                      <View style={s.confirmedUpiBadge}>
                        <Text style={s.confirmedUpiBadgeText}>UPI DIRECT</Text>
                      </View>
                    )}
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
            (leadingItem?.kind === 'collected' && activeTab === 'confirmed') ? <View style={s.separator} /> : null
          }
          contentContainerStyle={{ paddingBottom: insets.bottom + 88 }}
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
      <CollectionSheet
        visible={collectionOpen}
        onClose={() => setCollectionOpen(false)}
        bill={
          collectionReq
            ? {
                orderId: collectionReq.orderId,
                tableNumber: collectionReq.tableNumber,
                customerName: collectionReq.customerName,
                customerPhone: collectionReq.customerPhone || '',
                amount: collectionReq.amount,
              }
            : null
        }
        partner={{
          vpa: collectionReq?.upi?.vpa ?? null,
          merchantName: collectionReq?.upi?.displayName ?? null,
        }}
        onConfirm={onCollectionConfirm}
      />
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
  tabBarWrap: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  tabBar: {
    flexDirection: 'row',
    borderRadius: Radius.md,
    backgroundColor: QuinckleColors.surface,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    overflow: 'hidden',
  },
  tabBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    height: 42,
  },
  tabBtnActive: { backgroundColor: 'rgba(81,136,255,0.16)' },
  tabBtnText: { color: QuinckleColors.textTertiary, fontSize: 13, fontWeight: '600' },
  tabBtnTextActive: { color: QuinckleColors.primary },

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
    borderRadius: 22,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  pendingCardStaff: { backgroundColor: QuinckleColors.surface },
  pendingCardUpi: {
    backgroundColor: '#173B6C',
    borderColor: 'rgba(255,255,255,0.10)',
  },
  pendingTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  pendingTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    flex: 1,
    paddingRight: 12,
  },
  pendingTopRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pendingTableTitle: {
    color: '#fff',
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '800',
    letterSpacing: -0.9,
  },
  pendingTime: { color: 'rgba(255,255,255,0.72)', fontSize: 11 },
  menuWrap: {
    position: 'relative',
  },
  menuBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuPanel: {
    position: 'absolute',
    top: 24,
    right: 0,
    minWidth: 120,
    borderRadius: Radius.sm,
    backgroundColor: QuinckleColors.surface,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    zIndex: 40,
  },
  menuItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  menuItemDanger: {
    color: QuinckleColors.danger,
    fontSize: 12,
    fontWeight: '600',
  },
  methodBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 4,
    marginBottom: 10,
  },
  methodBadgeInline: {
    marginBottom: 0,
  },
  methodBadgeStaff: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderColor: QuinckleColors.border,
  },
  methodBadgeUpi: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderColor: 'rgba(255,255,255,0.18)',
  },
  methodBadgeText: { fontSize: 9, fontWeight: '700', letterSpacing: 0.8 },
  methodBadgeTextStaff: { color: QuinckleColors.textSecondary },
  methodBadgeTextUpi: { color: '#fff' },
  pendingBody: {
    marginTop: 2,
    marginBottom: 14,
  },
  pendingAmountBlock: {
    marginBottom: 12,
  },
  pendingAmountLabel: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  pendingAmount: {
    color: '#fff',
    fontSize: 34,
    fontWeight: '700',
    letterSpacing: -1,
  },
  pendingMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    minHeight: 24,
  },
  pendingName: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
    paddingRight: 8,
  },
  pendingPhone: { color: 'rgba(255,255,255,0.72)', fontSize: 13, marginTop: 0 },
  collectBtnFull: {
    width: '100%',
  },
  collectBtn: {
    backgroundColor: QuinckleColors.primary,
    paddingHorizontal: 20,
    paddingVertical: 13,
    borderRadius: Radius.md,
    minWidth: 100,
    alignItems: 'center',
    justifyContent: 'center',
  },
  collectBtnBusy: { opacity: 0.5 },
  collectBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  inlineActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  successConfirmWrap: {
    minHeight: 126,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  successIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  successTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  successSub: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 12,
    fontWeight: '500',
  },

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
  confirmedUpiBadge: {
    marginLeft: 6,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: 'rgba(81,136,255,0.32)',
    backgroundColor: 'rgba(81,136,255,0.16)',
  },
  confirmedUpiBadgeText: {
    color: '#9ec0ff',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
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
