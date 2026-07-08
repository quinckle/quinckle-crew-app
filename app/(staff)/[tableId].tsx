import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, FlatList, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, ActivityIndicator, Share } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';
import { ThemedDialog } from '../../components/ui/themed-dialog';
import { crewSessions, crewTables, crewOrders, crewPayments, crewDiners, restaurantApi, printerApi } from '../../services/api';
import type { CrewTable, SessionBill } from '../../services/api';
import { printBill, printKot, getStatus as getPrinterStatus, isUpiQrEnabled, setUpiQrMode } from '../../services/printer';
import type { InvoiceBill } from '../../services/invoiceTemplate';
import { useAuth } from '../../context/AuthContext';
import { useCountdown } from '../../hooks/useCountdown';
import { subscribeChannel } from '../../services/realtime';
import type { BillOrderItem, BillOrder, MenuItem } from '../../services/api';
import { SwapTableSheet } from '../../components/ui/SwapTableSheet';
import { QrChoiceSheet } from '../../components/ui/QrChoiceSheet';
import { PrintOptionsSheet, type InvoiceBuyer } from '../../components/ui/PrintOptionsSheet';
import { BillDetailsSheet } from '../../components/ui/BillDetailsSheet';
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
  cancelled: boolean;
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
  const [mergedFrom, setMergedFrom] = useState<Array<{ session_ref: string; table_number: number | null }>>([]);
  // Payment-QR picker: `qrSheet` holds the bill total for the sheet label;
  // `qrRunRef` holds the print runner the chosen option invokes.
  const [qrSheet, setQrSheet] = useState<{ grandTotal: number } | null>(null);
  const qrRunRef = useRef<((omitAmount: boolean) => void) | null>(null);
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
    gstRegistered?: boolean;
    gstin?: string | null;
    displayMode?: 'combined' | 'split';
    pricesIncludeTax?: boolean;
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
  const [sessionBuyerGstin, setSessionBuyerGstin] = useState<string | null>(null);
  const [sessionBuyerName, setSessionBuyerName] = useState<string | null>(null);
  const [sessionInvoiceNumber, setSessionInvoiceNumber] = useState<string | null>(null);
  const [sessionTaxLines, setSessionTaxLines] = useState<SessionBill['tax_lines']>(undefined);
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
  const [toast, setToast] = useState<string | null>(null);

  // UPI QR generator
  const [upiId, setUpiId]           = useState<string | null>(null);
  const [upiName, setUpiName]       = useState<string>('');
  const [showUpiModal, setShowUpiModal] = useState(false);
  const [upiAmount, setUpiAmount]   = useState('');
  const [upiUri, setUpiUri]         = useState<string | null>(null);
  // Crew custom discount
  const [discountModalOpen, setDiscountModalOpen] = useState(false);
  const [discountType, setDiscountType] = useState<'PERCENT' | 'FLAT'>('PERCENT');
  const [discountValue, setDiscountValue] = useState('');
  const [discountNote, setDiscountNote] = useState('');
  const [applyingDiscount, setApplyingDiscount] = useState(false);
  // Free-table (structured close) modal
  const [freeModalOpen, setFreeModalOpen] = useState(false);
  const [freeStep, setFreeStep] = useState<'choose' | 'waive'>('choose');
  const [waiveReason, setWaiveReason] = useState('');
  const [freeing, setFreeing] = useState(false);
  const isAdmin = staffInfo?.role === 'ADMIN';

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
      setMergedFrom(bill.merged_from ?? []);
      setIsPaid(bill.status === 'paid');
      setBillPaymentMethod(bill.payment_method);
      setBillSplits(bill.splits);
      if (bill.expires_at !== undefined) setExpiresAt(bill.expires_at ?? null);
      if (bill.customer_name !== undefined) setSessionCustomerName(bill.customer_name ?? null);
      if (bill.customer_phone !== undefined) setSessionCustomerPhone(bill.customer_phone ?? null);
      if (bill.buyer_gstin !== undefined) setSessionBuyerGstin(bill.buyer_gstin ?? null);
      if (bill.buyer_name !== undefined) setSessionBuyerName(bill.buyer_name ?? null);
      if (bill.invoice_number !== undefined) setSessionInvoiceNumber(bill.invoice_number ?? null);
      if (bill.tax_lines !== undefined) setSessionTaxLines(bill.tax_lines);
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
          gstRegistered: res.data.taxConfig?.gstRegistered ?? false,
          gstin: res.data.taxConfig?.gstin ?? null,
          displayMode: (res.data.taxConfig?.displayMode as 'combined' | 'split') ?? 'combined',
          pricesIncludeTax: res.data.taxConfig?.pricesIncludeTax ?? false,
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
        cancelled: item.item_status === 'cancelled',
        price: item.price * item.qty,
        orderedAt: formatTime(order.placed_at),
        qty: item.qty,
      }))
    ), [orders]);

  // Cancelled items don't count toward serve progress.
  const servedCount = flatItems.filter(i => !i.cancelled && i.status === 'served').length;
  const totalCount = flatItems.filter(i => !i.cancelled).length;
  const serviceProgress = totalCount > 0 ? servedCount / totalCount : 0;
  const progressAnim = React.useRef(new Animated.Value(serviceProgress)).current;
  const billableFlatItems = useMemo(() => flatItems.filter(item => !item.cancelled), [flatItems]);

  useEffect(() => {
    Animated.spring(progressAnim, { toValue: serviceProgress, useNativeDriver: false, bounciness: 4, speed: 12 }).start();
  }, [serviceProgress]);

  const tax = taxTotal;
  const grandTotal = payableTotal;

  const handleApplyDiscount = async () => {
    const v = Number(discountValue);
    if (!Number.isFinite(v) || v <= 0) {
      showDialog('Invalid amount', 'Enter a discount greater than zero.', [{ label: 'OK', onPress: () => {} }]);
      return;
    }
    if (discountType === 'PERCENT' && v > 100) {
      showDialog('Invalid percentage', 'Percentage cannot exceed 100%.', [{ label: 'OK', onPress: () => {} }]);
      return;
    }
    setApplyingDiscount(true);
    try {
      await crewSessions.applyDiscount(sessionId, discountType, v, discountNote.trim() || null);
      setDiscountModalOpen(false);
      setDiscountValue('');
      setDiscountNote('');
      await loadBill();
    } catch (e: any) {
      const code = e?.code as string | undefined;
      const msg = code === 'NO_DISCOUNTABLE_ORDERS'
        ? 'Everything on this table is already paid — nothing to discount.'
        : (typeof e?.message === 'string' && e.message) || 'Please try again.';
      showDialog('Could not apply discount', msg, [{ label: 'OK', onPress: () => {} }]);
    } finally {
      setApplyingDiscount(false);
    }
  };

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

  // ── Item cancel (whole line, before payment is settled) ───────────────────
  const [cancelTarget, setCancelTarget] = useState<FlatItem | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const handleCancelItem = async () => {
    if (!cancelTarget || cancelling) return;
    setCancelling(true);
    try {
      const res = await crewOrders.cancelItem(cancelTarget.order_id, cancelTarget.item_id);
      if (!res?.success) {
        setCancelTarget(null);
        showDialog('Could not cancel', 'This item could not be cancelled. The order may already be paid.', [{ label: 'OK', onPress: () => {} }]);
        return;
      }
      await loadBill(); // refresh totals + the new collection amount
      setCancelTarget(null);
    } catch (e: any) {
      setCancelTarget(null);
      // The backend returns a 409 with a specific code/message for states
      // where a cancel is not allowed (paid, collection in progress, etc.).
      const code = e?.code as string | undefined;
      const message =
        code === 'COLLECTION_IN_PROGRESS'
          ? 'The diner is paying for this online right now. Wait for it to finish (or have them cancel), then remove the item.'
          : code === 'ORDER_ALREADY_PAID'
          ? 'This order is already paid and can no longer be changed.'
          : code === 'ITEM_ALREADY_CANCELLED' || code === 'ORDER_CANCELLED'
          ? 'This item has already been cancelled.'
          : (typeof e?.message === 'string' && e.message) || 'Something went wrong. Please try again.';
      showDialog('Could not cancel', message, [{ label: 'OK', onPress: () => {} }]);
    } finally {
      setCancelling(false);
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
      const res = await crewSessions.requestCollection(sessionId, sessionCustomerPhone ?? '', sessionCustomerName ?? null);
      await loadBill();
      if (res?.data?.alreadyInCollection) {
        setToast('Already in Payment Collection');
        setTimeout(() => setToast(null), 2200);
      }
      router.push('/(staff)/cash-collection');
    } catch (err: any) {
      showDialog(
        'Could not create collection request',
        err?.message ?? 'Please try again from the Payment Collection screen.',
        [{ label: 'OK', onPress: () => {} }],
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

  const handlePrintKot = async () => {
    setPrintMenuOpen(false);
    const latestOrder = [...orders].sort(
      (a, b) => new Date(b.placed_at).getTime() - new Date(a.placed_at).getTime(),
    )[0];
    if (!latestOrder) {
      showDialog('No Orders', 'There are no orders to reprint.', [{ label: 'OK', onPress: () => {} }]);
      return;
    }

    // If printer is paired on THIS device, print directly — same as invoice.
    // This avoids the Ably round-trip which can fail silently if the
    // subscription isn't active or the event doesn't reach this device.
    if (getPrinterStatus() === 'connected') {
      const result = await printKot({
        id: latestOrder.order_id,
        sessionId: sessionId || undefined,
        sessionRef: sessionRef || undefined,
        tableNumber: tableId,
        restaurantName: staffInfo?.restaurantName ?? '',
        createdAt: latestOrder.placed_at ?? new Date().toISOString(),
        items: latestOrder.items.map((item) => ({
          name: item.name,
          quantity: item.qty,
          modifiersSummary: item.modifiers_summary ?? undefined,
        })),
        isAddOn: false,
      }, false, { force: true });
      if (result === 'printed') {
        showDialog('Printed', 'KOT sent to printer.', [{ label: 'OK', onPress: () => {} }]);
      } else {
        showDialog('Print Failed', 'Printer connected but print failed. Check paper / Bluetooth and try again.', [{ label: 'OK', onPress: () => {} }]);
      }
      return;
    }

    // Printer is on a different device — use the Ably round-trip.
    void printerApi
      .reprint(latestOrder.order_id, 'Manual reprint from staff screen')
      .then(() =>
        showDialog('Sent', 'Reprint request sent to kitchen printer.', [{ label: 'OK', onPress: () => {} }]),
      )
      .catch(() =>
        showDialog('Error', 'Could not send reprint request. Please try again.', [{ label: 'OK', onPress: () => {} }]),
      );
  };

  const handlePrintInvoice = async (buyer?: InvoiceBuyer) => {
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
      order.items.filter(item => item.item_status !== 'cancelled').map(item => ({
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
            gstRegistered: res.data.taxConfig?.gstRegistered ?? false,
            gstin: res.data.taxConfig?.gstin ?? null,
            displayMode: (res.data.taxConfig?.displayMode as 'combined' | 'split') ?? 'combined',
            pricesIncludeTax: res.data.taxConfig?.pricesIncludeTax ?? false,
          };
          setRestaurantInvoiceMeta(invoiceMeta);
        }
      } catch {}
    }

    // Persist the recipient GSTIN on the session (best-effort) so the ops PDF
    // receipt matches this thermal print. A failure never blocks printing —
    // the thermal bill still carries the values the crew just entered.
    const buyerGstin = buyer?.gstin ?? null;
    const buyerName = buyer?.name ?? null;
    if (buyerGstin !== sessionBuyerGstin || buyerName !== sessionBuyerName) {
      try {
        await crewSessions.saveBuyer(sessionId, buyerGstin, buyerName);
        setSessionBuyerGstin(buyerGstin);
        setSessionBuyerName(buyerName);
      } catch {}
    }

    // Assign (or reuse) the sequential tax-invoice number before printing so the
    // printed copy carries it. Idempotent server-side; a failure (e.g. offline)
    // falls back to the last-known number, or the internal session ref if never
    // numbered yet.
    let invoiceNumber = sessionInvoiceNumber;
    try {
      const res = await crewSessions.finalizeInvoice(sessionId);
      invoiceNumber = res.data.invoice_number;
      setSessionInvoiceNumber(invoiceNumber);
    } catch {}

    // upiOmitAmount = true → static restaurant QR (diner types amount);
    // false → exact-amount QR. Ignored when no QR prints (paid / no VPA / toggle off).
    const runPrint = async (upiOmitAmount: boolean) => {
      const result = await printBill({
        restaurantName: staffInfo?.restaurantName ?? '',
        restaurantAddress: invoiceMeta?.address ?? null,
        restaurantPhone: invoiceMeta?.phone ?? null,
        restaurantEmail: invoiceMeta?.email ?? null,
        fssaiLicenseNumber: invoiceMeta?.fssaiLicenseNumber ?? null,
        gstRegistered: invoiceMeta?.gstRegistered ?? false,
        gstin: invoiceMeta?.gstin ?? null,
        buyerGstin,
        buyerName,
        invoiceNumber,
        tableNumber: tableNum,
        sessionRef: sessionRef || toSessionRef(sessionId),
        items: invoiceItems,
        subtotal: sessionTotal,
        discount: discountTotal,
        charges: serviceChargeTotal,
        tax: taxTotal,
        taxRate: billTaxRate,
        taxDisplayMode: invoiceMeta?.displayMode,
        taxLines: sessionTaxLines,
        pricesIncludeTax: invoiceMeta?.pricesIncludeTax,
        grandTotal,
        isPaid,
        paymentMethod: billPaymentMethod,
        upiVpa: upiId,
        upiName: upiName || null,
        upiOmitAmount,
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

    // Only ask which QR to print when a QR would actually be printed
    // (unpaid + a VPA configured + the on-device QR toggle is on).
    const qrWillPrint = !isPaid && !!upiId && isUpiQrEnabled();
    if (!qrWillPrint) {
      await runPrint(false);
      return;
    }

    // Ask which QR to print via the bottom sheet; the chosen option runs the
    // print. Dismissing the sheet (backdrop / drag) simply cancels.
    qrRunRef.current = (omitAmount: boolean) => { void runPrint(omitAmount); };
    setQrSheet({ grandTotal });
  };

  const doEndSession = async () => {
    try {
      if (sessionId) await crewSessions.end(sessionId);
      router.replace('/(staff)');
    } catch (err: any) {
      const code = err?.error || err?.message || '';
      if (code === 'SESSION_ALREADY_CLOSED') {
        router.replace('/(staff)');
      } else {
        showDialog('Could Not Free Table', 'Something went wrong while ending the session. Please try again.', [{ label: 'OK', onPress: () => {} }]);
      }
    }
  };

  const handleEndSession = () => {
    const hasUncollected = !isPaid && grandTotal > 0;
    if (hasUncollected) {
      // Structured decision — never a silent "close anyway". The money is either
      // collected, recorded as paid, written off (admin), or explicitly left
      // outstanding (which the backend records + keeps visible).
      setFreeStep('choose');
      setWaiveReason('');
      setFreeModalOpen(true);
      return;
    }
    showDialog('End Session', `Close Table T${tableNum} and release it for new guests?`, [
      { label: 'Cancel', onPress: () => {} },
      { label: 'End Session', variant: 'danger', onPress: doEndSession },
    ]);
  };

  // "Collect / already paid" → open the collection sheet for the whole table.
  const handleCollectFromFree = () => {
    setFreeModalOpen(false);
    const orderIds = orders.map((o) => o.order_id);
    router.push({
      pathname: '/(staff)/payment-collect',
      params: {
        orderId: orderIds[0] ?? '',
        sessionId: sessionId ?? '',
        orderIds: JSON.stringify(orderIds),
        tableNumber: String(tableNum ?? ''),
        amount: String(grandTotal ?? 0),
        customerName: '',
        customerPhone: '',
      },
    });
  };

  // Admin write-off of every uncollected order, then free.
  const handleWaiveAndFree = async () => {
    const reason = waiveReason.trim();
    if (!reason) { showDialog('Reason needed', 'Add a short reason for writing this off.', [{ label: 'OK', onPress: () => {} }]); return; }
    setFreeing(true);
    try {
      for (const id of orders.map((o) => o.order_id)) {
        try { await crewOrders.waive(id, reason); }
        catch (e: any) {
          const code = String(e?.code ?? e?.error ?? e?.message ?? '');
          if (code.includes('ADMIN_REQUIRED')) throw e;        // hard stop
          // ORDER_ALREADY_TERMINAL etc. — that order's already resolved, skip.
        }
      }
      setFreeModalOpen(false);
      await doEndSession();
    } catch (e: any) {
      const code = String(e?.code ?? e?.error ?? e?.message ?? '');
      showDialog('Could not waive', code.includes('ADMIN_REQUIRED') ? 'Only an admin can write off a payment.' : 'Please try again.', [{ label: 'OK', onPress: () => {} }]);
    } finally {
      setFreeing(false);
    }
  };

  const handleFreeWithoutCollecting = async () => {
    setFreeing(true);
    try { setFreeModalOpen(false); await doEndSession(); }
    finally { setFreeing(false); }
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

          {/* ── Print icon → bottom sheet ── */}
          <TouchableOpacity
            onPress={() => { setActionMenuOpen(false); setPrintMenuOpen(true); }}
            style={styles.iconBtn}
            activeOpacity={0.7}
          >
            <Ionicons name="print-outline" size={18} color={QuinckleColors.textPrimary} />
          </TouchableOpacity>

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
        {mergedFrom.length > 0 ? (
          <>
            <View style={styles.sessionInfoSep} />
            <View style={styles.sessionInfoRow}>
              <Text style={styles.sessionInfoLabel}>Merged</Text>
              <Text style={[styles.sessionInfoValue, styles.sessionRefMono, { flexShrink: 1, textAlign: 'right' }]}>
                {mergedFrom
                  .map(m => `${m.session_ref}${m.table_number != null ? ` (T${String(m.table_number).padStart(2, '0')})` : ''}`)
                  .join(', ')}
              </Text>
            </View>
          </>
        ) : null}
        <View style={styles.sessionInfoSep} />
        <View style={styles.sessionInfoRow}>
          <Text style={styles.sessionInfoLabel}>Guest</Text>
          <Text style={styles.sessionInfoValue}>{sessionCustomerName?.trim() || 'N/A'}</Text>
        </View>
        <View style={styles.sessionInfoSep} />
        <View style={styles.sessionInfoRow}>
          <Text style={styles.sessionInfoLabel}>Phone</Text>
          <Text style={styles.sessionInfoValue}>{sessionCustomerPhone?.trim() || 'N/A'}</Text>
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
          if (item.cancelled) {
            return (
              <View style={[styles.orderItemRow, { opacity: 0.5 }]}>
                <View style={styles.orderItemLeft}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.itemName, styles.itemNameCancelled]}>{item.name}</Text>
                    <View style={styles.itemMetaRow}>
                      <Text style={[styles.itemPrice, styles.itemNameCancelled]}>₹{item.price.toFixed(0)}</Text>
                    </View>
                  </View>
                </View>
                <View style={styles.cancelledBadge}>
                  <Ionicons name="close" size={11} color={QuinckleColors.danger} />
                  <Text style={styles.cancelledBadgeText}>Cancelled</Text>
                </View>
              </View>
            );
          }
          return (
            <TouchableOpacity
              activeOpacity={0.9}
              onLongPress={() => setCancelTarget(item)}
              delayLongPress={350}
              style={[styles.orderItemRow, isServed && { opacity: 0.55 }]}
            >
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
            </TouchableOpacity>
          );
        }}
      />

      <View style={styles.bottomBar}>
        <TouchableOpacity style={styles.totalRow} activeOpacity={0.85} onPress={() => setIsExpanded(true)}>
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
            <Ionicons name="chevron-up" size={18} color={QuinckleColors.textTertiary} style={{ marginLeft: Spacing.sm }} />
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

      <BillDetailsSheet
        visible={isExpanded}
        items={billableFlatItems}
        subtotal={sessionTotal}
        discountTotal={discountTotal}
        serviceChargeTotal={serviceChargeTotal}
        tax={tax}
        taxRate={billTaxRate}
        tipTotal={tipTotal}
        grandTotal={grandTotal}
        canGiveDiscount={!isPaid && orders.length > 0}
        onGiveDiscount={() => { setIsExpanded(false); setDiscountModalOpen(true); }}
        onClose={() => setIsExpanded(false)}
      />

      <QrChoiceSheet
        visible={!!qrSheet}
        amount={qrSheet?.grandTotal ?? 0}
        onPick={(mode) => {
          void setUpiQrMode(mode);        // remember as the default next time
          const run = qrRunRef.current;
          setQrSheet(null);
          run?.(mode === 'static');
        }}
        onClose={() => setQrSheet(null)}
      />

      {/* ── Item cancel bottom sheet ── */}
      <BottomSheet
        visible={!!cancelTarget}
        onClose={() => { if (!cancelling) setCancelTarget(null); }}
      >
        <View style={styles.cancelSheetBody}>
          <View style={styles.cancelSheetIcon}>
            <Ionicons name="trash-outline" size={22} color={QuinckleColors.danger} />
          </View>
          <Text style={styles.cancelSheetTitle}>Cancel this item?</Text>
          <Text style={styles.cancelSheetItem}>{cancelTarget?.name}</Text>
          <Text style={styles.cancelSheetSub}>
            ₹{(cancelTarget?.price ?? 0).toFixed(0)} will be removed from the bill. This can&apos;t be undone.
          </Text>
          <View style={styles.cancelSheetActions}>
            <TouchableOpacity
              style={styles.cancelSheetKeep}
              onPress={() => { if (!cancelling) setCancelTarget(null); }}
              activeOpacity={0.8}
              disabled={cancelling}
            >
              <Text style={styles.cancelSheetKeepText}>Keep item</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.cancelSheetConfirm, cancelling && { opacity: 0.6 }]}
              onPress={() => void handleCancelItem()}
              activeOpacity={0.85}
              disabled={cancelling}
            >
              {cancelling ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.cancelSheetConfirmText}>Cancel item</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </BottomSheet>

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

      {/* Print options bottom sheet */}
      <PrintOptionsSheet
        visible={printMenuOpen}
        onPrintKot={handlePrintKot}
        onPrintInvoice={(buyer) => { void handlePrintInvoice(buyer); }}
        onClose={() => setPrintMenuOpen(false)}
        initialBuyerGstin={sessionBuyerGstin}
        initialBuyerName={sessionBuyerName}
      />

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

      {/* Crew custom discount */}
      <Modal visible={discountModalOpen} transparent animationType="fade" onRequestClose={() => setDiscountModalOpen(false)}>
        <View style={styles.swapBackdrop}>
          <View style={styles.swapCard}>
            <Text style={styles.swapEyebrow}>Discount</Text>
            <Text style={styles.swapTitle}>Give a discount</Text>
            <Text style={styles.swapSubtitle}>Applies across the table&apos;s unpaid orders.</Text>

            <View style={styles.segToggle}>
              <TouchableOpacity style={[styles.segBtn, discountType === 'PERCENT' && styles.segBtnActive]} onPress={() => setDiscountType('PERCENT')} activeOpacity={0.85}>
                <Text style={[styles.segBtnText, discountType === 'PERCENT' && styles.segBtnTextActive]}>Percentage</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.segBtn, discountType === 'FLAT' && styles.segBtnActive]} onPress={() => setDiscountType('FLAT')} activeOpacity={0.85}>
                <Text style={[styles.segBtnText, discountType === 'FLAT' && styles.segBtnTextActive]}>Flat ₹</Text>
              </TouchableOpacity>
            </View>

            <View style={[styles.dinerInputWrap, { marginTop: 14 }]}>
              <View style={styles.dinerCountryCode}>
                <Text style={styles.dinerCountryCodeText}>{discountType === 'PERCENT' ? '%' : '₹'}</Text>
              </View>
              <View style={styles.dinerDivider} />
              <TextInput
                style={styles.dinerInput}
                value={discountValue}
                onChangeText={v => setDiscountValue(v.replace(/[^0-9.]/g, ''))}
                placeholder={discountType === 'PERCENT' ? 'e.g. 10' : 'e.g. 50'}
                placeholderTextColor={QuinckleColors.textMuted}
                keyboardType="decimal-pad"
                returnKeyType="done"
                autoFocus
              />
            </View>

            <View style={[styles.dinerInputWrap, { marginTop: 10 }]}>
              <TextInput
                style={[styles.dinerInput, { paddingLeft: 14 }]}
                value={discountNote}
                onChangeText={setDiscountNote}
                placeholder="Reason (optional)"
                placeholderTextColor={QuinckleColors.textMuted}
                maxLength={200}
                returnKeyType="done"
              />
            </View>

            <View style={styles.swapFooter}>
              <TouchableOpacity style={styles.swapCancel} onPress={() => setDiscountModalOpen(false)} activeOpacity={0.8} disabled={applyingDiscount}>
                <Text style={styles.swapCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.swapConfirm, (!(parseFloat(discountValue) > 0) || applyingDiscount) && { opacity: 0.4 }]}
                onPress={handleApplyDiscount}
                disabled={!(parseFloat(discountValue) > 0) || applyingDiscount}
                activeOpacity={0.85}
              >
                {applyingDiscount ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.swapConfirmText}>Apply</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Structured free-table decision (uncollected payment) */}
      <Modal visible={freeModalOpen} transparent animationType="fade" onRequestClose={() => setFreeModalOpen(false)}>
        <View style={styles.swapBackdrop}>
          <View style={styles.swapCard}>
            {freeStep === 'choose' ? (
              <>
                <Text style={styles.swapEyebrow}>Table T{tableNum}</Text>
                <Text style={styles.swapTitle}>₹{grandTotal.toFixed(0)} uncollected</Text>
                <Text style={styles.swapSubtitle}>What happened to the payment?</Text>

                <TouchableOpacity style={styles.freeOptBtn} onPress={handleCollectFromFree} activeOpacity={0.85} disabled={freeing}>
                  <Ionicons name="cash-outline" size={18} color={QuinckleColors.primary} />
                  <Text style={styles.freeOptBtnText}>Collect / mark as paid</Text>
                </TouchableOpacity>

                {isAdmin && (
                  <TouchableOpacity style={styles.freeOptBtn} onPress={() => setFreeStep('waive')} activeOpacity={0.85} disabled={freeing}>
                    <Ionicons name="remove-circle-outline" size={18} color={QuinckleColors.textSecondary} />
                    <Text style={styles.freeOptBtnText}>Write off (waive)</Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity style={[styles.freeOptBtn, styles.freeOptDanger]} onPress={handleFreeWithoutCollecting} activeOpacity={0.85} disabled={freeing}>
                  {freeing ? <ActivityIndicator color="#fca5a5" size="small" /> : (
                    <>
                      <Ionicons name="exit-outline" size={18} color="#fca5a5" />
                      <Text style={styles.freeOptDangerText}>Free without collecting</Text>
                    </>
                  )}
                </TouchableOpacity>
                <Text style={styles.freeHint}>Outstanding payments stay visible until collected or waived.</Text>

                <TouchableOpacity style={[styles.swapCancel, { marginTop: 8 }]} onPress={() => setFreeModalOpen(false)} activeOpacity={0.8} disabled={freeing}>
                  <Text style={styles.swapCancelText}>Cancel</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.swapEyebrow}>Write off · Table T{tableNum}</Text>
                <Text style={styles.swapTitle}>Waive ₹{grandTotal.toFixed(0)}?</Text>
                <Text style={styles.swapSubtitle}>This records a write-off (no money collected). Reason required.</Text>
                <View style={[styles.dinerInputWrap, { marginTop: 14 }]}>
                  <TextInput
                    style={[styles.dinerInput, { paddingLeft: 14 }]}
                    value={waiveReason}
                    onChangeText={setWaiveReason}
                    placeholder="Reason (e.g. walkout, comp)"
                    placeholderTextColor={QuinckleColors.textMuted}
                    maxLength={200}
                    autoFocus
                    returnKeyType="done"
                  />
                </View>
                <View style={styles.swapFooter}>
                  <TouchableOpacity style={styles.swapCancel} onPress={() => setFreeStep('choose')} activeOpacity={0.8} disabled={freeing}>
                    <Text style={styles.swapCancelText}>Back</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.swapConfirm, (!waiveReason.trim() || freeing) && { opacity: 0.4 }]}
                    onPress={handleWaiveAndFree}
                    disabled={!waiveReason.trim() || freeing}
                    activeOpacity={0.85}
                  >
                    {freeing ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.swapConfirmText}>Waive &amp; free</Text>}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {toast && (
        <View style={[styles.toast, { bottom: insets.bottom + 24 }]}>
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}

    </View>
  );
}

const styles = StyleSheet.create({
  toast: { position: 'absolute', alignSelf: 'center', backgroundColor: QuinckleColors.surfaceElevated, borderWidth: 1, borderColor: QuinckleColors.borderStrong, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 12 },
  toastText: { color: QuinckleColors.textPrimary, fontSize: 13.5, fontWeight: '700' },
  segToggle: {
    flexDirection: 'row',
    marginTop: 16,
    borderRadius: Radius.md,
    backgroundColor: QuinckleColors.surface,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    overflow: 'hidden',
  },
  segBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 10 },
  segBtnActive: { backgroundColor: 'rgba(243,93,59,0.16)' },
  segBtnText: { color: QuinckleColors.textTertiary, fontSize: 13, fontWeight: '600' },
  segBtnTextActive: { color: QuinckleColors.primary },
  freeOptBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    backgroundColor: QuinckleColors.surface,
  },
  freeOptBtnText: { color: QuinckleColors.textPrimary, fontSize: 14, fontWeight: '600' },
  freeOptDanger: {
    justifyContent: 'center',
    borderColor: 'rgba(248,113,113,0.4)',
    backgroundColor: 'rgba(248,113,113,0.08)',
  },
  freeOptDangerText: { color: '#fca5a5', fontSize: 14, fontWeight: '700' },
  freeHint: { color: QuinckleColors.textTertiary, fontSize: 11, marginTop: 10, textAlign: 'center' },
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
  itemNameCancelled: { textDecorationLine: 'line-through', color: QuinckleColors.textTertiary },
  cancelledBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, backgroundColor: 'rgba(239,68,68,0.12)' },
  cancelledBadgeText: { color: QuinckleColors.danger, fontSize: 11, fontWeight: '700' },
  // ── Item cancel bottom sheet (content inside the shared BottomSheet) ──
  cancelSheetBody: { paddingHorizontal: 22, paddingTop: 4, paddingBottom: 8, alignItems: 'center' },
  cancelSheetIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(239,68,68,0.12)', marginBottom: 14 },
  cancelSheetTitle: { fontSize: 17, fontWeight: '800', color: QuinckleColors.textPrimary, marginBottom: 6 },
  cancelSheetItem: { fontSize: 15, fontWeight: '600', color: QuinckleColors.textPrimary, textAlign: 'center', marginBottom: 4 },
  cancelSheetSub: { fontSize: 13, color: QuinckleColors.textSecondary, textAlign: 'center', lineHeight: 19, marginBottom: 22, paddingHorizontal: 6 },
  cancelSheetActions: { flexDirection: 'row', gap: 12, alignSelf: 'stretch' },
  cancelSheetKeep: { flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1, borderColor: QuinckleColors.border, alignItems: 'center', justifyContent: 'center' },
  cancelSheetKeepText: { fontSize: 14, fontWeight: '700', color: QuinckleColors.textSecondary },
  cancelSheetConfirm: { flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: QuinckleColors.danger, alignItems: 'center', justifyContent: 'center' },
  cancelSheetConfirmText: { fontSize: 14, fontWeight: '800', color: '#fff' },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.huge, gap: Spacing.md },
  emptyText: { color: QuinckleColors.textTertiary, fontSize: 14 },
  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: Spacing.xl, paddingBottom: Spacing.xxl, paddingTop: Spacing.lg, backgroundColor: QuinckleColors.surface, borderTopWidth: 1, borderTopColor: QuinckleColors.border },
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
