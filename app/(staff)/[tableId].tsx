import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Animated, FlatList, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, ActivityIndicator, Share } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';
import { ThemedDialog } from '../../components/ui/themed-dialog';
import { crewSessions, crewTables, crewOrders, crewPayments, crewDiners, restaurantApi, printerApi } from '../../services/api';
import type { CrewTable, SessionBill } from '../../services/api';
import { printBill, getStatus as getPrinterStatus } from '../../services/printer';
import type { InvoiceBill } from '../../services/invoiceTemplate';
import { useAuth } from '../../context/AuthContext';
import { useCountdown } from '../../hooks/useCountdown';
import { subscribeChannel } from '../../services/realtime';
import type { BillOrderItem, BillOrder, MenuItem } from '../../services/api';
import { SwapTableSheet } from '../../components/ui/SwapTableSheet';
import { BottomSheet } from '../../components/ui/BottomSheet';
import { Skeleton } from '../../components/ui/Skeleton';
import { Typography } from '../../constants/Colors';

type ItemStatus = 'prep' | 'served';

type FlatItem = {
  key: string;
  item_id: string;
  order_id: string;
  name: string;
  modifiersSummary?: string | null;
  status: ItemStatus;
  price: number;
  orderedAt: string;
  qty: number;
};

const STATUS_META: Record<ItemStatus, { label: string; color: string; bg: string }> = {
  prep:   { label: 'Preparing', color: QuinckleColors.warning, bg: QuinckleColors.warningSoft },
  served: { label: 'Served',    color: QuinckleColors.textTertiary, bg: 'transparent' },
};

function itemStatus(item: BillOrderItem): ItemStatus {
  if (item.served) return 'served';
  return 'prep';
}


function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function toSessionRef(sessionId: string | null | undefined): string {
  const v = String(sessionId ?? '');
  const tail = v.slice(-8).toUpperCase();
  return `S-${tail || 'UNKNOWN'}`;
}

export default function TableDetail() {
  const insets = useSafeAreaInsets();
  const { tableId, sessionId: paramSessionId, tableDbId, occupiedSince, expiresAt: paramExpiresAt, customerName: paramCustomerName, customerPhone: paramCustomerPhone } = useLocalSearchParams<{ tableId: string; sessionId: string; tableDbId: string; occupiedSince: string; expiresAt: string; customerName: string; customerPhone: string }>();
  const router = useRouter();
  const { staffInfo } = useAuth();

  const tableNum = String(tableId ?? '').padStart(2, '0');

  const [sessionId] = useState(paramSessionId ?? '');
  const [sessionRef, setSessionRef] = useState('');
  const [expiresAt, setExpiresAt] = useState<string | null>(paramExpiresAt || null);
  const countdown = useCountdown(expiresAt);
  const isNearExpiry = countdown.totalMs > 0 && countdown.totalMs < 10 * 60_000;
  const countdownStr = countdown.totalMs > 0
    ? countdown.h > 0
      ? `${countdown.h}h ${String(countdown.m).padStart(2, '0')}m`
      : `${String(countdown.m).padStart(2, '0')}:${String(countdown.s).padStart(2, '0')}`
    : countdown.expired ? 'Expired' : null;

  // Elapsed counter — used when no expiresAt is available
  const [elapsed, setElapsed] = useState(() => {
    if (!occupiedSince) return '';
    const ms = new Date(occupiedSince).getTime();
    const secs = Math.floor((Date.now() - ms) / 1000);
    const m = Math.floor(secs / 60); const s = secs % 60;
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  });
  useEffect(() => {
    if (!occupiedSince) return;
    const ms = new Date(occupiedSince).getTime();
    const id = setInterval(() => {
      const secs = Math.floor((Date.now() - ms) / 1000);
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      const s = secs % 60;
      setElapsed(h > 0 ? `${h}h ${String(m).padStart(2,'0')}m` : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`);
    }, 1000);
    return () => clearInterval(id);
  }, [occupiedSince]);

  const [restaurantInvoiceMeta, setRestaurantInvoiceMeta] = useState<{
    address?: string | null;
    phone?: string | null;
    email?: string | null;
    fssaiLicenseNumber?: string | null;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [orders, setOrders] = useState<BillOrder[]>([]);
  const [sessionTotal, setSessionTotal] = useState(0);
  const [taxTotal, setTaxTotal] = useState(0);
  const [serviceChargeTotal, setServiceChargeTotal] = useState(0);
  const [discountTotal, setDiscountTotal] = useState(0);
  const [tipTotal, setTipTotal] = useState(0);
  const [payableTotal, setPayableTotal] = useState(0);
  const [sessionStatus, setSessionStatus] = useState<'active' | 'paid' | 'closed'>('active');
  const [since, setSince] = useState(() => {
    if (!occupiedSince) return '';
    const d = new Date(occupiedSince);
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  });
  const [sessionCustomerName, setSessionCustomerName] = useState<string | null>(paramCustomerName || null);
  const [sessionCustomerPhone, setSessionCustomerPhone] = useState<string | null>(paramCustomerPhone || null);
  const [isPaid, setIsPaid] = useState(false);
  const [billTaxRate, setBillTaxRate] = useState(0);
  const [billPaymentMethod, setBillPaymentMethod] = useState<SessionBill['payment_method']>(undefined);
  const [billSplits, setBillSplits] = useState<SessionBill['splits']>(undefined);
  const [isExpanded, setIsExpanded] = useState(false);


  // Online payment QR modal state
  const [showQRModal, setShowQRModal] = useState(false);
  const [paymentLinkUrl, setPaymentLinkUrl] = useState('');
  const [paymentLinkAmount, setPaymentLinkAmount] = useState(0);
  const [isGeneratingLink, setIsGeneratingLink] = useState(false);

  const [isRequestingCollection, setIsRequestingCollection] = useState(false);

  // UPI QR generator
  const [upiId, setUpiId]           = useState<string | null>(null);
  const [upiName, setUpiName]       = useState<string>('');
  const [showUpiModal, setShowUpiModal] = useState(false);
  const [upiAmount, setUpiAmount]   = useState('');
  const [upiUri, setUpiUri]         = useState<string | null>(null);

  // Action menu + swap-table state for the 3-dot header
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [printMenuOpen, setPrintMenuOpen] = useState(false);
  const [swapOpen, setSwapOpen] = useState(false);
  const [swapSubmitting, setSwapSubmitting] = useState(false);

  // Extend time bottom sheet
  const [extendSheetOpen, setExtendSheetOpen] = useState(false);
  const [extendingMins, setExtendingMins] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Pull-to-refresh with a real spinner (was hardcoded refreshing={false}).
  const handleRefresh = async () => {
    setRefreshing(true);
    try { await loadBill(); } finally { setRefreshing(false); }
  };

  const openSwapModal = () => {
    setActionMenuOpen(false);
    setSwapOpen(true);
  };

  const confirmSwap = async ({ targetId, targetNumber }: { targetId: string; targetNumber: number }) => {
    if (!tableDbId) return;
    setSwapSubmitting(true);
    try {
      const res = await crewTables.transferSession(tableDbId, targetId);
      setSwapOpen(false);
      router.replace('/(staff)');
      showDialog(
        'Moved',
        `Guest moved to T${String(res.data.toTableNumber).padStart(2, '0')} — ${res.data.ordersMoved} order${res.data.ordersMoved === 1 ? '' : 's'} relocated.`,
        [{ label: 'OK', onPress: () => {} }],
      );
    } catch (e: any) {
      showDialog('Could not move', e?.message ?? 'Please try again.', [{ label: 'OK', onPress: () => {} }]);
    } finally {
      setSwapSubmitting(false);
    }
  };

  const [dialog, setDialog] = useState<{
    visible: boolean; title: string; message: string;
    actions: { label: string; onPress: () => void; variant?: 'default' | 'danger' | 'primary' }[];
  }>({ visible: false, title: '', message: '', actions: [] });

  const closeDialog = () => setDialog(prev => ({ ...prev, visible: false }));
  const showDialog = (title: string, message: string, actions: typeof dialog['actions']) => {
    setDialog({ visible: true, title, message, actions: actions.map(a => ({ ...a, onPress: () => { closeDialog(); a.onPress(); } })) });
  };

  // Extend the table's session timer — called from the bottom sheet tiles.
  const extendTime = async (minutes: 15 | 30 | 45 | 60) => {
    if (!tableDbId || extendingMins) return;
    setExtendingMins(minutes);
    try {
      const res = await crewTables.extendSession(tableDbId, minutes);
      setExpiresAt(res.data.expiresAt);
      setExtendSheetOpen(false);
    } catch (e: any) {
      const code = e?.error || e?.message || '';
      const msg = code === 'NO_ACTIVE_SESSION'
        ? 'This table has no active session to extend.'
        : 'Could not extend the timer. Please try again.';
      showDialog('Could not extend', msg, [{ label: 'OK', onPress: () => {} }]);
    } finally {
      setExtendingMins(null);
    }
  };

  const openExtendMenu = () => {
    setActionMenuOpen(false);
    setExtendSheetOpen(true);
  };

  const loadBill = async () => {
    if (!sessionId) { setIsLoading(false); return; }
    try {
      const bill = await crewSessions.getBill(sessionId);
      // Prefer the canonical breakdown when present; fall back to legacy flat
      // fields for older backend responses.
      const bd = bill.breakdown;
      const rate    = bd?.taxRate ?? bill.tax_rate ?? 0;
      const subt    = bd?.subtotal ?? bill.session_total;
      const tax     = bd?.taxAmount ?? bill.tax_total ?? (subt * (rate / 100));
      const charges = bd?.chargesTotal ?? bill.service_charge_total ?? 0;
      const tipV    = bd?.tip ?? bill.tip_total ?? 0;
      const explicitDisc = bd?.discount ?? bill.discount_total ?? 0;
      const explicitGrand = bd?.total ?? bill.total_payable;
      const inferredDisc = explicitDisc > 0 || explicitGrand == null
        ? explicitDisc
        : Math.max(0, Math.round((subt + tax + charges + tipV - explicitGrand) * 100) / 100);
      const disc    = inferredDisc;
      const grand   = explicitGrand ?? (subt + tax + charges + tipV - disc);
      setOrders(bill.orders);
      setSessionTotal(subt);
      setBillTaxRate(rate);
      setTaxTotal(tax);
      setServiceChargeTotal(charges);
      setDiscountTotal(disc);
      setTipTotal(tipV);
      setPayableTotal(grand);
      setSessionStatus(bill.status);
      setSessionRef(bill.session_ref ?? '');
      setIsPaid(bill.status === 'paid');
      setBillPaymentMethod(bill.payment_method);
      setBillSplits(bill.splits);
      if (bill.expires_at !== undefined) setExpiresAt(bill.expires_at ?? null);
      if (bill.customer_name !== undefined) setSessionCustomerName(bill.customer_name ?? null);
      if (bill.customer_phone !== undefined) setSessionCustomerPhone(bill.customer_phone ?? null);
      if (bill.started_at) {
        const d = new Date(bill.started_at);
        setSince(`${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`);
      }
    } catch {
      // keep current
    } finally {
      setIsLoading(false);
    }
  };

  // Load once on mount; Ably drives all subsequent updates
  useEffect(() => { loadBill(); }, [sessionId]);

  // Refresh bill whenever screen regains focus — ensures the "Collect Payment"
  // button and paid badge settle immediately after returning from payment-collect.
  useFocusEffect(
    useCallback(() => {
      void loadBill();
    }, [sessionId]),
  );


  useEffect(() => {
    const restaurantId = staffInfo?.restaurantId;
    if (!restaurantId) return;
    let cancelled = false;
    restaurantApi.getBranding(restaurantId)
      .then((res) => {
        if (cancelled || !res?.success) return;
        setRestaurantInvoiceMeta({
          address: res.data.address ?? null,
          phone: res.data.phone ?? null,
          email: res.data.email ?? null,
          fssaiLicenseNumber: res.data.fssaiLicenseNumber ?? null,
        });
        if (res.data.upiId) {
          setUpiId(res.data.upiId);
          setUpiName(res.data.upiDisplayName ?? res.data.name ?? '');
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [staffInfo?.restaurantId]);

  // Ably: waiter:{restaurantId} — refresh bill on any order/payment event
  useEffect(() => {
    const restaurantId = staffInfo?.restaurantId;
    if (!restaurantId || !sessionId) return;
    const refetch = () => void loadBill();
    const unsubs = [
      subscribeChannel(`waiter:${restaurantId}`, 'order_ready',       refetch),
      subscribeChannel(`waiter:${restaurantId}`, 'order_served',      refetch),
      subscribeChannel(`waiter:${restaurantId}`, 'item_bumped',       refetch),
      subscribeChannel(`waiter:${restaurantId}`, 'item_ready',        refetch),
      subscribeChannel(`waiter:${restaurantId}`, 'new_order',         refetch),
      subscribeChannel(`waiter:${restaurantId}`, 'payment_confirmed', refetch),
      // If this session ends from another device (or via diner/partner),
      // pop the modal so the waiter isn't left staring at a stale bill.
      subscribeChannel(`waiter:${restaurantId}`, 'session_ended', (data: any) => {
        const endedId = data?.sessionId as string | undefined;
        if (endedId && endedId === sessionId) {
          router.back();
        }
      }),
    ];
    return () => unsubs.forEach(u => u());
  }, [staffInfo?.restaurantId, sessionId, router]);


  // Flat list of all items across all orders
  const flatItems = useMemo<FlatItem[]>(() =>
    orders.flatMap(order =>
      order.items.map(item => ({
        key: item.item_id,
        item_id: item.item_id,
        order_id: order.order_id,
        name: `${item.qty}× ${item.name}`,
        modifiersSummary: item.modifiers_summary,
        status: itemStatus(item),
        price: item.price * item.qty,
        orderedAt: formatTime(order.placed_at),
        qty: item.qty,
      }))
    ), [orders]);

  const servedCount = flatItems.filter(i => i.status === 'served').length;
  const totalCount = flatItems.length;
  const serviceProgress = totalCount > 0 ? servedCount / totalCount : 0;
  const progressAnim = React.useRef(new Animated.Value(serviceProgress)).current;

  useEffect(() => {
    Animated.spring(progressAnim, { toValue: serviceProgress, useNativeDriver: false, bounciness: 4, speed: 12 }).start();
  }, [serviceProgress]);

  const tax = taxTotal;
  const grandTotal = payableTotal;

  const handleServe = async (item: FlatItem) => {
    if (item.status === 'served') return; // already served, no-op
    // Optimistic update
    setOrders(prev => prev.map(o => {
      if (o.order_id !== item.order_id) return o;
      return { ...o, items: o.items.map(i => i.item_id === item.item_id ? { ...i, served: true } : i) };
    }));
    try {
      await crewOrders.serveItem(item.order_id, item.item_id);
      await loadBill(); // refresh from server — same pattern as kitchen
    } catch {
      // Revert on failure
      setOrders(prev => prev.map(o => {
        if (o.order_id !== item.order_id) return o;
        return { ...o, items: o.items.map(i => i.item_id === item.item_id ? { ...i, served: false } : i) };
      }));
    }
  };

  // Cash collection lives in app/(staff)/cash-collection.tsx now — accessible
  // via the cash icon in the staff dashboard header. The table screen no
  // longer offers a "Collect Cash" action because cash collection is driven
  // by diner-initiated cash checkouts (paymentStatus: PENDING_CASH).

  // Auto-dismiss QR modal when Ably payment_confirmed arrives and isPaid flips
  useEffect(() => {
    if (isPaid && showQRModal) setShowQRModal(false);
  }, [isPaid]);

  const requestCollection = async () => {
    if (isPaid || !sessionId || isRequestingCollection || grandTotal <= 0 || orders.length === 0) return;
    setIsRequestingCollection(true);
    try {
      await crewSessions.requestCollection(sessionId, sessionCustomerPhone ?? '', sessionCustomerName ?? null);
      await loadBill();
      router.push('/(staff)/cash-collection');
    } catch (err: any) {
      showDialog(
        'Could not create collection request',
        err?.message ?? 'Please try again from the Payment Collection screen.',
      );
    } finally {
      setIsRequestingCollection(false);
    }
  };

  const handleRequestOnlinePayment = async () => {
    if (isPaid || !sessionId || isGeneratingLink) return;
    setIsGeneratingLink(true);
    try {
      const result = await crewPayments.requestOnlinePaymentLink(sessionId);
      setPaymentLinkUrl(result.payment_link_url);
      setPaymentLinkAmount(result.amount);
      setShowQRModal(true);
    } catch (e: any) {
      showDialog(
        'Error',
        e.message ?? 'Could not generate payment link. Please try again.',
        [{ label: 'OK', onPress: () => {} }],
      );
    } finally {
      setIsGeneratingLink(false);
    }
  };

  // ── Print handlers ──────────────────────────────────────────────────────────

  const handlePrintKot = () => {
    setPrintMenuOpen(false);
    const latestOrder = [...orders].sort(
      (a, b) => new Date(b.placed_at).getTime() - new Date(a.placed_at).getTime(),
    )[0];
    if (!latestOrder) {
      showDialog('No Orders', 'There are no orders to reprint.', [{ label: 'OK', onPress: () => {} }]);
      return;
    }
    void printerApi
      .reprint(latestOrder.order_id, 'Manual reprint from staff screen')
      .then(() =>
        showDialog('Sent', 'Reprint request sent to kitchen printer.', [{ label: 'OK', onPress: () => {} }]),
      )
      .catch(() =>
        showDialog('Error', 'Could not send reprint request. Please try again.', [{ label: 'OK', onPress: () => {} }]),
      );
  };

  const handlePrintInvoice = async () => {
    setPrintMenuOpen(false);
    if (getPrinterStatus() !== 'connected') {
      showDialog(
        'No Printer Paired',
        'No Bluetooth printer is connected to this device. Go to Profile → Printer Settings to pair one.',
        [{ label: 'OK', onPress: () => {} }],
      );
      return;
    }

    const invoiceItems: InvoiceBill['items'] = orders.flatMap(order =>
      order.items.map(item => ({
        name: item.name,
        qty: item.qty,
        unitPrice: item.price,
        modifiersSummary: item.modifiers_summary,
      })),
    );

    let invoiceMeta = restaurantInvoiceMeta;
    if (!invoiceMeta && staffInfo?.restaurantId) {
      try {
        const res = await restaurantApi.getBranding(staffInfo.restaurantId);
        if (res?.success) {
          invoiceMeta = {
            address: res.data.address ?? null,
            phone: res.data.phone ?? null,
            email: res.data.email ?? null,
            fssaiLicenseNumber: res.data.fssaiLicenseNumber ?? null,
          };
          setRestaurantInvoiceMeta(invoiceMeta);
        }
      } catch {}
    }

    const result = await printBill({
      restaurantName: staffInfo?.restaurantName ?? '',
      restaurantAddress: invoiceMeta?.address ?? null,
      restaurantPhone: invoiceMeta?.phone ?? null,
      restaurantEmail: invoiceMeta?.email ?? null,
      fssaiLicenseNumber: invoiceMeta?.fssaiLicenseNumber ?? null,
      tableNumber: tableNum,
      sessionRef: sessionRef || toSessionRef(sessionId),
      items: invoiceItems,
      subtotal: sessionTotal,
      discount: discountTotal,
      charges: serviceChargeTotal,
      tax: taxTotal,
      taxRate: billTaxRate,
      grandTotal,
      isPaid,
      paymentMethod: billPaymentMethod,
      splits: billSplits?.map(s => ({ method: s.method ?? '', amount: Number(s.amount ?? 0) })),
      orderDateTime: orders[0]?.placed_at ?? undefined,
      generatedAt: new Date().toISOString(),
    });

    if (result === 'failed') {
      showDialog(
        'Print Failed',
        'Could not print the invoice. Check that the printer is nearby and powered on.',
        [{ label: 'OK', onPress: () => {} }],
      );
    }
  };

  const handleEndSession = () => {
    showDialog(
      'End Session',
      `Close Table T${tableNum} and release it for new guests?`,
      [
        { label: 'Cancel', onPress: () => {} },
        {
          label: 'End Session',
          variant: 'danger',
          onPress: async () => {
            try {
              if (sessionId) await crewSessions.end(sessionId);
              router.replace('/(staff)');
            } catch (err: any) {
              const code = err?.error || err?.message || '';
              if (code === 'SESSION_ALREADY_CLOSED') {
                // Session was already closed (e.g. by diner payment or partner) —
                // table is already free, just go back.
                router.replace('/(staff)');
              } else {
                showDialog(
                  'Could Not Free Table',
                  'Something went wrong while ending the session. Please try again.',
                  [{ label: 'OK', onPress: () => {} }],
                );
              }
            }
          },
        },
      ],
    );
  };

  if (isLoading) {
    return (
      <View style={[styles.container, { paddingTop: insets.top + Spacing.sm }]}>
        {/* ── Header skeleton ── */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={[styles.iconBtn, { backgroundColor: QuinckleColors.surfaceMuted }]} />
            <View style={{ gap: 6 }}>
              <Skeleton width={56} height={22} radius={6} />
              <Skeleton width={80} height={11} radius={4} />
            </View>
          </View>
          <View style={styles.headerRight}>
            {[1, 2, 3].map(i => (
              <View key={i} style={[styles.iconBtn, { backgroundColor: QuinckleColors.surfaceMuted }]} />
            ))}
          </View>
        </View>

        {/* ── Session group skeleton ── */}
        <Skeleton width={52} height={10} radius={4} style={{ marginBottom: Spacing.sm }} />
        <View style={[styles.sessionGroup, { overflow: 'hidden' }]}>
          {[90, 70, 80].map((w, i) => (
            <View key={i}>
              {i > 0 && <View style={styles.sessionInfoSep} />}
              <View style={styles.sessionInfoRow}>
                <Skeleton width={40} height={13} radius={4} />
                <Skeleton width={w} height={13} radius={4} />
              </View>
            </View>
          ))}
        </View>

        {/* ── Active Orders section header skeleton ── */}
        <View style={[styles.sectionHeader, { marginTop: Spacing.md }]}>
          <View style={styles.sectionTitleRow}>
            <Skeleton width={110} height={11} radius={4} />
            <Skeleton width={60} height={11} radius={4} />
          </View>
          <View style={[styles.serviceProgressTrack, { marginTop: Spacing.sm }]}>
            <Skeleton width="30%" height={3} radius={2} style={{ opacity: 0.5 }} />
          </View>
        </View>

        {/* ── Order item rows skeleton ── */}
        {[1, 2, 3].map(i => (
          <View key={i} style={styles.orderItemRow}>
            <View style={{ flex: 1, gap: 6 }}>
              <Skeleton width={`${55 + i * 12}%`} height={15} radius={5} />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Skeleton width={44} height={11} radius={4} />
                <Skeleton width={32} height={11} radius={4} />
              </View>
            </View>
            <Skeleton width={72} height={28} radius={6} />
          </View>
        ))}

        {/* ── Bottom bar skeleton ── */}
        <View style={[styles.bottomBar, { position: 'absolute', bottom: 0, left: 0, right: 0 }]}>
          <View style={styles.totalRow}>
            <View style={{ gap: 8 }}>
              <Skeleton width={80} height={10} radius={4} />
              <Skeleton width={48} height={18} radius={5} />
            </View>
            <Skeleton width={70} height={26} radius={6} />
          </View>
          <Skeleton width="100%" height={46} radius={Radius.md} style={{ marginTop: Spacing.md }} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top + Spacing.sm }]}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={20} color={QuinckleColors.textPrimary} />
          </TouchableOpacity>
          <View>
            <Text style={styles.tableTitle}>T{tableNum}</Text>
            {sessionRef ? <Text style={styles.sessionRefText}>{sessionRef}</Text> : null}
          </View>
        </View>
        <View style={styles.headerRight}>
          {/* ── Add items (manual order) icon ── */}
          {/* Available for any open session — staff can add orders even after
              prior items are paid (pay-first settles each order, but the diner
              keeps ordering). Only hide once the session is fully closed. */}
          {!!sessionId && sessionStatus !== 'closed' && (
            <TouchableOpacity
              onPress={() => router.push({
                pathname: '/(staff)/order-menu',
                params: {
                  tableId: String(tableId),
                  tableNum,
                  tableDbId: tableDbId ?? '',
                  sessionId,
                  customerPhone: sessionCustomerPhone ?? '',
                  customerName: sessionCustomerName ?? '',
                },
              })}
              style={styles.iconBtn}
              activeOpacity={0.7}
            >
              <Ionicons name="add-circle-outline" size={20} color={QuinckleColors.textPrimary} />
            </TouchableOpacity>
          )}

          {/* ── UPI QR generator ── */}
          {upiId && (
            <TouchableOpacity
              onPress={() => { setUpiAmount(''); setUpiUri(null); setShowUpiModal(true); }}
              style={styles.iconBtn}
              activeOpacity={0.7}
            >
              <Ionicons name="qr-code-outline" size={18} color={QuinckleColors.textPrimary} />
            </TouchableOpacity>
          )}

          {/* ── Print icon + popover ── */}
          <View style={{ position: 'relative' }}>
            <TouchableOpacity
              onPress={() => { setActionMenuOpen(false); setPrintMenuOpen(o => !o); }}
              style={styles.iconBtn}
              activeOpacity={0.7}
            >
              <Ionicons name="print-outline" size={18} color={QuinckleColors.textPrimary} />
            </TouchableOpacity>
            {printMenuOpen && (
              <View style={styles.actionMenu}>
                <TouchableOpacity
                  onPress={handlePrintKot}
                  style={styles.actionMenuItem}
                  activeOpacity={0.7}
                >
                  <Ionicons name="restaurant-outline" size={14} color={QuinckleColors.textPrimary} />
                  <Text style={styles.actionMenuText}>Print KOT</Text>
                </TouchableOpacity>
                <View style={styles.actionMenuDivider} />
                <TouchableOpacity
                  onPress={() => { void handlePrintInvoice(); }}
                  style={styles.actionMenuItem}
                  activeOpacity={0.7}
                >
                  <Ionicons name="receipt-outline" size={14} color={QuinckleColors.textPrimary} />
                  <Text style={styles.actionMenuText}>Print Invoice</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* ── Three-dot menu ── */}
          <View style={{ position: 'relative' }}>
            <TouchableOpacity onPress={() => { setPrintMenuOpen(false); setActionMenuOpen(o => !o); }} style={styles.iconBtn} activeOpacity={0.7}>
              <Ionicons name="ellipsis-horizontal" size={18} color={QuinckleColors.textPrimary} />
            </TouchableOpacity>
            {actionMenuOpen && (
              <View style={styles.actionMenu}>
                <TouchableOpacity
                  onPress={() => { void openSwapModal(); }}
                  style={styles.actionMenuItem}
                  activeOpacity={0.7}
                >
                  <Ionicons name="swap-horizontal" size={14} color={QuinckleColors.textPrimary} />
                  <Text style={styles.actionMenuText}>Swap table</Text>
                </TouchableOpacity>
                <View style={styles.actionMenuDivider} />
                <TouchableOpacity
                  onPress={openExtendMenu}
                  style={styles.actionMenuItem}
                  activeOpacity={0.7}
                >
                  <Ionicons name="time-outline" size={14} color={QuinckleColors.textPrimary} />
                  <Text style={styles.actionMenuText}>Extend time</Text>
                </TouchableOpacity>
              {!isPaid && (
                <>
                  <View style={styles.actionMenuDivider} />
                  <TouchableOpacity
                    onPress={() => {
                      setActionMenuOpen(false);
                      void requestCollection();
                    }}
                    style={styles.actionMenuItem}
                    disabled={isRequestingCollection}
                    activeOpacity={0.7}
                  >
                    <Ionicons name="checkmark-circle-outline" size={14} color={QuinckleColors.success} />
                    <Text style={[styles.actionMenuText, { color: QuinckleColors.success }]}>
                      {isRequestingCollection ? 'Requesting...' : 'Send to Payment Collection'}
                    </Text>
                  </TouchableOpacity>
                </>
              )}
              <View style={styles.actionMenuDivider} />
              <TouchableOpacity
                onPress={() => { setActionMenuOpen(false); handleEndSession(); }}
                style={styles.actionMenuItem}
                activeOpacity={0.7}
              >
                <Ionicons name="log-out-outline" size={14} color={QuinckleColors.danger} />
                <Text style={[styles.actionMenuText, { color: QuinckleColors.danger }]}>End session</Text>
              </TouchableOpacity>
            </View>
          )}
          </View>{/* end three-dot position:relative */}
        </View>{/* end headerRight */}
      </View>{/* end header */}


      {/* Session section */}
      <Text style={styles.sessionSectionLabel}>Session</Text>
      <View style={styles.sessionGroup}>
        <View style={styles.sessionInfoRow}>
          <Text style={styles.sessionInfoLabel}>Ref</Text>
          <Text style={[styles.sessionInfoValue, styles.sessionRefMono]}>
            {sessionRef || toSessionRef(sessionId)}
          </Text>
        </View>
        {since ? (
          <>
            <View style={styles.sessionInfoSep} />
            <View style={styles.sessionInfoRow}>
              <Text style={styles.sessionInfoLabel}>Opened</Text>
              <Text style={styles.sessionInfoValue}>{since}</Text>
            </View>
          </>
        ) : null}
        {(countdownStr || elapsed) ? (
          <>
            <View style={styles.sessionInfoSep} />
            <View style={styles.sessionInfoRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Ionicons name="timer-outline" size={13} color={isNearExpiry ? QuinckleColors.danger : QuinckleColors.textSecondary} />
                <Text style={[styles.sessionInfoLabel, isNearExpiry && { color: QuinckleColors.danger }]}>
                  {countdownStr ? 'Time left' : 'Active for'}
                </Text>
              </View>
              <Text style={[styles.sessionInfoValueStrong, { fontVariant: ['tabular-nums'] as any }, isNearExpiry && { color: QuinckleColors.danger }]}>
                {countdownStr ?? elapsed}
              </Text>
            </View>
          </>
        ) : null}
      </View>

      <View style={styles.sectionHeader}>
        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionTitle}>Active Orders</Text>
          <Text style={styles.progressText}>{servedCount}/{totalCount} served</Text>
        </View>
        <View style={styles.serviceProgressTrack}>
          <Animated.View
            style={[styles.serviceProgressFill, {
              width: progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
            }]}
          />
        </View>
      </View>

      <FlatList
        data={flatItems}
        keyExtractor={item => item.key}
        contentContainerStyle={styles.listContent}
        onRefresh={handleRefresh}
        refreshing={refreshing}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="restaurant-outline" size={28} color={QuinckleColors.textTertiary} />
            <Text style={styles.emptyText}>No items ordered yet.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const isServed = item.status === 'served';
          return (
            <View style={[styles.orderItemRow, isServed && { opacity: 0.55 }]}>
              <View style={styles.orderItemLeft}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.itemName, isServed && styles.itemNameServed]}>{item.name}</Text>
                  {item.modifiersSummary ? (
                    <Text style={styles.itemModifiers} numberOfLines={1}>{item.modifiersSummary}</Text>
                  ) : null}
                  <View style={styles.itemMetaRow}>
                    <Text style={styles.itemPrice}>₹{item.price.toFixed(0)}</Text>
                    <Text style={styles.itemDot}>·</Text>
                    <Text style={styles.itemTime}>{item.orderedAt}</Text>
                  </View>
                </View>
              </View>

              {isServed ? (
                <View style={styles.servedBadge}>
                  <Ionicons name="checkmark" size={11} color="#4ade80" />
                  <Text style={styles.servedBadgeText}>Served</Text>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.markServedBtn}
                  onPress={() => void handleServe(item)}
                  activeOpacity={0.75}
                >
                  <Text style={styles.markServedText}>Mark served</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        }}
      />

      <View style={[styles.bottomBar, isExpanded && styles.bottomBarExpanded]}>
        {isExpanded && (
          <View style={styles.accordionContent}>
            <View style={styles.billHeader}>
              <Text style={styles.billTitle}>Bill Details</Text>
              <TouchableOpacity onPress={() => setIsExpanded(false)}>
                <Ionicons name="chevron-down" size={20} color={QuinckleColors.textTertiary} />
              </TouchableOpacity>
            </View>

            <View style={styles.billItemsContainer}>
              {flatItems.map(item => (
                <View key={item.key} style={styles.billItemRow}>
                  <Text style={styles.billItemName}>{item.name}</Text>
                  <Text style={styles.billItemPrice}>₹{item.price.toFixed(0)}</Text>
                </View>
              ))}
            </View>

            <View style={styles.billDivider} />
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Subtotal</Text>
              <Text style={styles.summaryValue}>₹{sessionTotal.toFixed(0)}</Text>
            </View>
            {discountTotal > 0 && (
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Discount</Text>
                <Text style={[styles.summaryValue, { color: '#86efac' }]}>−₹{discountTotal.toFixed(0)}</Text>
              </View>
            )}
            {serviceChargeTotal !== 0 && (
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>{serviceChargeTotal > 0 ? 'Service charge' : 'Adjustment'}</Text>
                <Text style={[styles.summaryValue, serviceChargeTotal < 0 && { color: '#86efac' }]}>
                  {serviceChargeTotal < 0 ? '−' : ''}₹{Math.abs(serviceChargeTotal).toFixed(0)}
                </Text>
              </View>
            )}
            {tax > 0 && (
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>{billTaxRate > 0 ? `GST (${billTaxRate}%)` : 'Tax'}</Text>
                <Text style={styles.summaryValue}>₹{tax.toFixed(2)}</Text>
              </View>
            )}
            {tipTotal > 0 && (
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Tip</Text>
                <Text style={styles.summaryValue}>₹{tipTotal.toFixed(0)}</Text>
              </View>
            )}
            <View style={styles.grandTotalRow}>
              <Text style={styles.grandTotalLabel}>Grand Total</Text>
              <Text style={styles.grandTotalValue}>₹{grandTotal.toFixed(2)}</Text>
            </View>

          </View>
        )}

        <TouchableOpacity style={styles.totalRow} activeOpacity={0.85} onPress={() => setIsExpanded(!isExpanded)}>
          <View>
            <Text style={styles.totalLabel}>Total Payable</Text>
            <View style={[styles.paidBadge, isPaid ? styles.paidBadgeActive : styles.paidBadgeInactive]}>
              <Text style={[styles.paidBadgeText, isPaid ? styles.paidBadgeTextActive : styles.paidBadgeTextInactive]}>
                {isPaid
                  ? billPaymentMethod === 'cash' ? 'via Cash'
                  : billPaymentMethod === 'upi_direct' ? 'via UPI'
                  : billPaymentMethod === 'mixed' ? 'Split'
                  : 'Settled'
                  : 'Pending'}
              </Text>
            </View>
          </View>
          <View style={styles.totalValueContainer}>
            <Text style={styles.totalValue}>₹{grandTotal.toFixed(0)}</Text>
            <Ionicons name={isExpanded ? 'chevron-down' : 'chevron-up'} size={18} color={QuinckleColors.textTertiary} style={{ marginLeft: Spacing.sm }} />
          </View>
        </TouchableOpacity>

        {!isPaid && grandTotal > 0 && orders.length > 0 && (
          <TouchableOpacity
            style={[styles.collectBtn, isRequestingCollection && { opacity: 0.65 }]}
            onPress={() => {
              setIsExpanded(false);
              void requestCollection();
            }}
            disabled={isRequestingCollection}
            activeOpacity={0.85}
          >
            {isRequestingCollection ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="cash-outline" size={16} color="#fff" />
            )}
            <Text style={styles.collectBtnText}>
              {isRequestingCollection ? 'Creating request...' : 'Send to Payment Collection'}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      <ThemedDialog visible={dialog.visible} title={dialog.title} message={dialog.message} actions={dialog.actions} onClose={closeDialog} />

      {/* ── UPI QR modal ── */}
      <Modal visible={showUpiModal} transparent animationType="fade" onRequestClose={() => setShowUpiModal(false)}>
        <View style={styles.swapBackdrop}>
          <View style={styles.swapCard}>
            {!upiUri ? (
              <>
                <Text style={styles.swapEyebrow}>UPI Payment</Text>
                <Text style={styles.swapTitle}>Generate QR</Text>
                <Text style={styles.swapSubtitle}>{upiId}</Text>

                <View style={[styles.dinerInputWrap, { marginTop: 16 }]}>
                  <View style={styles.dinerCountryCode}>
                    <Text style={styles.dinerCountryCodeText}>₹</Text>
                  </View>
                  <View style={styles.dinerDivider} />
                  <TextInput
                    style={styles.dinerInput}
                    value={upiAmount}
                    onChangeText={v => setUpiAmount(v.replace(/[^0-9.]/g, ''))}
                    placeholder="Enter amount"
                    placeholderTextColor={QuinckleColors.textMuted}
                    keyboardType="decimal-pad"
                    returnKeyType="done"
                    autoFocus
                    onSubmitEditing={() => {
                      const amt = parseFloat(upiAmount);
                      if (!amt || amt <= 0 || !upiId) return;
                      const enc = (v: string | number) => encodeURIComponent(String(v));
                      setUpiUri(`upi://pay?pa=${enc(upiId)}&pn=${enc(upiName)}&am=${enc(amt.toFixed(2))}&cu=INR`);
                    }}
                  />
                </View>

                <View style={styles.swapFooter}>
                  <TouchableOpacity style={styles.swapCancel} onPress={() => setShowUpiModal(false)} activeOpacity={0.8}>
                    <Text style={styles.swapCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.swapConfirm, !(parseFloat(upiAmount) > 0) && { opacity: 0.4 }]}
                    onPress={() => {
                      const amt = parseFloat(upiAmount);
                      if (!amt || amt <= 0 || !upiId) return;
                      const enc = (v: string | number) => encodeURIComponent(String(v));
                      setUpiUri(`upi://pay?pa=${enc(upiId)}&pn=${enc(upiName)}&am=${enc(amt.toFixed(2))}&cu=INR`);
                    }}
                    disabled={!(parseFloat(upiAmount) > 0)}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.swapConfirmText}>Generate QR</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.swapEyebrow}>Scan to Pay</Text>
                <Text style={styles.swapTitle}>₹{parseFloat(upiAmount).toFixed(0)}</Text>
                <Text style={[styles.swapSubtitle, { marginBottom: 20 }]}>{upiName || upiId}</Text>

                <View style={{ alignItems: 'center', marginBottom: 20 }}>
                  <View style={{ padding: 16, backgroundColor: '#fff', borderRadius: Radius.lg }}>
                    <QRCode value={upiUri} size={200} />
                  </View>
                  <Text style={{ color: QuinckleColors.textMuted, fontSize: 11, marginTop: 10 }}>
                    Ask guest to scan with any UPI app
                  </Text>
                </View>

                <View style={styles.swapFooter}>
                  <TouchableOpacity style={styles.swapCancel} onPress={() => setUpiUri(null)} activeOpacity={0.8}>
                    <Text style={styles.swapCancelText}>← Change amount</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.swapConfirm} onPress={() => setShowUpiModal(false)} activeOpacity={0.8}>
                    <Text style={styles.swapConfirmText}>Done</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* Swap-table bottom sheet */}
      <SwapTableSheet
        visible={swapOpen}
        currentTableDbId={tableDbId ?? ''}
        currentTableNum={tableNum}
        onClose={() => setSwapOpen(false)}
        onSwap={confirmSwap}
        submitting={swapSubmitting}
      />

      {/* ── Extend time bottom sheet ── */}
      <BottomSheet
        visible={extendSheetOpen}
        onClose={() => !extendingMins && setExtendSheetOpen(false)}
        title="Extend session"
      >
        <Text style={styles.extendSub}>
          {countdownStr
            ? `${isNearExpiry ? '⚠️ ' : ''}${countdownStr} remaining on T${tableNum}`
            : `Active session on T${tableNum}`}
        </Text>

        <View style={styles.extendGrid}>
          {([15, 30, 45, 60] as const).map(mins => {
            const busy = extendingMins === mins;
            const newExpiry = (() => {
              const base = expiresAt ? new Date(expiresAt) : new Date();
              base.setMinutes(base.getMinutes() + mins);
              return `${String(base.getHours()).padStart(2, '0')}:${String(base.getMinutes()).padStart(2, '0')}`;
            })();
            return (
              <TouchableOpacity
                key={mins}
                style={[styles.extendTile, !!extendingMins && !busy && { opacity: 0.4 }]}
                onPress={() => { void extendTime(mins); }}
                disabled={!!extendingMins}
                activeOpacity={0.8}
              >
                {busy ? (
                  <ActivityIndicator color={QuinckleColors.primary} />
                ) : (
                  <>
                    <Text style={styles.extendTileMins}>+{mins}</Text>
                    <Text style={styles.extendTileUnit}>min</Text>
                    {expiresAt && (
                      <Text style={styles.extendTileExpiry}>until {newExpiry}</Text>
                    )}
                  </>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={{ height: Spacing.md }} />
      </BottomSheet>

      {/* Online Payment QR Modal */}
      <Modal
        visible={showQRModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowQRModal(false)}
      >
        <View style={styles.qrModalContainer}>
          <View style={styles.qrModalHeader}>
            <Text style={styles.qrModalTitle}>Scan to Pay</Text>
            <TouchableOpacity style={styles.iconBtn} onPress={() => setShowQRModal(false)}>
              <Ionicons name="close" size={20} color={QuinckleColors.textPrimary} />
            </TouchableOpacity>
          </View>

          <View style={styles.qrModalBody}>
            <Text style={styles.qrAmountLabel}>Amount Due</Text>
            <Text style={styles.qrAmount}>₹{paymentLinkAmount.toFixed(0)}</Text>

            <View style={styles.qrCodeWrapper}>
              {paymentLinkUrl ? (
                <TouchableOpacity
                  style={styles.shareLinkBtn}
                  onPress={() => Share.share({ message: paymentLinkUrl })}
                  activeOpacity={0.85}
                >
                  <Ionicons name="share-outline" size={20} color="#09090b" />
                  <Text style={styles.shareLinkBtnText}>Share payment link</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            <Text style={styles.qrHint}>
              Share this link with the guest to collect payment
            </Text>

            <View style={styles.qrWaitingRow}>
              <ActivityIndicator size="small" color={QuinckleColors.textTertiary} />
              <Text style={styles.qrWaitingText}>Waiting for payment confirmation…</Text>
            </View>
          </View>

          <TouchableOpacity
            style={styles.qrCancelBtn}
            onPress={() => setShowQRModal(false)}
            activeOpacity={0.8}
          >
            <Text style={styles.qrCancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  actionMenu: {
    position: 'absolute',
    top: 44,
    right: 0,
    minWidth: 180,
    backgroundColor: QuinckleColors.surface,
    borderColor: QuinckleColors.border,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingVertical: 4,
    zIndex: 50,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  actionMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
  },
  actionMenuText: {
    color: QuinckleColors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  actionMenuDivider: {
    height: 1,
    backgroundColor: QuinckleColors.border,
    marginVertical: 2,
  },
  swapBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.lg,
  },
  swapCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: QuinckleColors.surface,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    borderColor: QuinckleColors.border,
    borderWidth: 1,
  },
  swapEyebrow: {
    color: QuinckleColors.textTertiary,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  swapTitle: {
    color: QuinckleColors.textPrimary,
    fontSize: 17,
    fontWeight: '700',
    marginTop: 4,
    letterSpacing: -0.3,
  },
  swapSubtitle: {
    color: QuinckleColors.textSecondary,
    fontSize: 12.5,
    marginTop: 4,
    marginBottom: Spacing.md,
  },
  swapEmpty: {
    paddingVertical: Spacing.lg,
    alignItems: 'center',
  },
  swapEmptyText: {
    color: QuinckleColors.textTertiary,
    fontSize: 13,
  },
  swapGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  swapTile: {
    width: '23%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    backgroundColor: QuinckleColors.surfaceMuted,
  },
  swapTileActive: {
    borderColor: QuinckleColors.success,
    backgroundColor: 'rgba(34, 197, 94, 0.12)',
  },
  swapTileNum: {
    color: QuinckleColors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
  },
  swapTileNumActive: {
    color: QuinckleColors.success,
  },
  swapTileSeats: {
    color: QuinckleColors.textTertiary,
    fontSize: 10,
    marginTop: 2,
  },
  swapFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.lg,
  },
  swapCancel: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
  },
  swapCancelText: {
    color: QuinckleColors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  swapConfirm: {
    backgroundColor: QuinckleColors.success,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 10,
  },
  swapConfirmText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  // Payment method selector
  // Payment method selector
  payMethodRow: { flexDirection: 'row', gap: 8 },
  payMethodBtn: {
    flex: 1, paddingVertical: 11, borderRadius: Radius.md,
    borderWidth: 1.5, borderColor: QuinckleColors.border,
    backgroundColor: QuinckleColors.surfaceMuted,
    alignItems: 'center',
  },
  payMethodBtnActive: {
    borderColor: QuinckleColors.primary,
    backgroundColor: 'rgba(243,93,59,0.10)',
  },
  payMethodText: { fontSize: 13, fontWeight: '600' as const, color: QuinckleColors.textSecondary },
  payMethodTextActive: { color: QuinckleColors.primary },

  // Payment confirm box
  payConfirmBox: {
    marginTop: 16, padding: Spacing.lg,
    backgroundColor: QuinckleColors.surfaceMuted,
    borderRadius: Radius.lg, borderWidth: 1, borderColor: QuinckleColors.border,
    gap: 4, alignItems: 'center',
  },
  payConfirmLabel: { fontSize: 11, fontWeight: '600' as const, color: QuinckleColors.textMuted, textTransform: 'uppercase' as const, letterSpacing: 0.8 },
  payConfirmAmount: { fontSize: 34, fontWeight: '700' as const, color: QuinckleColors.textPrimary, letterSpacing: -1 },
  payConfirmHint: { fontSize: 12, color: QuinckleColors.textSecondary, textAlign: 'center' as const, lineHeight: 18 },

  // Split breakdown
  splitBreakdown: {
    backgroundColor: QuinckleColors.surfaceMuted,
    borderRadius: Radius.md, borderWidth: 1, borderColor: QuinckleColors.border,
    padding: Spacing.md, gap: 6,
  },
  splitRow: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const },
  splitLabel: { fontSize: 13, color: QuinckleColors.textSecondary },
  splitAmt: { fontSize: 13, fontWeight: '700' as const, color: QuinckleColors.textPrimary },

  // Diner lookup badges
  dinerFoundBadge: {
    marginTop: 8, paddingHorizontal: 10, paddingVertical: 5,
    backgroundColor: 'rgba(34,197,94,0.12)',
    borderRadius: Radius.sm, borderWidth: 1, borderColor: 'rgba(34,197,94,0.3)',
    alignSelf: 'flex-start' as const,
  },
  dinerFoundText: { fontSize: 12, fontWeight: '600' as const, color: QuinckleColors.success },
  dinerNotFoundText: { fontSize: 12, color: QuinckleColors.textMuted, marginTop: 6, fontStyle: 'italic' as const },

  // Diner identity input
  dinerInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: QuinckleColors.surfaceElevated,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    height: 48,
    overflow: 'hidden',
  },
  dinerCountryCode: {
    paddingHorizontal: 12,
    height: '100%',
    justifyContent: 'center',
  },
  dinerCountryCodeText: {
    color: QuinckleColors.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
  dinerDivider: {
    width: 1,
    height: '60%',
    backgroundColor: QuinckleColors.border,
  },
  dinerInput: {
    flex: 1,
    color: QuinckleColors.textPrimary,
    fontSize: 15,
    paddingHorizontal: 12,
    height: '100%',
  },

  container: { flex: 1, backgroundColor: QuinckleColors.background, paddingHorizontal: Spacing.lg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.xl },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  iconBtn: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: QuinckleColors.surfaceMuted, borderWidth: 1, borderColor: QuinckleColors.border, alignItems: 'center', justifyContent: 'center' },
  tableTitle: { fontSize: 22, fontWeight: '700', color: QuinckleColors.textPrimary, letterSpacing: -0.4 },
  sessionRefText: {
    marginTop: 2,
    color: QuinckleColors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
  sinceText: { fontSize: 11, color: QuinckleColors.textTertiary, fontWeight: '500', marginTop: 1 },
  sessionSectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: QuinckleColors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: Spacing.sm,
  },
  sessionGroup: {
    backgroundColor: QuinckleColors.surface,
    borderRadius: Radius.lg,
    overflow: 'hidden',
    marginBottom: Spacing.xl,
  },
  sessionInfoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: 12,
  },
  sessionInfoSep: {
    height: 0.5,
    backgroundColor: QuinckleColors.borderSubtle,
    marginLeft: Spacing.lg,
  },
  sessionInfoLabel: {
    fontSize: 14,
    color: QuinckleColors.textSecondary,
    fontWeight: '400',
  },
  sessionInfoValue: {
    fontSize: 14,
    color: QuinckleColors.textPrimary,
    fontWeight: '400',
  },
  sessionInfoValueStrong: {
    fontSize: 14,
    color: QuinckleColors.textPrimary,
    fontWeight: '600',
  },
  sessionRefMono: {
    fontFamily: 'monospace',
    letterSpacing: 0.5,
    fontWeight: '600',
  },
  sectionHeader: { marginBottom: Spacing.md },
  sectionTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.sm },
  sectionTitle: { color: QuinckleColors.textTertiary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  progressText: { color: QuinckleColors.textTertiary, fontSize: 11, fontWeight: '600' },
  serviceProgressTrack: { height: 3, backgroundColor: QuinckleColors.surfaceMutedHover, borderRadius: 2, overflow: 'hidden' },
  serviceProgressFill: { height: '100%', backgroundColor: QuinckleColors.success },
  listContent: { paddingBottom: 290 },
  orderItemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: QuinckleColors.borderSubtle },
  orderItemLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, flex: 1 },
  checkCircle: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: QuinckleColors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  checkCircleReady: { borderColor: QuinckleColors.primary },
  checkCircleServed: { backgroundColor: QuinckleColors.primary, borderColor: QuinckleColors.primary },
  itemName: { color: QuinckleColors.textPrimary, fontSize: 15, fontWeight: '600' },
  itemNameServed: { textDecorationLine: 'line-through', color: QuinckleColors.textTertiary },
  itemModifiers: { color: QuinckleColors.textTertiary, fontSize: 12, marginTop: 1, fontStyle: 'italic' },
  itemMetaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 3, gap: 6 },
  itemPrice: { color: QuinckleColors.textTertiary, fontSize: 12, fontWeight: '500' },
  itemDot: { color: QuinckleColors.textMuted, fontSize: 11 },
  itemTime: { color: QuinckleColors.textTertiary, fontSize: 11, fontWeight: '500' },
  statusTag: { paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.sm },
  statusTagText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  markServedBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, borderWidth: 1, borderColor: QuinckleColors.primary, backgroundColor: 'rgba(243,93,59,0.08)' },
  markServedText: { color: QuinckleColors.primary, fontSize: 11, fontWeight: '700' },
  servedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, backgroundColor: 'rgba(74,222,128,0.1)' },
  servedBadgeText: { color: '#4ade80', fontSize: 11, fontWeight: '700' },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.huge, gap: Spacing.md },
  emptyText: { color: QuinckleColors.textTertiary, fontSize: 14 },
  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: Spacing.xl, paddingBottom: Spacing.xxl, paddingTop: Spacing.lg, backgroundColor: QuinckleColors.surface, borderTopWidth: 1, borderTopColor: QuinckleColors.border },
  bottomBarExpanded: { borderTopLeftRadius: Radius.xxl, borderTopRightRadius: Radius.xxl, backgroundColor: QuinckleColors.surface },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel: { color: QuinckleColors.textTertiary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  totalValueContainer: { flexDirection: 'row', alignItems: 'center' },
  totalValue: { color: QuinckleColors.textPrimary, fontSize: 26, fontWeight: '700', letterSpacing: -0.5 },
  paidBadge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: Radius.sm, marginTop: 6, borderWidth: 1 },
  paidBadgeActive: { backgroundColor: QuinckleColors.successSoft, borderColor: QuinckleColors.successBorder },
  paidBadgeInactive: { backgroundColor: QuinckleColors.warningSoft, borderColor: QuinckleColors.warningBorder },
  paidBadgeText: { fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  paidBadgeTextActive: { color: QuinckleColors.success },
  paidBadgeTextInactive: { color: QuinckleColors.warning },
  accordionContent: { marginBottom: Spacing.xl },
  billHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.lg },
  billTitle: { color: QuinckleColors.textTertiary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  billItemsContainer: { maxHeight: 180 },
  billItemRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: Spacing.md },
  billItemName: { color: QuinckleColors.textPrimary, fontSize: 14, fontWeight: '500' },
  billItemPrice: { color: QuinckleColors.textSecondary, fontSize: 14, fontWeight: '500' },
  billDivider: { height: 1, backgroundColor: QuinckleColors.borderSubtle, marginVertical: Spacing.md },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: Spacing.sm },
  summaryLabel: { color: QuinckleColors.textSecondary, fontSize: 13, fontWeight: '500' },
  summaryValue: { color: QuinckleColors.textPrimary, fontSize: 13, fontWeight: '600' },
  grandTotalRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: Spacing.md, marginBottom: Spacing.lg, paddingTop: Spacing.md, borderTopWidth: 1, borderTopColor: QuinckleColors.border },
  grandTotalLabel: { color: QuinckleColors.textPrimary, fontSize: 16, fontWeight: '700' },
  grandTotalValue: { color: QuinckleColors.primary, fontSize: 18, fontWeight: '700' },
  payBtn: { backgroundColor: QuinckleColors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingVertical: 14, borderRadius: Radius.md },
  payBtnPaid: { backgroundColor: QuinckleColors.success },
  payBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  manualOrderBtn: { backgroundColor: QuinckleColors.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 13, borderRadius: Radius.md, gap: Spacing.sm, marginBottom: Spacing.xl },
  manualOrderText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  collectBtn: {
    backgroundColor: QuinckleColors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: 13,
    borderRadius: Radius.md,
    marginTop: Spacing.md,
  },
  collectBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  // Modal styles
  modalContainer: { flex: 1, backgroundColor: QuinckleColors.background },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: Spacing.xl, paddingVertical: Spacing.lg, borderBottomWidth: 1, borderBottomColor: QuinckleColors.border },
  modalTitle: { fontSize: 18, fontWeight: '700', color: QuinckleColors.textPrimary, letterSpacing: -0.3 },
  menuRow: { paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: QuinckleColors.borderSubtle },
  menuRowTop: { flexDirection: 'row', alignItems: 'center' },
  menuItemName: { color: QuinckleColors.textPrimary, fontSize: 15, fontWeight: '500' },
  menuItemPrice: { color: QuinckleColors.textSecondary, fontSize: 13, marginTop: 2 },
  itemNoteInput: { marginTop: Spacing.sm, backgroundColor: QuinckleColors.surfaceMuted, borderWidth: 1, borderColor: QuinckleColors.border, borderRadius: Radius.sm, paddingHorizontal: Spacing.md, paddingVertical: 7, color: QuinckleColors.textPrimary, fontSize: 13 },
  qtyControl: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  qtyBtn: { width: 32, height: 32, borderRadius: 16, borderWidth: 1.5, borderColor: QuinckleColors.border, alignItems: 'center', justifyContent: 'center' },
  qtyText: { color: QuinckleColors.textPrimary, fontSize: 15, fontWeight: '700', minWidth: 20, textAlign: 'center' },
  modalFooter: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: QuinckleColors.surface, borderTopWidth: 1, borderTopColor: QuinckleColors.border, paddingHorizontal: Spacing.xl, paddingTop: Spacing.lg, paddingBottom: Spacing.xxl, gap: Spacing.md },
  cartSummary: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cartLabel: { color: QuinckleColors.textSecondary, fontSize: 13 },
  cartTotal: { color: QuinckleColors.textPrimary, fontSize: 18, fontWeight: '700' },
  placeOrderBtn: { backgroundColor: QuinckleColors.primary, paddingVertical: 14, borderRadius: Radius.md, alignItems: 'center' },
  placeOrderBtnDisabled: { backgroundColor: QuinckleColors.surfaceMutedHover },
  placeOrderText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  modalSearchRow: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xs,
  },
  modalSearchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: QuinckleColors.surfaceMuted,
    paddingHorizontal: Spacing.md,
    height: 44,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    gap: Spacing.sm,
  },
  modalSearchInput: {
    flex: 1,
    color: QuinckleColors.textPrimary,
    fontSize: 14,
  },
  modalChipRowContainer: {
    marginBottom: Spacing.md,
    marginTop: Spacing.xs,
    flexGrow: 0,
  },
  modalChipRow: {
    flexGrow: 0,
  },
  modalChipScroll: {
    gap: Spacing.sm,
    paddingHorizontal: Spacing.xl,
  },
  modalChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
    borderRadius: Radius.pill,
    backgroundColor: QuinckleColors.surfaceMuted,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
  },
  modalChipActive: {
    backgroundColor: QuinckleColors.primarySoft,
    borderColor: QuinckleColors.primarySoftBorder,
  },
  modalChipText: {
    color: QuinckleColors.textSecondary,
    fontSize: 13,
    fontWeight: '500',
  },
  modalChipTextActive: {
    color: QuinckleColors.primary,
    fontWeight: '600',
  },
  paidStrip: {
    minHeight: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(74,222,128,0.08)',
    borderWidth: 1,
    borderColor: '#4ade80',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    marginVertical: Spacing.md,
  },
  paidMethodChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(134,239,172,0.1)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: 'rgba(134,239,172,0.2)',
  },
  paidMethodChipUpi: {
    backgroundColor: 'rgba(147,197,253,0.1)',
    borderColor: 'rgba(147,197,253,0.2)',
  },
  paidMethodAmt: {
    color: '#86efac',
    fontSize: 14,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  paidMethodTag: {
    color: '#86efac',
    fontSize: 10,
    fontWeight: '600',
    opacity: 0.75,
  },
  paidStripText: {
    color: '#4ade80',
    fontSize: 14,
    fontWeight: '600',
  },
  onlinePayBtn: {
    marginVertical: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    height: 50,
    borderRadius: Radius.md,
    backgroundColor: QuinckleColors.primary,
  },
  onlinePayBtnLoading: {
    opacity: 0.7,
  },
  onlinePayBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  // QR Modal
  qrModalContainer: {
    flex: 1,
    backgroundColor: QuinckleColors.background,
  },
  qrModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: QuinckleColors.border,
  },
  qrModalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: QuinckleColors.textPrimary,
    letterSpacing: -0.3,
  },
  qrModalBody: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    gap: Spacing.lg,
  },
  qrAmountLabel: {
    color: QuinckleColors.textTertiary,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  qrAmount: {
    color: QuinckleColors.textPrimary,
    fontSize: 42,
    fontWeight: '700',
    letterSpacing: -1,
  },
  qrCodeWrapper: {
    padding: Spacing.xl,
    backgroundColor: '#fff',
    borderRadius: Radius.lg,
    marginVertical: Spacing.md,
  },
  shareLinkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  shareLinkBtnText: {
    color: '#09090b',
    fontSize: 15,
    fontWeight: '600',
  },
  qrHint: {
    color: QuinckleColors.textTertiary,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
  },
  qrWaitingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  qrWaitingText: {
    color: QuinckleColors.textTertiary,
    fontSize: 13,
    fontWeight: '500',
  },
  qrCancelBtn: {
    marginHorizontal: Spacing.xl,
    marginBottom: Spacing.xxl,
    height: 50,
    borderRadius: Radius.md,
    backgroundColor: QuinckleColors.surfaceMuted,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrCancelText: {
    color: QuinckleColors.textSecondary,
    fontSize: 15,
    fontWeight: '600',
  },

  // Extend time sheet
  extendSub: {
    ...Typography.caption,
    color: QuinckleColors.textMuted,
    paddingHorizontal: Spacing.xl,
    marginBottom: Spacing.lg,
  },
  extendGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: Spacing.xl,
    gap: Spacing.md,
  },
  extendTile: {
    width: '46%',
    backgroundColor: QuinckleColors.surfaceElevated,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    paddingVertical: Spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    minHeight: 88,
  },
  extendTileMins: {
    fontSize: 30,
    fontWeight: '800',
    color: QuinckleColors.primary,
    letterSpacing: -1,
  },
  extendTileUnit: {
    ...Typography.micro,
    color: QuinckleColors.textMuted,
    fontWeight: '600',
    textTransform: 'uppercase' as const,
    letterSpacing: 0.8,
  },
  extendTileExpiry: {
    ...Typography.micro,
    color: QuinckleColors.textTertiary,
    marginTop: 4,
  },
});
