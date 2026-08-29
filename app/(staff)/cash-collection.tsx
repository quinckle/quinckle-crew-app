import React, { useCallback, useEffect, useState, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Linking,
} from 'react-native';
import { Stack, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../context/AuthContext';
import { crewPayments, restaurantApi, type PendingCashRequest, type CollectedCashRecord } from '../../services/api';
import { CAP } from '../../constants/capabilities';
import { subscribeChannel } from '../../services/realtime';
import { playPaymentSuccess } from '../../services/sound';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';
import { CashCollectionSkeleton } from '../../components/ui/CashCollectionSkeleton';
import { isOffPremise, channelLabel, locationLabel as channelLocationLabel } from '../../constants/channel';

type Row =
  | { kind: 'sectionHeader'; title: string; subtitle: string }
  | { kind: 'groupHeader'; title: string; subtitle: string }
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

const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

// Confirmed Paid tab: group today's collections under their table (takeaway
// gets its own group), each with a subtotal, so a table's payments sit
// together instead of scattered chronologically. Groups and rows are ordered
// most-recent-first.
function buildConfirmedRows(collected: CollectedCashRecord[]): Row[] {
  const grand = collected.reduce((s, c) => s + c.amount, 0);
  const head: Row = {
    kind: 'sectionHeader',
    title: 'Confirmed Paid',
    subtitle: `${collected.length} payment${collected.length === 1 ? '' : 's'} · ${inr(grand)}`,
  };
  if (collected.length === 0) return [head, { kind: 'empty', message: 'Nothing confirmed yet.' }];

  const groups = new Map<string, CollectedCashRecord[]>();
  for (const c of collected) {
    const key = isOffPremise(c.channel) ? `__${String(c.channel).toLowerCase()}__` : `t${c.tableNumber || 0}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(c); else groups.set(key, [c]);
  }

  const ts = (iso: string) => new Date(iso).getTime();
  const ordered = [...groups.values()]
    .map(recs => recs.slice().sort((a, b) => ts(b.collectedAt) - ts(a.collectedAt)))
    .sort((a, b) => ts(b[0].collectedAt) - ts(a[0].collectedAt));

  const rows: Row[] = [head];
  for (const recs of ordered) {
    const first = recs[0];
    const title = isOffPremise(first.channel) ? channelLabel(first.channel) : `Table ${first.tableNumber || '—'}`;
    const subtotal = recs.reduce((s, c) => s + c.amount, 0);
    rows.push({ kind: 'groupHeader', title, subtitle: `${recs.length} · ${inr(subtotal)}` });
    for (const c of recs) rows.push({ kind: 'collected', data: c });
  }
  return rows;
}


export default function CashCollectionScreen() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const { staffInfo, can } = useAuth();

  const [pending, setPending]             = useState<PendingCashRequest[]>([]);
  const [todayCollected, setTodayCollected] = useState<CollectedCashRecord[]>([]);
  const [isLoading, setIsLoading]         = useState(true);
  const [isRefreshing, setIsRefreshing]   = useState(false);
  const [collectingIds, setCollectingIds] = useState<Set<string>>(new Set());
  const [intentBusyIds, setIntentBusyIds] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab]         = useState<TabKey>('active');
  const [openMenuOrderId, setOpenMenuOrderId] = useState<string | null>(null);
  const [upiSuccessingOrderId, setUpiSuccessingOrderId] = useState<string | null>(null);
  // Restaurant's configured UPI VPA — fallback for the Collection Sheet QR when
  // a request payload doesn't carry one (e.g. older backend).
  const [partnerVpa, setPartnerVpa] = useState<{ vpa: string | null; name: string | null }>({ vpa: null, name: null });
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

  // Load on mount and whenever the screen regains focus (e.g. returning from
  // the payment-collect screen) so a just-collected request drops off the list.
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  // Resolve the restaurant's configured UPI VPA once — used as a fallback for
  // the Collection Sheet QR when a pending request doesn't carry its own.
  useEffect(() => {
    const restaurantId = staffInfo?.restaurantId;
    if (!restaurantId) return;
    restaurantApi.getBranding(restaurantId)
      .then(r => {
        const vpa = (r?.data?.upiId ?? '').trim() || null;
        const name = (r?.data?.upiDisplayName ?? r?.data?.name ?? '').trim() || null;
        if (vpa) setPartnerVpa({ vpa, name });
      })
      .catch(() => { /* non-fatal — payload VPA still used when present */ });
  }, [staffInfo?.restaurantId]);

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
    router.push({
      pathname: '/(staff)/payment-collect',
      params: {
        orderId: req.orderId,
        // Whole-table collect settles every pending order on the session.
        sessionId: req.sessionId ?? '',
        orderIds: req.orderIds ? JSON.stringify(req.orderIds) : '',
        tableNumber: String(req.tableNumber ?? ''),
        channel: req.channel ?? 'DINE_IN',
        pickupToken: req.pickupToken ?? '',
        amount: String(req.amount ?? 0),
        customerName: req.customerName ?? '',
        customerPhone: req.customerPhone ?? '',
        breakdown: req.breakdown ? JSON.stringify(req.breakdown) : '',
        intentId: req.intentId ?? '',
        intentMethod: req.intentMethod ?? '',
        upiVpa: req.upi?.vpa ?? partnerVpa.vpa ?? '',
        upiName: req.upi?.displayName ?? partnerVpa.name ?? '',
      },
    });
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
      playPaymentSuccess();
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


  const tabs: { key: TabKey; label: string }[] = [
    { key: 'active', label: 'Active' },
    { key: 'confirmed', label: 'Confirmed' },
  ];

  /**
   * Underline tabs. Each tab takes an equal share of the width and centres its
   * own label, with the rule sized to the text rather than the full column —
   * so the labels sit centred and the underline sits centred beneath them.
   *
   * Replaces a segmented control whose active state was a BLUE fill under
   * ORANGE text; the two never belonged together, and a filled block competed
   * with the outlined cards below it.
   */
  const renderTabBar = () => (
    <View style={s.tabBarWrap}>
      {tabs.map(t => {
        const isActive = activeTab === t.key;
        return (
          <TouchableOpacity
            key={t.key}
            style={s.tabBtn}
            onPress={() => setActiveTab(t.key)}
            activeOpacity={0.7}
          >
            <View style={[s.tabUnderline, isActive && s.tabUnderlineActive]}>
              <Text style={[s.tabBtnText, isActive && s.tabBtnTextActive]}>{t.label}</Text>
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const rows: Row[] = activeTab === 'active'
    ? [
        { kind: 'sectionHeader', title: 'Active Requests', subtitle: pending.length === 0 ? 'None' : `${pending.length} · ₹${totalDue.toLocaleString('en-IN')} due` },
        ...(pending.length === 0
          ? [{ kind: 'empty' as const, message: 'No active requests.' }]
          : pending.map(p => ({ kind: 'pending' as const, data: p }))),
      ]
    : buildConfirmedRows(todayCollected);

  return (
    <View style={s.root}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header — static, not a fade-in overlay. The title, the actions and the
          tabs should all be readable without scrolling first; the old hero
          image pushed them below the fold. */}
      <View style={[s.header, { paddingTop: insets.top + Spacing.sm }]}>
        <View style={s.headerRow}>
          <TouchableOpacity onPress={() => router.back()} activeOpacity={0.6} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="chevron-back" size={24} color={QuinckleColors.textPrimary} />
          </TouchableOpacity>
          <Text style={s.headerTitle} numberOfLines={1}>Payment collection</Text>
          {/* Outstanding is its own screen, not a tab: it answers a different
              question (what's uncollected across the venue) and owns the waive
              flow. Capability-gated — the server enforces it too. */}
          {can(CAP.OUTSTANDING) && (
            <TouchableOpacity onPress={() => router.push('/(staff)/outstanding')} activeOpacity={0.6} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="alert-circle-outline" size={21} color={QuinckleColors.textSecondary} />
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={handleRefresh} activeOpacity={0.6} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="refresh-outline" size={21} color={QuinckleColors.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* No summary line here — the section header below already renders
            "ACTIVE REQUESTS" against "N · ₹X due". */}
        {renderTabBar()}
      </View>

      {isLoading ? (
        <Animated.ScrollView
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: true })}
          scrollEventThrottle={16}
          contentContainerStyle={{ paddingBottom: insets.bottom + 88 }}
        >
          <CashCollectionSkeleton />
        </Animated.ScrollView>
      ) : (
        <Animated.FlatList
          data={rows}
          keyExtractor={(row, i) => {
            if (row.kind === 'pending')      return `p-${row.data.orderId}`;
            if (row.kind === 'collected')    return `c-${row.data.orderId}-${row.data.method}`;
            if (row.kind === 'sectionHeader') return `h-${row.title}`;
            if (row.kind === 'groupHeader')  return `g-${row.title}`;
            return `e-${i}`;
          }}
          ListHeaderComponent={() => (
            <View>
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

            if (item.kind === 'groupHeader') {
              return (
                <View style={s.groupHeader}>
                  <Text style={s.groupTitle}>{item.title}</Text>
                  <Text style={s.groupSubtotal}>{item.subtitle}</Text>
                </View>
              );
            }

            if (item.kind === 'empty') {
              return (
                <View style={s.emptyState}>
                  <Ionicons name="wallet-outline" size={40} color={QuinckleColors.textTertiary} style={{ opacity: 0.5 }} />
                  <Text style={s.emptyText}>{item.message}</Text>
                </View>
              );
            }

            if (item.kind === 'pending') {
              const p   = item.data;
              const busy = collectingIds.has(p.orderId);
              const methodRaw = String(p.intentMethod ?? p.method ?? '').toUpperCase();
              // Classify by METHOD only. Every request now carries the partner
              // VPA (so the Collection Sheet QR works), so presence of p.upi.vpa
              // no longer implies UPI Direct — staff-collect has it too.
              const isUpiDirect = methodRaw.includes('UPI');
              const isTakeaway = isOffPremise(p.channel);
              const intentBusy = !!(p.intentId && intentBusyIds.has(p.intentId));
              const orderBusy = collectingIds.has(p.orderId);
              const menuOpen = openMenuOrderId === p.orderId;
              const isSuccessing = upiSuccessingOrderId === p.orderId;
              const screenWidth = Dimensions.get('window').width;
              const sweepTranslate = successSweep.interpolate({
                inputRange: [0, 1],
                outputRange: [-screenWidth, 0],
              });
              const locationLabel = isTakeaway
                ? (p.pickupToken ?? 'Takeaway')
                : `T${p.tableNumber || '—'}`;
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
                      <Text style={s.pendingTableTitle}>{locationLabel}</Text>
                      {isTakeaway && (
                        <View style={[s.methodBadge, s.methodBadgeTakeaway, s.methodBadgeInline]}>
                          <Text style={[s.methodBadgeText, s.methodBadgeTextTakeaway]}>TAKEAWAY</Text>
                        </View>
                      )}
                      {!isTakeaway && (
                        <View style={[s.methodBadge, isUpiDirect ? s.methodBadgeUpi : s.methodBadgeStaff, s.methodBadgeInline]}>
                          <Text style={[s.methodBadgeText, isUpiDirect ? s.methodBadgeTextUpi : s.methodBadgeTextStaff]}>
                            {isUpiDirect ? 'UPI DIRECT' : 'PAY VIA STAFF'}
                          </Text>
                        </View>
                      )}
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
                          <Text style={s.pendingAmountLabel}>
                            {p.orderCount && p.orderCount > 1 ? `Amount due · ${p.orderCount} orders` : 'Amount due'}
                          </Text>
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

            // collected row — grouped under its table/takeaway header, so the
            // row leads with the payment method (the table is in the header).
            const c = item.data;
            const cIsTakeaway = isOffPremise(c.channel);
            const cMethodLabel = String(c.method).toLowerCase() === 'upi_direct' ? 'UPI Direct' : 'Cash';
            const cLabel = cIsTakeaway
              ? `${c.pickupToken ?? 'Takeaway'} · ${cMethodLabel}`
              : cMethodLabel;
            return (
              <View style={s.collectedRow}>
                <View style={s.collectedLeft}>
                  <View style={s.collectedTableRow}>
                    <Ionicons name="checkmark-circle" size={14} color={QuinckleColors.success} />
                    <Text style={s.collectedTable}>{cLabel}</Text>
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
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: QuinckleColors.background },

  // Sticky overlay header
  header: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: QuinckleColors.border,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  headerTitle: {
    flex: 1,
    color: QuinckleColors.textPrimary,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  tabBarWrap: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
  // Equal share of the width so the two labels sit symmetrically…
  tabBtn: {
    flex: 1,
    alignItems: 'center',
  },
  // …and the rule hugs the label rather than spanning the whole column, so it
  // reads as centred under the word. Transparent when inactive keeps both tabs
  // the same height, so nothing shifts on switch.
  tabUnderline: {
    paddingBottom: 8,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabUnderlineActive: { borderBottomColor: QuinckleColors.primary },
  tabBtnText: { color: QuinckleColors.textTertiary, fontSize: 14, fontWeight: '600' },
  tabBtnTextActive: { color: QuinckleColors.primary },

  // Hero banner

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

  groupHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xs,
  },
  groupTitle: { color: QuinckleColors.textPrimary, fontSize: 15, fontWeight: '700' },
  groupSubtotal: { color: QuinckleColors.textSecondary, fontSize: 13, fontWeight: '600' },

  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.xxl * 2,
    gap: Spacing.md,
  },
  emptyText: {
    color: QuinckleColors.textTertiary,
    fontSize: 13,
    textAlign: 'center',
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
  methodBadgeTakeaway: {
    backgroundColor: 'rgba(242,93,59,0.15)',
    borderColor: 'rgba(242,93,59,0.35)',
  },
  methodBadgeTextTakeaway: { color: '#f25d3b' },
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
  confirmedTakeawayBadge: {
    marginLeft: 6,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: 'rgba(242,93,59,0.32)',
    backgroundColor: 'rgba(242,93,59,0.12)',
  },
  confirmedTakeawayBadgeText: {
    color: '#f25d3b',
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
