import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, FlatList, Image, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, ActivityIndicator } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { QuinckleColors, Radius, Spacing , Typography } from '../../constants/Colors';
import { ThemedDialog } from '../../components/ui/themed-dialog';
import { crewSessions, crewTables, crewOrders, restaurantApi, printerApi } from '../../services/api';
import type { SessionBill, BillOrderItem, BillOrder } from '../../services/api';
import { printBill, printKot, getStatus as getPrinterStatus, isUpiQrEnabled, setUpiQrMode } from '../../services/printer';
import { loyaltyApi, type CrewLadder } from '../../services/api';
import type { InvoiceBill, LoyaltyNudge } from '../../services/invoiceTemplate';
import { useAuth } from '../../context/AuthContext';
import { useCountdown } from '../../hooks/useCountdown';
import { expiryLevel, expiryColor, expiryChipStyle } from '../../constants/sessionExpiry';
import { subscribeChannel } from '../../services/realtime';
import { SwapTableSheet } from '../../components/ui/SwapTableSheet';
import { QrChoiceSheet } from '../../components/ui/QrChoiceSheet';
import { PrintOptionsSheet, type InvoiceBuyer } from '../../components/ui/PrintOptionsSheet';
import { PrintProgressOverlay, type PrintJob } from '../../components/ui/PrintProgressOverlay';
import { BillExplainContent, BillExplainSheet, type ExplainedBill } from '../../components/ui/BillExplainSheet';
import { BottomSheet } from '../../components/ui/BottomSheet';
import { HintToast } from '../../components/ui/HintToast';
import { ReasonSheet, ReasonChips } from '../../components/ui/ReasonSheet';
import { useManagerApproval } from '../../components/ui/ManagerPinSheet';
import { WAIVE_REASONS, EXEMPTION_REASONS, isReasonComplete, toReasonPayload, wouldZeroBill, type CancelReason } from '../../constants/adjustmentReasons';
import { Skeleton } from '../../components/ui/Skeleton';
import { useResponsive } from '../../hooks/useResponsive';

type ItemStatus = 'prep' | 'ready' | 'served';

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
  /** Units of `qty` already handed over. status === 'served' iff servedQty >= qty. */
  servedQty: number;
};

// In DUAL_CHANNEL mode the kitchen's per-item "done" marking surfaces to the
// steward as a distinct "ready to serve" state, so they can see which plates
// are up on the pass without walking to the kitchen. In SIMPLE mode this
// collapses back to the original two-state prep/served behaviour — existing
// venues see no change at all.
function itemStatus(item: BillOrderItem, dualChannel: boolean): ItemStatus {
  if (item.served) return 'served';
  if (dualChannel && item.item_status === 'done') return 'ready';
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
  /**
   * Bottom padding for the docked total/collect bar.
   *
   * `edgeToEdgeEnabled` is on, so Android draws this app UNDER the system
   * navigation bar. The bar used to hardcode 24px, which happens to clear a
   * gesture-nav pill (~16-24px) but NOT the 3-button nav bar (~48px) — on those
   * devices the system buttons sat on top of "Send to Payment Collection".
   *
   * The Math.max floor keeps the old 24px on any device that reports no inset,
   * so nothing regresses where it already looked right.
   */
  const bottomBarPad = Math.max(insets.bottom, Spacing.md) + Spacing.md;
  /**
   * The docked bar is absolutely positioned OVER the order list, so the list
   * reserves clearance for it (`listContent.paddingBottom`, tuned by eye when
   * the bar was a fixed 24px tall at the base). Growing the bar without growing
   * that clearance would just move the problem — the nav bar stops covering the
   * button and starts covering the last order line instead.
   */
  const listBottomPad = 290 + Math.max(0, bottomBarPad - Spacing.xxl);
  // Tablet-landscape: session details + a permanently-visible bill breakdown
  // sit in a left pane, ordered items alone fill the right pane. Phone and
  // tablet-portrait keep the original single-column stack.
  const { isWide } = useResponsive();
  const { tableId, sessionId: paramSessionId, tableDbId, occupiedSince, expiresAt: paramExpiresAt, customerName: paramCustomerName, customerPhone: paramCustomerPhone, groupLabel: paramGroupLabel, openBill } = useLocalSearchParams<{ tableId: string; sessionId: string; tableDbId: string; occupiedSince: string; expiresAt: string; customerName: string; customerPhone: string; groupLabel?: string; openBill?: string }>();
  const router = useRouter();
  const { staffInfo } = useAuth();

  const tableNum = String(tableId ?? '').padStart(2, '0');
  // Shared seating: "G2" when this table hosts >1 party. Rides on the header
  // and every printout so staff can match paper to the right group. The nav
  // param gives an instant value from the picker; the bill response is the
  // authority so the label shows on EVERY entry path (orders feed, search)
  // and disappears once the other groups have left.
  const [groupLabel, setGroupLabel] = useState((paramGroupLabel ?? '').trim());
  const tablePrintLabel = groupLabel ? `${tableNum} · ${groupLabel}` : tableNum;

  const [sessionId] = useState(paramSessionId ?? '');
  const [sessionRef, setSessionRef] = useState('');
  // Venue's order-status flow. Loaded once with branding; gates the item-level
  // "ready to serve" indicators below. Defaults to SIMPLE so the screen renders
  // its legacy two-state (prep/served) UI until we know otherwise.
  const [dinerStatusMode, setDinerStatusMode] = useState<'SIMPLE' | 'DUAL_CHANNEL'>('SIMPLE');
  const [mergedFrom, setMergedFrom] = useState<{ session_ref: string; table_number: number | null }[]>([]);
  // Payment-QR picker: `qrSheet` holds the bill total for the sheet label;
  // `qrRunRef` holds the print runner the chosen option invokes.
  const [qrSheet, setQrSheet] = useState<{ grandTotal: number } | null>(null);
  const qrRunRef = useRef<((omitAmount: boolean) => void) | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(paramExpiresAt || null);
  const countdown = useCountdown(expiresAt);
  // Urgency scales with the venue's own turn time — see constants/sessionExpiry.
  // `overdue` is included deliberately: the old fixed-threshold check required
  // totalMs > 0, so a table that had actually run out went from red back to a
  // calm grey "Expired" — relaxing at the moment it should escalate.
  const expiry = expiresAt ? expiryLevel(countdown.totalMs, expiresAt, occupiedSince) : 'normal';
  const isNearExpiry = expiry === 'danger' || expiry === 'overdue';
  const expiryFg = expiryColor(expiry);
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
    billThankYouMsg?: string | null;
    billFooterNote?: string | null;
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [orders, setOrders] = useState<BillOrder[]>([]);
  const [sessionTotal, setSessionTotal] = useState(0);
  const [taxTotal, setTaxTotal] = useState(0);
  const [serviceChargeTotal, setServiceChargeTotal] = useState(0);
  const [chargeLines, setChargeLines] = useState<{ id: string; name: string; amount: number }[]>([]);
  const [discountTotal, setDiscountTotal] = useState(0);
  const [discountLines, setDiscountLines] = useState<{ kind: string; name: string; amount: number }[]>([]);
  const [tipTotal, setTipTotal] = useState(0);
  const [roundOffTotal, setRoundOffTotal] = useState(0);
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
  // Khata (pay later): portion of a settled bill owed on the customer's khata.
  const [billDueAmount, setBillDueAmount] = useState<number | undefined>(undefined);
  const [billSplits, setBillSplits] = useState<SessionBill['splits']>(undefined);
  const [isExpanded, setIsExpanded] = useState(false);

  // Landing here right after placing an order (see order-menu.tsx's
  // confirmAndPlace) forces the bill breakdown open, so the crew reviews
  // exactly what was ordered before doing anything else. Tablet-landscape
  // already shows the breakdown permanently in the left pane, so this only
  // matters on the single-column layout.
  useEffect(() => {
    if (openBill === '1') {
      if (!isWide) setIsExpanded(true);
      router.setParams({ openBill: undefined });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openBill]);

  const [isRequestingCollection, setIsRequestingCollection] = useState(false);

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
  const [exemptCode, setExemptCode] = useState<string | null>(null);
  const [exemptText, setExemptText] = useState('');
  const [discountNote, setDiscountNote] = useState('');
  const [applyingDiscount, setApplyingDiscount] = useState(false);
  // Free-table (structured close) modal
  const [freeModalOpen, setFreeModalOpen] = useState(false);
  const [freeStep, setFreeStep] = useState<'choose' | 'waive'>('choose');
  const [waiveReason, setWaiveReason] = useState('');
  const [waiveCode, setWaiveCode] = useState<string | null>(null);
  const { sheet: managerPinSheet, runWithApproval } = useManagerApproval();
  const [freeing, setFreeing] = useState(false);
  const isAdmin = staffInfo?.role === 'ADMIN';

  // Action menu + swap-table state for the 3-dot header
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [printMenuOpen, setPrintMenuOpen] = useState(false);
  // Session reference data (ref, guest, phone, opened) lives behind a tap — it's
  // consulted once a service, not continuously, so it doesn't earn a permanent
  // block above the order list.
  const [sessionInfoOpen, setSessionInfoOpen] = useState(false);
  // Why a disabled action card is disabled, shown when someone taps it.
  const [hint, setHint] = useState<string | null>(null);
  // Tap-to-paper progress overlay; null = hidden. Phases track the real await
  // boundaries in the print handlers below.
  const [printJob, setPrintJob] = useState<PrintJob | null>(null);
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

  const loadBill = useCallback(async () => {
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
      // Rupee round-off. 0 on older backends and on legacy bills, where the tax
      // was already whole rupees and nothing needed rounding.
      const roundV  = bd?.roundOff ?? bill.round_off ?? 0;
      const inferredDisc = explicitDisc > 0 || explicitGrand == null
        ? explicitDisc
        : Math.max(0, Math.round((subt + tax + charges + tipV + roundV - explicitGrand) * 100) / 100);
      const disc    = inferredDisc;
      const grand   = explicitGrand ?? (subt + tax + charges + tipV - disc + roundV);
      setOrders(bill.orders);
      setSessionTotal(subt);
      setBillTaxRate(rate);
      setTaxTotal(tax);
      setServiceChargeTotal(charges);
      setChargeLines(bill.charge_lines ?? []);
      setDiscountTotal(disc);
      setDiscountLines(bill.discount_lines ?? []);
      setTipTotal(tipV);
      setRoundOffTotal(roundV);
      setPayableTotal(grand);
      setSessionStatus(bill.status);
      setSessionRef(bill.session_ref ?? '');
      // Shared seating: bill is the authority for the group label — shows it
      // on every entry path, clears it when this is again the only party.
      if (bill.party_count !== undefined) {
        setGroupLabel(Number(bill.party_count) > 1 ? `G${Number(bill.party_slot ?? 1)}` : '');
      }
      setMergedFrom(bill.merged_from ?? []);
      setIsPaid(bill.status === 'paid');
      setBillPaymentMethod(bill.payment_method);
      setBillDueAmount(bill.due_amount);
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
  }, [sessionId]);

  // Load once on mount; Ably drives all subsequent updates
  useEffect(() => { void loadBill(); }, [loadBill]);

  // Refresh bill whenever screen regains focus — ensures the "Collect Payment"
  // button and paid badge settle immediately after returning from payment-collect.
  useFocusEffect(
    useCallback(() => {
      void loadBill();
    }, [loadBill]),
  );


  useEffect(() => {
    const restaurantId = staffInfo?.restaurantId;
    if (!restaurantId) return;
    let cancelled = false;
    restaurantApi.getBranding(restaurantId)
      .then((res) => {
        if (cancelled || !res?.success) return;
        setDinerStatusMode((res.data.dinerStatusMode ?? 'SIMPLE') as 'SIMPLE' | 'DUAL_CHANNEL');
        setRestaurantInvoiceMeta({
          address: res.data.address ?? null,
          phone: res.data.phone ?? null,
          email: res.data.email ?? null,
          fssaiLicenseNumber: res.data.fssaiLicenseNumber ?? null,
          gstRegistered: res.data.taxConfig?.gstRegistered ?? false,
          gstin: res.data.taxConfig?.gstin ?? null,
          displayMode: (res.data.taxConfig?.displayMode as 'combined' | 'split') ?? 'combined',
          pricesIncludeTax: res.data.taxConfig?.pricesIncludeTax ?? false,
          billThankYouMsg: res.data.billThankYouMsg ?? null,
          billFooterNote: res.data.billFooterNote ?? null,
        });
        if (res.data.upiId) {
          setUpiId(res.data.upiId);
          setUpiName(res.data.upiDisplayName ?? res.data.name ?? '');
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [staffInfo?.restaurantId]);

  // Ably: waiter:{restaurantId} — refresh bill on any order/payment event.
  // One kitchen action fans out into several events (order_ready + item_ready
  // + item_bumped…); a trailing debounce collapses each burst into a single
  // /bill fetch instead of 3-4 back-to-back ones.
  useEffect(() => {
    const restaurantId = staffInfo?.restaurantId;
    if (!restaurantId || !sessionId) return;
    let refetchTimer: ReturnType<typeof setTimeout> | null = null;
    const refetch = () => {
      if (refetchTimer) clearTimeout(refetchTimer);
      refetchTimer = setTimeout(() => { refetchTimer = null; void loadBill(); }, 300);
    };
    const unsubs = [
      subscribeChannel(`waiter:${restaurantId}`, 'order_ready',       refetch),
      subscribeChannel(`waiter:${restaurantId}`, 'order_served',      refetch),
      subscribeChannel(`waiter:${restaurantId}`, 'item_bumped',       refetch),
      subscribeChannel(`waiter:${restaurantId}`, 'item_ready',        refetch),
      // Partial serve ticks — order_served only fires once a whole order is
      // out, so without this a second steward's device sits on a stale count.
      subscribeChannel(`waiter:${restaurantId}`, 'item_served',       refetch),
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
    return () => {
      if (refetchTimer) clearTimeout(refetchTimer);
      unsubs.forEach(u => u());
    };
  }, [staffInfo?.restaurantId, sessionId, router, loadBill]);


  // Flat list of all items across all orders
  const flatItems = useMemo<FlatItem[]>(() =>
    orders.flatMap(order =>
      order.items.map(item => ({
        key: item.item_id,
        item_id: item.item_id,
        order_id: order.order_id,
        name: `${item.qty}× ${item.name}`,
        modifiersSummary: item.modifiers_summary,
        status: itemStatus(item, dinerStatusMode === 'DUAL_CHANNEL'),
        cancelled: item.item_status === 'cancelled',
        price: item.price * item.qty,
        orderedAt: formatTime(order.placed_at),
        qty: item.qty,
        // Fall back for a backend that predates partial ticking.
        servedQty: item.served_qty ?? (item.served ? item.qty : 0),
      }))
    ), [orders, dinerStatusMode]);

  // Cancelled items don't count toward serve progress. Counted in UNITS, not
  // lines — a half-served 4× line should move the bar halfway, not not at all.
  const servedCount = flatItems.reduce((n, i) => n + (i.cancelled ? 0 : Math.min(i.qty, i.servedQty)), 0);
  const totalCount = flatItems.reduce((n, i) => n + (i.cancelled ? 0 : i.qty), 0);
  const serviceProgress = totalCount > 0 ? servedCount / totalCount : 0;
  const progressAnim = React.useRef(new Animated.Value(serviceProgress)).current;
  const billableFlatItems = useMemo(() => flatItems.filter(item => !item.cancelled), [flatItems]);

  useEffect(() => {
    Animated.spring(progressAnim, { toValue: serviceProgress, useNativeDriver: false, bounciness: 4, speed: 12 }).start();
  }, [serviceProgress, progressAnim]);

  const tax = taxTotal;
  const grandTotal = payableTotal;

  const explainedBill = useMemo<ExplainedBill>(() => ({
    items: billableFlatItems.map((i) => ({ key: `${i.order_id}:${i.key}`, name: i.name, modifiersSummary: i.modifiersSummary, price: i.price })),
    subtotal: sessionTotal,
    discountTotal,
    discountLines,
    chargesTotal: serviceChargeTotal,
    chargeLines,
    taxTotal: tax,
    taxRate: billTaxRate,
    taxLines: sessionTaxLines ?? [],
    tip: tipTotal,
    roundOff: roundOffTotal,
    total: grandTotal,
  }), [billableFlatItems, sessionTotal, discountTotal, discountLines, serviceChargeTotal, chargeLines, tax, billTaxRate, sessionTaxLines, tipTotal, roundOffTotal, grandTotal]);

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
    // A discount that zeroes the bill is an exemption, not a discount: the
    // backend gates it on ADMIN and records it on the adjustments ledger.
    const zeroing = wouldZeroBill(discountType, v, sessionTotal);
    if (zeroing && !isReasonComplete(exemptCode, exemptText)) return;
    const coded = zeroing ? toReasonPayload(exemptCode!, exemptText) : undefined;

    setApplyingDiscount(true);
    try {
      await runWithApproval({ action: 'EXEMPT_SESSION', amount: sessionTotal }, async (mint) => {
        const grantId = mint ? await mint(sessionId, null) : undefined;
        await crewSessions.applyDiscount(sessionId, discountType, v, discountNote.trim() || null, coded, grantId);
      });
      setDiscountModalOpen(false);
      setDiscountValue('');
      setDiscountNote('');
      setExemptCode(null);
      setExemptText('');
      await loadBill();
    } catch (e: any) {
      const code = e?.code as string | undefined;
      const msg = code === 'NO_DISCOUNTABLE_ORDERS'
        ? 'Everything on this table is already paid — nothing to discount.'
        : code === 'ADMIN_REQUIRED' || code === 'AUTHORIZATION_REQUIRED'
        ? 'A manager must approve clearing the whole bill.'
        : (typeof e?.message === 'string' && e.message) || 'Please try again.';
      showDialog('Could not apply discount', msg, [{ label: 'OK', onPress: () => {} }]);
    } finally {
      setApplyingDiscount(false);
    }
  };

  // A zeroing discount is an exemption: admin-only, and it must carry a reason.
  const discountZeroesBill = wouldZeroBill(discountType, Number(discountValue), sessionTotal);
  const canApplyDiscount =
    parseFloat(discountValue) > 0 &&
    !applyingDiscount &&
    (!discountZeroesBill || isReasonComplete(exemptCode, exemptText));

  // `nextQty` is the ABSOLUTE served count the line should stand at. A tap
  // hands over one more unit; a hold on the button hands over the rest.
  const handleServe = async (item: FlatItem, nextQty: number) => {
    if (item.status === 'served') return; // already served, no-op
    const target = Math.max(0, Math.min(item.qty, nextQty));
    const previousQty = item.servedQty;
    // Optimistic update
    setOrders(prev => prev.map(o => {
      if (o.order_id !== item.order_id) return o;
      return { ...o, items: o.items.map(i => i.item_id === item.item_id
        ? { ...i, served_qty: target, served: target >= i.qty }
        : i) };
    }));
    try {
      await crewOrders.serveItem(item.order_id, item.item_id, target);
      await loadBill(); // refresh from server — same pattern as kitchen
    } catch {
      // Revert on failure
      setOrders(prev => prev.map(o => {
        if (o.order_id !== item.order_id) return o;
        return { ...o, items: o.items.map(i => i.item_id === item.item_id
          ? { ...i, served_qty: previousQty, served: previousQty >= i.qty }
          : i) };
      }));
    }
  };

  // ── Item cancel (whole line, before payment is settled) ───────────────────
  const [cancelTarget, setCancelTarget] = useState<FlatItem | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const handleCancelItem = async (reason: CancelReason) => {
    if (!cancelTarget || cancelling) return;
    setCancelling(true);
    try {
      const res = await crewOrders.cancelItem(cancelTarget.order_id, cancelTarget.item_id, reason);
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

  const requestCollection = async () => {
    if (isPaid || !sessionId || isRequestingCollection || grandTotal <= 0 || orders.length === 0) return;
    setIsRequestingCollection(true);
    try {
      // Flag the session's orders PENDING_STAFF_COLLECTION server-side (so
      // other devices / the dashboard see them), then jump STRAIGHT to this
      // table's collection sheet — no detour through the stacked cash-collection
      // list. The bill refetch happens in the background; the focus effect
      // re-syncs this screen when the crew comes back anyway.
      const res = await crewSessions.requestCollection(sessionId, sessionCustomerPhone ?? '', sessionCustomerName ?? null);
      void loadBill();
      const orderIds = res?.data?.orderIds?.length ? res.data.orderIds : orders.map(o => o.order_id);
      const amount = Number(res?.data?.totalAmount ?? 0) > 0 ? Number(res.data.totalAmount) : grandTotal;
      router.push({
        pathname: '/(staff)/payment-collect',
        params: {
          orderId: orderIds[0] ?? '',
          sessionId,
          orderIds: JSON.stringify(orderIds),
          tableNumber: String(tableNum ?? ''),
          amount: String(amount),
          customerName: sessionCustomerName ?? '',
          customerPhone: sessionCustomerPhone ?? '',
        },
      });
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
      setPrintJob({ phase: 'printing', label: 'KOT' });
      const result = await printKot({
        id: latestOrder.order_id,
        sessionId: sessionId || undefined,
        sessionRef: sessionRef || undefined,
        tableNumber: tablePrintLabel,
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
        setPrintJob({ phase: 'done', label: 'KOT' });
      } else {
        setPrintJob({
          phase: 'failed',
          label: 'KOT',
          message: 'Printer connected but print failed. Check paper / Bluetooth and try again.',
          onRetry: () => { void handlePrintKot(); },
        });
      }
      return;
    }

    // Printer is on a different device — use the Ably round-trip.
    setPrintJob({ phase: 'sending', label: 'KOT' });
    void printerApi
      .reprint(latestOrder.order_id, 'Manual reprint from staff screen')
      .then(() => setPrintJob({ phase: 'sent', label: 'KOT' }))
      .catch(() =>
        setPrintJob({
          phase: 'failed',
          label: 'KOT',
          message: 'Could not send the reprint request. Please try again.',
          onRetry: () => { void handlePrintKot(); },
        }),
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

    // Three independent server calls gate the print; run them CONCURRENTLY so
    // the tap-to-paper delay is one round trip, not three stacked ones. The
    // promise is NOT awaited here — when the QR-choice sheet is shown, these
    // calls run behind it so choosing a QR overlaps the network round-trip
    // instead of stacking a "Preparing…" wait in front of the sheet.
    //
    //  1. Branding/tax refresh — settings changed mid-shift on the dashboard
    //     (GST registration, CGST/SGST split, inclusive pricing, UPI VPA) must
    //     apply to the very next print. Failure falls back to the mount snapshot.
    //  2. Recipient GSTIN persist (best-effort, only when changed) so the ops
    //     PDF receipt matches this thermal print. Never blocks printing.
    //  3. Sequential tax-invoice number (idempotent server-side). Failure falls
    //     back to the last-known number, or the session ref if never numbered.
    const buyerGstin = buyer?.gstin ?? null;
    const buyerName = buyer?.name ?? null;
    const buyerChanged = buyerGstin !== sessionBuyerGstin || buyerName !== sessionBuyerName;

    const prep = (async () => {
      const [brandingRes, buyerRes, finalizeRes] = await Promise.allSettled([
        staffInfo?.restaurantId ? restaurantApi.getBranding(staffInfo.restaurantId) : Promise.resolve(null),
        buyerChanged ? crewSessions.saveBuyer(sessionId, buyerGstin, buyerName) : Promise.resolve(null),
        crewSessions.finalizeInvoice(sessionId),
      ]);

      let invoiceMeta = restaurantInvoiceMeta;
      if (brandingRes.status === 'fulfilled' && brandingRes.value?.success) {
        const res = brandingRes.value;
        invoiceMeta = {
          address: res.data.address ?? null,
          phone: res.data.phone ?? null,
          email: res.data.email ?? null,
          fssaiLicenseNumber: res.data.fssaiLicenseNumber ?? null,
          gstRegistered: res.data.taxConfig?.gstRegistered ?? false,
          gstin: res.data.taxConfig?.gstin ?? null,
          displayMode: (res.data.taxConfig?.displayMode as 'combined' | 'split') ?? 'combined',
          pricesIncludeTax: res.data.taxConfig?.pricesIncludeTax ?? false,
          billThankYouMsg: res.data.billThankYouMsg ?? null,
          billFooterNote: res.data.billFooterNote ?? null,
        };
        setRestaurantInvoiceMeta(invoiceMeta);
        if (res.data.upiId) {
          setUpiId(res.data.upiId);
          setUpiName(res.data.upiDisplayName ?? res.data.name ?? '');
        }
      }

      if (buyerChanged && buyerRes.status === 'fulfilled') {
        setSessionBuyerGstin(buyerGstin);
        setSessionBuyerName(buyerName);
      }

      let invoiceNumber = sessionInvoiceNumber;
      // The loyalty snapshot rides on the same response as the invoice number.
      // Null whenever the venue runs no programme, or the bill has not been
      // paid yet — the nudge is written at payment capture, so a bill printed
      // before settlement legitimately has nothing to show.
      let loyalty: LoyaltyNudge | null = null;
      if (finalizeRes.status === 'fulfilled') {
        invoiceNumber = finalizeRes.value.data.invoice_number;
        loyalty = finalizeRes.value.data.loyalty ?? null;
        setSessionInvoiceNumber(invoiceNumber);
      }

      return { invoiceMeta, invoiceNumber, loyalty };
    })();

    // upiOmitAmount = true → static restaurant QR (diner types amount);
    // false → exact-amount QR. Ignored when no QR prints (paid / no VPA / toggle off).
    const runPrint = async (upiOmitAmount: boolean) => {
      // Usually resolved already (prep ran while the QR sheet was up), so the
      // preparing phase is a flash at most.
      setPrintJob({ phase: 'preparing', label: 'Invoice' });
      const { invoiceMeta, invoiceNumber, loyalty } = await prep;
      setPrintJob({ phase: 'printing', label: 'Invoice' });
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
        tableNumber: tablePrintLabel,
        sessionRef: sessionRef || toSessionRef(sessionId),
        items: invoiceItems,
        subtotal: sessionTotal,
        discount: discountTotal,
        discountLines,
        charges: serviceChargeTotal,
        chargeLines,
        tax: taxTotal,
        taxRate: billTaxRate,
        taxDisplayMode: invoiceMeta?.displayMode,
        taxLines: sessionTaxLines,
        pricesIncludeTax: invoiceMeta?.pricesIncludeTax,
        roundOff: roundOffTotal,
        grandTotal,
        isPaid,
        paymentMethod: billPaymentMethod,
        customerName: sessionCustomerName,
        upiVpa: upiId,
        upiName: upiName || null,
        upiOmitAmount,
        splits: billSplits?.map(s => ({ method: s.method ?? '', amount: Number(s.amount ?? 0) })),
        orderDateTime: orders[0]?.placed_at ?? undefined,
        generatedAt: new Date().toISOString(),
        thankYouMessage: invoiceMeta?.billThankYouMsg ?? null,
        footerNote: invoiceMeta?.billFooterNote ?? null,
        loyalty,
      });

      if (result === 'failed') {
        setPrintJob({
          phase: 'failed',
          label: 'Invoice',
          message: 'Could not print the invoice. Check that the printer is nearby and powered on.',
          onRetry: () => { void runPrint(upiOmitAmount); },
        });
      } else {
        setPrintJob({ phase: 'done', label: 'Invoice' });
      }
    };

    // Only ask which QR to print when a QR would actually be printed
    // (unpaid + a VPA configured + the on-device QR toggle is on).
    const qrWillPrint = !isPaid && !!upiId && isUpiQrEnabled();
    if (!qrWillPrint) {
      await runPrint(false);
      return;
    }

    // Ask which QR to print via the bottom sheet — shown IMMEDIATELY (prep is
    // already running behind it). The chosen option runs the print; dismissing
    // the sheet (backdrop / drag) simply cancels.
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
      setWaiveCode(null); // never inherit the last write-off's reason
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
    // The coded reason is what reaches the adjustments ledger; the free text is
    // kept as the note. The picker guarantees a complete selection, so the
    // server's INVALID_REASON / REASON_TEXT_REQUIRED can't be hit from here.
    if (!isReasonComplete(waiveCode, waiveReason)) return;
    const coded = toReasonPayload(waiveCode!, waiveReason);
    const reason = waiveReason.trim() || WAIVE_REASONS.find((r) => r.code === waiveCode)!.label;
    setFreeing(true);
    try {
      // A table can hold several unpaid orders. Each needs its own single-use
      // grant, but the manager should only type the PIN once — hence `mint`.
      await runWithApproval({ action: 'COMP_ORDER', amount: grandTotal }, async (mint) => {
        for (const o of orders) {
          try {
            const grantId = mint ? await mint(o.order_id, null) : undefined;
            await crewOrders.waive(o.order_id, reason, coded, grantId);
          } catch (e: any) {
            const code = String(e?.code ?? e?.error ?? e?.message ?? '');
            // Surface anything a PIN could fix so the sheet can open.
            if (code === 'ADMIN_REQUIRED' || code === 'AUTHORIZATION_REQUIRED' || code.startsWith('GRANT_') || code === 'PIN_LOCKED_OUT') throw e;
            // ORDER_ALREADY_TERMINAL etc. — that order's already resolved, skip.
          }
        }
        setFreeModalOpen(false);
        await doEndSession();
      });
    } catch (e: any) {
      const code = String(e?.code ?? e?.error ?? e?.message ?? '');
      showDialog('Could not waive', code.includes('ADMIN_REQUIRED') ? 'A manager must approve this write-off.' : 'Please try again.', [{ label: 'OK', onPress: () => {} }]);
    } finally {
      setFreeing(false);
    }
  };

  const handleFreeWithoutCollecting = async () => {
    setFreeing(true);
    try { setFreeModalOpen(false); await doEndSession(); }
    finally { setFreeing(false); }
  };

  // ── Step ladder (§22) ──────────────────────────────────────────────────
  // HOOKS MUST STAY ABOVE `if (isLoading) return`. They once sat below it:
  // the loading render had fewer hooks than the loaded one and every table
  // screen crashed (react-hooks/rules-of-hooks catches it — run lint).
  // A steward reads this mid-service, so it leads with the ACTION — whether
  // something has to be carried to the table — not the step number. The number
  // is context; "bring a cappuccino" is the job.
  const [ladder, setLadder] = useState<CrewLadder | null>(null);
  const [ladderOpen, setLadderOpen] = useState(false);

  useEffect(() => {
    if (!sessionId) { setLadder(null); return; }
    let cancelled = false;
    void (async () => {
      try {
        const res = await loyaltyApi.balance(sessionId);
        if (!cancelled) setLadder(res?.data?.ladder ?? null);
      } catch {
        // A loyalty failure must never disturb a table screen mid-service.
        if (!cancelled) setLadder(null);
      }
    })();
    return () => { cancelled = true; };
  }, [sessionId, orders.length]);

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
        <View style={[styles.bottomBar, { paddingBottom: bottomBarPad }]}>
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

  // Session reference data, behind the header's ⓘ. Everything here is static for
  // the life of the session — the one field that moves (the timer) is promoted
  // to the header, where it's always visible.
  const sessionInfoSheetJsx = (
    <BottomSheet visible={sessionInfoOpen} onClose={() => setSessionInfoOpen(false)} title="Session details">
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
                <Ionicons
                  name={expiry === 'overdue' ? 'alert-circle-outline' : 'timer-outline'}
                  size={13}
                  color={countdownStr ? expiryFg : QuinckleColors.textSecondary}
                />
                <Text style={[styles.sessionInfoLabel, countdownStr ? { color: expiryFg } : null]}>
                  {!countdownStr ? 'Active for' : expiry === 'overdue' ? 'Over by' : 'Time left'}
                </Text>
              </View>
              <Text style={[styles.sessionInfoValueStrong, { fontVariant: ['tabular-nums'] as any }, countdownStr ? { color: expiryFg } : null]}>
                {countdownStr ?? elapsed}
              </Text>
            </View>
          </>
        ) : null}
      </View>
    </BottomSheet>
  );

  // ── Primary actions, as fixed slots ────────────────────────────────────────
  // Always three cards in the same order and the same positions. A card whose
  // action isn't available right now renders disabled rather than disappearing,
  // so the row never reflows and muscle memory holds: "print is the third one"
  // stays true whether or not the venue has a UPI ID or the session is closed.
  // Why a card is dim, in the words of the person who'd ask. A greyed control
  // that does nothing on tap reads as a broken app; saying why turns it into
  // information. Null means the action is available — these strings ARE the
  // enabled/disabled state, so the two can never drift apart.
  const addItemsReason = !sessionId
    ? 'No open session on this table. Seat a guest first, then add items.'
    : sessionStatus === 'closed'
      ? 'This session is closed. Reopen the table to add more items.'
      : null;
  const upiQrReason = upiId
    ? null
    : 'No UPI ID set for this venue, so there is no payment QR to show. Add one in the partner dashboard under Settings.';

  /**
   * A disabled card stays TAPPABLE so it can explain itself — only the action is
   * withheld. Screen readers get the reason via accessibilityHint and still hear
   * "disabled", so they never need the toast at all.
   */
  const actionCard = (
    key: string,
    icon: React.ComponentProps<typeof Ionicons>['name'],
    label: string,
    onPress: () => void,
    disabledReason: string | null,
  ) => {
    const enabled = !disabledReason;
    return (
      <TouchableOpacity
        key={key}
        style={[styles.actionCard, !enabled && styles.actionCardDisabled]}
        onPress={enabled ? onPress : () => setHint(disabledReason)}
        activeOpacity={enabled ? 0.75 : 0.9}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={disabledReason ?? undefined}
        accessibilityState={{ disabled: !enabled }}
      >
        <Ionicons
          name={icon}
          size={20}
          color={enabled ? QuinckleColors.textPrimary : QuinckleColors.textTertiary}
        />
        <Text style={[styles.actionCardLabel, !enabled && styles.actionCardLabelDisabled]} numberOfLines={1}>
          {label}
        </Text>
      </TouchableOpacity>
    );
  };


  // What the strip says, from the reward's real state. A free item only
  // reaches the table through an order — "bring it" used to show even when
  // nothing was ordered (a free coffee off the books) or when it was already
  // on the KOT (two coffees). The one thing a steward acts on is a free item
  // the guest has not added yet: tell them.
  const ladderDue = ladder?.thisVisit ?? null;
  const ladderToUnlock = ladder?.visitsToUnlock ?? 0;
  const ladderUnderMin = !!ladder?.minBill && ladder.meetsMinBill === false
    && !ladderDue?.applied && !ladderDue?.ordered;
  const ladderNudge = !!ladderDue?.carry && !ladderDue.claimed && !ladderDue.ordered;
  const ladderLine = !ladder
    ? ''
    : ladderToUnlock > 0
      ? `Qualifying — ${ladderToUnlock} visit${ladderToUnlock === 1 ? '' : 's'} to unlock`
    : ladderDue && ladderUnderMin
      ? `${ladderDue.rewardName} — needs a ₹${Math.round(ladder.minBill!)} bill`
    : ladderDue
      ? ladderDue.carry
        ? ladderDue.ordered
          ? `${ladderDue.rewardName} — on the KOT, free`
          : ladderDue.claimed
            ? `${ladderDue.rewardName} — in the guest's cart`
            : `${ladderDue.rewardName} free — ask the guest to add it`
        : ladderDue.applied
          ? `${ladderDue.rewardName} — off this bill`
          : `${ladderDue.rewardName} — comes off this bill`
      : ladder.eligible === false
        ? 'Visit already counted today'
        : `Step ${ladder.step} of ${ladder.totalSteps}`;

  const ladderStripJsx = ladder ? (
    <TouchableOpacity
      style={[styles.ladderStrip, ladderNudge && styles.ladderStripCarry]}
      onPress={() => setLadderOpen(true)}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={ladderLine}
    >
      <Ionicons
        name={ladderDue?.carry ? 'gift' : 'trophy-outline'}
        size={16}
        color={ladderNudge ? QuinckleColors.warning : QuinckleColors.textTertiary}
      />
      <Text style={styles.ladderStripText} numberOfLines={1}>
        {ladderLine}
      </Text>
      <Ionicons name="chevron-forward" size={14} color={QuinckleColors.textTertiary} />
    </TouchableOpacity>
  ) : null;

  // The ladder, expanded, as a stamp card: one stamp per visit so a steward
  // reads "where is this guest" at a glance, then today's stamp says the job.
  const ladderStepsDone = ladder ? ladder.steps.filter((st) => st.state === 'done').length : 0;
  const ladderLast = ladder?.steps[ladder.steps.length - 1] ?? null;
  const ladderCardKicker = !ladder ? ''
    : ladderToUnlock > 0 ? 'Qualifying'
    : ladderDue ? "Today's stamp"
    : ladder.eligible === false ? 'Already stamped'
    : "Today's stamp";
  const ladderCardTitle = !ladder ? ''
    : ladderToUnlock > 0 ? `${ladderToUnlock} visit${ladderToUnlock === 1 ? '' : 's'} to unlock`
    : ladderDue ? ladderDue.rewardName
    : ladder.eligible === false ? 'Visit counted today'
    : 'No reward this step';
  const ladderCardDetail = !ladder ? ''
    : ladderToUnlock > 0 ? 'Rewards start once they qualify'
    : ladderDue && ladderUnderMin ? `Needs a ₹${Math.round(ladder.minBill!)} bill to count`
    : ladderDue
      ? ladderDue.carry
        ? ladderDue.ordered ? 'On the KOT — free'
          : ladderDue.claimed ? "In the guest's cart"
          : 'Not in their cart yet — ask them to add it'
        : ladderDue.applied ? 'Off this bill' : 'Comes off this bill'
    : ladder.eligible === false ? 'Nothing more to collect on this visit'
    : 'They just move up a stamp';

  let stampScroll: ScrollView | null = null;
  const ladderSheetJsx = (
    <BottomSheet visible={ladderOpen} onClose={() => setLadderOpen(false)} title="Stamp card">
      {/* The ladder itself, and nothing else. No visit history in v1: it would
          let any steward read a regular's pattern, and it is far easier to add
          later than to walk back. */}
      {ladder && (
        <View style={{ paddingHorizontal: Spacing.xl }}>
          <Text style={styles.stampCount}>
            {ladderToUnlock > 0 ? 'Not on the card yet' : `${ladderStepsDone} of ${ladder.totalSteps} stamped`}
          </Text>

          {/* One row, swiped sideways — a ladder can run to 10+ steps and a
              wrapped grid loses the left-to-right "journey". The row opens
              scrolled to today's stamp. No hook here (this sits below the
              loading return), so the scroll handle is a plain render local. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            ref={(r) => { stampScroll = r; }}
            contentContainerStyle={styles.stampRow}
            style={styles.stampScroller}
          >
            {ladder.steps.map((st, i) => {
              const isLast = i === ladder.steps.length - 1;
              const img = st.imageUrl || null;
              const ring = st.state === 'done' ? styles.stampDone
                : st.state === 'current' ? styles.stampCurrent
                : styles.stampUpcoming;
              return (
                <View
                  key={st.position}
                  style={styles.stampCell}
                  onLayout={st.state === 'current'
                    ? (e) => stampScroll?.scrollTo({ x: Math.max(0, e.nativeEvent.layout.x - 96), animated: false })
                    : undefined}
                >
                  <View style={[styles.stamp, ring]}>
                    {img ? (
                      <Image
                        source={{ uri: img }}
                        style={[styles.stampImg, st.state === 'upcoming' && { opacity: 0.45 }]}
                      />
                    ) : st.state === 'done' ? (
                      <Ionicons name="checkmark" size={22} color={QuinckleColors.background} />
                    ) : st.state === 'current' ? (
                      <Ionicons name={st.rewardName ? 'gift-outline' : 'arrow-up'} size={22} color={QuinckleColors.primary} />
                    ) : isLast ? (
                      <Ionicons name="trophy-outline" size={20} color={QuinckleColors.textTertiary} />
                    ) : (
                      <Text style={styles.stampNum}>{st.position}</Text>
                    )}
                    {img && st.state === 'done' && (
                      <View style={styles.stampDoneVeil}>
                        <Ionicons name="checkmark" size={22} color={QuinckleColors.textPrimary} />
                      </View>
                    )}
                  </View>
                  <Text
                    style={[styles.stampLabel, st.state === 'current' && styles.stampLabelCurrent]}
                    numberOfLines={1}
                  >
                    {st.state === 'current' ? 'Today' : st.rewardName ?? `Step ${st.position}`}
                  </Text>
                </View>
              );
            })}
          </ScrollView>

          <View style={[styles.stampToday, ladderNudge && styles.stampTodayNudge]}>
            <Text style={styles.stampKicker}>{ladderCardKicker}</Text>
            <Text style={styles.stampTitle} numberOfLines={2}>{ladderCardTitle}</Text>
            <Text style={[styles.stampDetail, (ladderNudge || ladderUnderMin) && { color: QuinckleColors.warning }]}>
              {ladderCardDetail}
            </Text>
          </View>

          {!ladder.optedIn && (
            <Text style={styles.stampNote}>
              This guest hasn&apos;t joined yet — nothing is being collected.
            </Text>
          )}

          <View style={styles.stampFacts}>
            {ladder.nextVisit && (
              <View style={styles.stampFactRow}>
                <Text style={styles.stampFactLabel}>Next visit</Text>
                <Text style={styles.stampFactValue} numberOfLines={1}>{ladder.nextVisit.rewardName}</Text>
              </View>
            )}
            {ladderLast?.rewardName && ladderLast.state === 'upcoming' && (
              <View style={styles.stampFactRow}>
                <Text style={styles.stampFactLabel}>Card complete</Text>
                <Text style={styles.stampFactValue} numberOfLines={1}>{ladderLast.rewardName}</Text>
              </View>
            )}
            {!!ladder.minBill && (
              <View style={styles.stampFactRow}>
                <Text style={styles.stampFactLabel}>Min. bill</Text>
                <Text style={styles.stampFactValue}>
                  ₹{Math.round(ladder.minBill)}{ladder.meetsMinBill ? ' · met' : ''}
                </Text>
              </View>
            )}
          </View>
        </View>
      )}
    </BottomSheet>
  );

  const actionRowJsx = (
    <View style={styles.actionRow}>
      {actionCard('add', 'add-circle-outline', 'Add items', () => router.push({
        pathname: '/(staff)/order-menu',
        params: {
          tableId: String(tableId),
          tableNum,
          tableDbId: tableDbId ?? '',
          sessionId,
          customerPhone: sessionCustomerPhone ?? '',
          customerName: sessionCustomerName ?? '',
        },
      }), addItemsReason)}
      {actionCard('qr', 'qr-code-outline', 'UPI QR', () => {
        setUpiAmount(''); setUpiUri(null); setShowUpiModal(true);
      }, upiQrReason)}
      {actionCard('print', 'print-outline', 'Print', () => {
        setActionMenuOpen(false); setPrintMenuOpen(true);
      }, null)}
    </View>
  );

  const orderListJsx = (
    <>
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
        style={isWide ? styles.wideFlatList : undefined}
        data={flatItems}
        keyExtractor={item => item.key}
        // Tablet's list is not overlaid by the docked bar — it lives in its own
        // pane — so it keeps the base clearance.
        contentContainerStyle={isWide ? styles.listContent : { paddingBottom: listBottomPad }}
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
          const servedQty = Math.max(0, Math.min(item.qty, item.servedQty));
          const isPartial = !isServed && servedQty > 0;
          // Hold-to-serve-the-rest only earns its place when there IS a rest.
          const holdable = !isServed && item.qty - servedQty > 1;
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
                  {isPartial ? (
                    <Text style={styles.itemPartialServed}>{servedQty} of {item.qty} served</Text>
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
                <View style={styles.serveActions}>
                  {dinerStatusMode === 'DUAL_CHANNEL' ? (
                    item.status === 'ready' ? (
                      <View style={styles.readyBadge}>
                        <Ionicons name="checkmark-circle" size={11} color={QuinckleColors.success} />
                        <Text style={styles.readyBadgeText}>Ready</Text>
                      </View>
                    ) : (
                      <View style={styles.prepBadge}>
                        <Ionicons name="time-outline" size={11} color={QuinckleColors.warning} />
                        <Text style={styles.prepBadgeText}>Preparing</Text>
                      </View>
                    )
                  ) : null}
                  {/* The row's long-press is already cancel-item, so partial
                      serving lives on the button: tap = one more unit,
                      hold = hand over the rest. */}
                  <TouchableOpacity
                    style={styles.markServedBtn}
                    onPress={() => void handleServe(item, servedQty + 1)}
                    onLongPress={holdable ? () => void handleServe(item, item.qty) : undefined}
                    delayLongPress={350}
                    activeOpacity={0.75}
                  >
                    <Text style={styles.markServedText}>
                      {item.qty > 1
                        ? (holdable ? `Serve 1 · hold for ${item.qty - servedQty}` : 'Serve last one')
                        : 'Mark served'}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}
            </TouchableOpacity>
          );
        }}
      />
    </>
  );

  // ── Three-dot menu ── shared by the phone and tablet headers.
  const actionMenuJsx = (
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
        </View>
  );

  // Phone header: a centred nav bar. The title opens session details (it
  // replaces the separate ⓘ target), and the timer is a coloured status line
  // under it — green with time to spare, amber running low, red overdue.
  const statusDot = !countdownStr ? QuinckleColors.textTertiary
    : expiry === 'normal' ? QuinckleColors.success
    : expiry === 'warning' ? QuinckleColors.warning
    : QuinckleColors.danger;
  const statusText = countdownStr
    ? countdownStr === 'Expired' ? 'Time up' : `${countdownStr} left`
    : elapsed ? `Seated ${elapsed}` : '';
  const phoneHeaderJsx = (
    <View style={styles.navBar}>
      <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Back">
        <Ionicons name="chevron-back" size={20} color={QuinckleColors.textPrimary} />
      </TouchableOpacity>

      <TouchableOpacity
        onPress={() => setSessionInfoOpen(true)}
        style={styles.navCenter}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`Table T${tableNum}, session details`}
      >
        <View style={styles.navTitleRow}>
          <Text style={styles.navTitle} numberOfLines={1}>
            Table T{tableNum}{groupLabel ? ` · ${groupLabel}` : ''}
          </Text>
          <Ionicons name="chevron-down" size={14} color={QuinckleColors.textTertiary} />
        </View>
        {(statusText || mergedFrom.length > 0) ? (
          <View style={styles.navStatusRow}>
            {!!statusText && (
              <>
                <View style={[styles.navDot, { backgroundColor: statusDot }]} />
                <Text style={[styles.navStatus, countdownStr && expiry !== 'normal' ? { color: expiryFg } : null]}>
                  {statusText}
                </Text>
              </>
            )}
            {/* Merged stays visible — it changes how staff read the bill. */}
            {mergedFrom.length > 0 && (
              <Text style={[styles.navStatus, { color: QuinckleColors.warning }]}>
                {statusText ? ' · ' : ''}Merged
              </Text>
            )}
          </View>
        ) : null}
      </TouchableOpacity>

      {actionMenuJsx}
    </View>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top + Spacing.sm }]}>
      {!isWide ? phoneHeaderJsx : (
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={20} color={QuinckleColors.textPrimary} />
          </TouchableOpacity>
          <Text style={styles.tableTitle} numberOfLines={1}>
            T{tableNum}{groupLabel ? ` · ${groupLabel}` : ''}
          </Text>

          {/* Session identity moved into this sheet — the ref used to be printed
              under the table number AND again as a "Ref" row, twice over. */}
          <TouchableOpacity
            onPress={() => setSessionInfoOpen(true)}
            style={styles.infoBtn}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Session details"
          >
            <Ionicons name="information-circle-outline" size={18} color={QuinckleColors.textSecondary} />
          </TouchableOpacity>

          {/* Merged tables stay visible. Which sessions this table absorbed
              changes how staff read the bill, so it must not hide in a sheet. */}
          {mergedFrom.length > 0 ? (
            <View style={styles.mergedBadge}>
              <Ionicons name="git-merge-outline" size={11} color={QuinckleColors.warning} />
              <Text style={styles.mergedBadgeText}>Merged</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.headerRight}>
          {/* The one session field that changes and that staff act on. */}
          {(countdownStr || elapsed) ? (
            <View style={[styles.headerTimeChip, countdownStr ? expiryChipStyle(expiry) : null]}>
              <Ionicons
                name={expiry === 'overdue' ? 'alert-circle-outline' : 'timer-outline'}
                size={12}
                color={countdownStr ? expiryFg : QuinckleColors.textSecondary}
              />
              <Text style={[styles.headerTimeText, countdownStr ? { color: expiryFg } : null]}>
                {countdownStr ?? elapsed}
              </Text>
            </View>
          ) : null}

          {/* Add items / UPI QR / Print now live as the action cards below —
              bigger targets than 18px glyphs in the worst corner of the screen
              for someone working one-handed. Only the overflow stays here. */}

          {actionMenuJsx}
        </View>{/* end headerRight */}
      </View>
      )}{/* end header */}

      {isWide ? (
        // ── POS layout: order ticket fills the main pane, a fixed receipt rail
        //    on the right carries the session summary, itemized bill, and the
        //    docked pay CTA. ──
        <View style={[styles.wideRow, { paddingBottom: insets.bottom + Spacing.md }]}>
          <View style={styles.wideMainPane}>
            {orderListJsx}
          </View>

          <View style={styles.railPane}>
            {/* Compact session header. T{num}, the ref and the timer all live in
                the screen header now, so the rail carries only the guest
                identity the bill is handed to. */}
            <View style={styles.railHeader}>
              <View style={styles.railHeaderTop}>
                <Text style={styles.railGuest} numberOfLines={1}>
                  {sessionCustomerName?.trim() || 'Walk-in guest'}
                </Text>
              </View>
              {sessionCustomerPhone?.trim() ? (
                <Text style={styles.railPhone}>{sessionCustomerPhone.trim()}</Text>
              ) : null}
            </View>

            {/* Same three actions as the phone layout, so behaviour doesn't
                diverge by form factor. */}
            {ladderStripJsx}
            {actionRowJsx}

            <View style={styles.railBillWrap}>
              <BillExplainContent
                bill={explainedBill}
                pinned
                inset={false}
                onGiveDiscount={!isPaid && orders.length > 0 ? () => setDiscountModalOpen(true) : undefined}
              />
            </View>

            {/* Docked CTA / status */}
            <View style={styles.railFooter}>
              {!isPaid && grandTotal > 0 && orders.length > 0 ? (
                <TouchableOpacity
                  style={[styles.collectBtn, isRequestingCollection && { opacity: 0.65 }]}
                  onPress={() => { setIsExpanded(false); void requestCollection(); }}
                  disabled={isRequestingCollection}
                  activeOpacity={0.85}
                >
                  {isRequestingCollection
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Ionicons name="cash-outline" size={16} color="#fff" />}
                  <Text style={styles.collectBtnText}>
                    {isRequestingCollection ? 'Creating request...' : 'Send to Payment Collection'}
                  </Text>
                </TouchableOpacity>
              ) : isPaid ? (
                <View style={[
                  styles.railPaidBadge,
                  (billPaymentMethod === 'due' || (billDueAmount ?? 0) > 0) ? styles.paidBadgeKhata : styles.paidBadgeActive,
                ]}>
                  <Ionicons
                    name={(billPaymentMethod === 'due' || (billDueAmount ?? 0) > 0) ? 'book-outline' : 'checkmark-circle'}
                    size={15}
                    color={(billPaymentMethod === 'due' || (billDueAmount ?? 0) > 0) ? QuinckleColors.warning : QuinckleColors.success}
                  />
                  <Text style={[
                    styles.railPaidText,
                    { color: (billPaymentMethod === 'due' || (billDueAmount ?? 0) > 0) ? QuinckleColors.warning : QuinckleColors.success },
                  ]}>
                    {billPaymentMethod === 'due' ? 'On khata'
                      : (billDueAmount ?? 0) > 0 ? `Split · ₹${Math.round(billDueAmount ?? 0)} on khata`
                      : billPaymentMethod === 'waived' ? 'Waived'
                      : billPaymentMethod === 'cash' ? 'Settled · Cash'
                      : billPaymentMethod === 'upi_direct' ? 'Settled · UPI'
                      : billPaymentMethod === 'mixed' ? 'Settled · Split'
                      : 'Settled'}
                  </Text>
                </View>
              ) : (
                <Text style={styles.railEmptyHint}>No items to bill yet</Text>
              )}
            </View>
          </View>
        </View>
      ) : (
        <>
          {ladderStripJsx}
            {actionRowJsx}
          {orderListJsx}
        </>
      )}

      {/* Tablet-landscape: Grand Total is already always visible in the left
          pane's receipt, so repeating it here would be a second duplicate —
          show the bar only when there's an actual action to take. Phone
          keeps the full total row since the breakdown lives behind a tap. */}
      {!isWide && (
        <View style={[styles.bottomBar, { paddingBottom: bottomBarPad }]}>
          {!isWide && (
            <TouchableOpacity style={styles.totalRow} activeOpacity={0.85} onPress={() => setIsExpanded(true)}>
              <View>
                <Text style={styles.totalLabel}>Total Payable</Text>
                {/* Khata (pay later) bills settle the table but the money is owed
                    on the customer's khata — amber, never green, so it can't be
                    read as cash-in-drawer, and never "Pending" so nobody
                    double-collects at the table. */}
                <View style={[
                  styles.paidBadge,
                  isPaid
                    ? (billPaymentMethod === 'due' || (billDueAmount ?? 0) > 0) ? styles.paidBadgeKhata : styles.paidBadgeActive
                    : styles.paidBadgeInactive,
                ]}>
                  <Text style={[
                    styles.paidBadgeText,
                    isPaid
                      ? (billPaymentMethod === 'due' || (billDueAmount ?? 0) > 0) ? styles.paidBadgeTextKhata : styles.paidBadgeTextActive
                      : styles.paidBadgeTextInactive,
                  ]}>
                    {isPaid
                      ? billPaymentMethod === 'due' ? 'On khata'
                      : (billDueAmount ?? 0) > 0 ? `Split · ₹${Math.round(billDueAmount ?? 0)} on khata`
                      : billPaymentMethod === 'waived' ? 'Waived'
                      : billPaymentMethod === 'cash' ? 'via Cash'
                      : billPaymentMethod === 'upi_direct' ? 'via UPI'
                      : billPaymentMethod === 'mixed' ? 'Split'
                      : 'Settled'
                      : 'Pending'}
                  </Text>
                </View>
              </View>
              <View style={styles.totalValueContainer}>
                {/* Discount lives on the total, not inside the breakdown sheet —
                    giving one shouldn't require opening a read-only explanation
                    of the bill first. Nested inside the row's Touchable: the
                    inner responder wins, so this does not also expand the sheet. */}
                {!isPaid && orders.length > 0 && (
                  <TouchableOpacity
                    onPress={() => setDiscountModalOpen(true)}
                    style={styles.totalDiscountBtn}
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 8 }}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityLabel={discountTotal > 0 ? 'Edit discount' : 'Give discount'}
                  >
                    <MaterialCommunityIcons
                      name="percent-box-outline"
                      size={20}
                      color={discountTotal > 0 ? QuinckleColors.primary : QuinckleColors.textSecondary}
                    />
                  </TouchableOpacity>
                )}
                <Text style={styles.totalValue}>₹{grandTotal.toFixed(0)}</Text>
                {/* Chevron signals the row expands the bill breakdown sheet. */}
                <Ionicons name="chevron-up" size={18} color={QuinckleColors.textTertiary} style={{ marginLeft: Spacing.sm }} />
              </View>
            </TouchableOpacity>
          )}

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
      )}

      <ThemedDialog visible={dialog.visible} title={dialog.title} message={dialog.message} actions={dialog.actions} onClose={closeDialog} />

      {/* ── Overlays ──────────────────────────────────────────────────────────
          Everything below renders AFTER the docked bottom bar on purpose.
          BottomSheet is an inline absolutely-positioned overlay, not a Modal /
          portal, so paint order is JSX order — a sheet declared before the bar
          comes out UNDERNEATH it, with the total and collect button sitting on
          top of the sheet. Keep new sheets and toasts in this block. */}
      {sessionInfoSheetJsx}
      {ladderSheetJsx}

      <HintToast message={hint} onDismiss={() => setHint(null)} bottomOffset={isWide ? 24 : 96} />

      {/* The full bill, explained — the same sheet Collect Payment opens. */}
      <BillExplainSheet
        visible={isExpanded}
        onClose={() => setIsExpanded(false)}
        bill={explainedBill}
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

      {managerPinSheet}

      {/* ── Item cancel bottom sheet (confirm + reason in one step) ── */}
      <ReasonSheet
        visible={!!cancelTarget}
        title="Cancel this item?"
        subject={cancelTarget?.name}
        note={`₹${(cancelTarget?.price ?? 0).toFixed(0)} will be removed from the bill. This can't be undone.`}
        confirmLabel="Cancel item"
        busy={cancelling}
        onConfirm={(reason) => void handleCancelItem(reason)}
        onClose={() => setCancelTarget(null)}
      />

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

      {/* Tap-to-paper print progress */}
      <PrintProgressOverlay job={printJob} onDismiss={() => setPrintJob(null)} />

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

            {/* Zeroing the bill is an exemption, not a discount — say why. A
                non-admin can still do it; a manager approves with the PIN. */}
            {discountZeroesBill && (
              <>
                <ReasonChips
                  reasons={EXEMPTION_REASONS}
                  prompt="This clears the whole bill. Why?"
                  code={exemptCode}
                  text={exemptText}
                  onPickCode={setExemptCode}
                  onChangeText={setExemptText}
                  disabled={applyingDiscount}
                />
                {!isAdmin && (
                  <Text style={styles.discountAdminNote}>
                    A manager will be asked to approve this.
                  </Text>
                )}
              </>
            )}

            <View style={styles.swapFooter}>
              <TouchableOpacity style={styles.swapCancel} onPress={() => setDiscountModalOpen(false)} activeOpacity={0.8} disabled={applyingDiscount}>
                <Text style={styles.swapCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.swapConfirm, !canApplyDiscount && { opacity: 0.4 }]}
                onPress={handleApplyDiscount}
                disabled={!canApplyDiscount}
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

                <TouchableOpacity style={styles.freeOptBtn} onPress={() => setFreeStep('waive')} activeOpacity={0.85} disabled={freeing}>
                  <Ionicons name="remove-circle-outline" size={18} color={QuinckleColors.textSecondary} />
                  <Text style={styles.freeOptBtnText}>Write off (waive)</Text>
                </TouchableOpacity>

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
                <ReasonChips
                  reasons={WAIVE_REASONS}
                  prompt="Why is it being written off?"
                  code={waiveCode}
                  text={waiveReason}
                  onPickCode={setWaiveCode}
                  onChangeText={setWaiveReason}
                  disabled={freeing}
                />
                <View style={styles.swapFooter}>
                  <TouchableOpacity style={styles.swapCancel} onPress={() => setFreeStep('choose')} activeOpacity={0.8} disabled={freeing}>
                    <Text style={styles.swapCancelText}>Back</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.swapConfirm, (!isReasonComplete(waiveCode, waiveReason) || freeing) && { opacity: 0.4 }]}
                    onPress={handleWaiveAndFree}
                    disabled={!isReasonComplete(waiveCode, waiveReason) || freeing}
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
  discountAdminNote: { fontSize: 12, color: QuinckleColors.warning, textAlign: 'center', marginTop: 12, lineHeight: 17 },
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
  // Tablet-landscape two-pane layout: session details + a permanently-
  // visible bill breakdown on the left, ordered items alone on the right.
  wideRow: { flex: 1, flexDirection: 'row', gap: Spacing.lg },
  wideLeftPane: { width: 360 },
  wideDivider: { width: 1, backgroundColor: QuinckleColors.border },
  wideRightPane: { flex: 1, paddingLeft: Spacing.xs },
  wideBillWrap: { flex: 1, marginTop: Spacing.md },
  wideFlatList: { flex: 1 },

  // ── POS layout: order ticket (main) + receipt rail (right) ──
  wideMainPane: { flex: 1 },
  railPane: {
    width: 340,
    backgroundColor: QuinckleColors.surface,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    overflow: 'hidden',
  },
  railHeader: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg, paddingBottom: Spacing.md },
  railHeaderTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  railGuest: { ...Typography.subtitle, color: QuinckleColors.textPrimary, flex: 1 },
  railPhone: { ...Typography.caption, color: QuinckleColors.textSecondary, marginTop: 2 },
  railBillWrap: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: QuinckleColors.borderSubtle,
  },
  railFooter: {
    paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg, paddingBottom: Spacing.lg,
    borderTopWidth: 1, borderTopColor: QuinckleColors.border,
    backgroundColor: QuinckleColors.surface,
  },
  railPaidBadge: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: Radius.md, borderWidth: 1,
  },
  railPaidText: { fontSize: 14, fontWeight: '700' },
  railEmptyHint: { ...Typography.caption, color: QuinckleColors.textMuted, textAlign: 'center', paddingVertical: 12 },
  navBar: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingBottom: Spacing.md, marginBottom: Spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: QuinckleColors.border,
    // The three-dot menu drops below the bar; keep it above the content.
    zIndex: 10,
  },
  navCenter: { flex: 1, minWidth: 0, alignItems: 'center' },
  navTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '100%' },
  navTitle: { flexShrink: 1, fontSize: 17, fontWeight: '700', color: QuinckleColors.textPrimary, letterSpacing: -0.2 },
  navStatusRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  navDot: { width: 6, height: 6, borderRadius: 3, marginRight: 5 },
  navStatus: { fontSize: 12, fontWeight: '600', color: QuinckleColors.textSecondary, fontVariant: ['tabular-nums'] as any },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.xl },
  // flex + minWidth:0 so a long groupLabel truncates the table title instead of
  // pushing the timer and overflow menu off the right edge.
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, flex: 1, minWidth: 0 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexShrink: 0 },
  iconBtn: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: QuinckleColors.surfaceMuted, borderWidth: 1, borderColor: QuinckleColors.border, alignItems: 'center', justifyContent: 'center' },
  tableTitle: { fontSize: 22, fontWeight: '700', color: QuinckleColors.textPrimary, letterSpacing: -0.4, flexShrink: 1 },
  sinceText: { fontSize: 11, color: QuinckleColors.textTertiary, fontWeight: '500', marginTop: 1 },

  // ── Header: session info affordance, merged badge, live timer ──────────────
  infoBtn: { padding: 4, marginLeft: -2 },
  mergedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: QuinckleColors.surfaceMuted, borderRadius: Radius.pill,
    paddingHorizontal: Spacing.sm, paddingVertical: 3,
    borderWidth: 1, borderColor: QuinckleColors.warning,
  },
  mergedBadgeText: { fontSize: 10, fontWeight: '700', color: QuinckleColors.warning, letterSpacing: 0.3 },
  headerTimeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: QuinckleColors.surfaceMuted, borderRadius: Radius.pill,
    paddingHorizontal: Spacing.sm, paddingVertical: 5,
    borderWidth: 1, borderColor: QuinckleColors.border,
  },
  headerTimeChipDanger: { borderColor: QuinckleColors.danger },
  headerTimeText: { fontSize: 12, fontWeight: '700', color: QuinckleColors.textSecondary, fontVariant: ['tabular-nums'] as any },

  // ── Primary action cards ───────────────────────────────────────────────────
  // Three equal fixed slots. `flex: 1` on every card keeps the widths identical
  // whether or not an action is currently available, so a disabled card holds
  // its place instead of letting the row reflow.
  // ── Step ladder strip ──────────────────────────────────────────────────
  // ABOVE the action cards, not below. Those three are deliberately fixed slots
  // so "print is the third one" stays true for muscle memory; a fourth card
  // would break that, and a strip under them is below the fold of a steward's
  // attention. This is information about the guest, and it belongs with them.
  ladderStrip: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    backgroundColor: QuinckleColors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1, borderColor: QuinckleColors.border,
  },
  // Something has to be carried to the table — the only state worth colour.
  ladderStripCarry: { borderColor: QuinckleColors.warning },
  ladderStripText: { flex: 1, fontSize: 13, fontWeight: '600', color: QuinckleColors.textPrimary },
  stampCount: { fontSize: 12, color: QuinckleColors.textTertiary, marginBottom: Spacing.md },
  stampScroller: { marginHorizontal: -Spacing.xl, marginBottom: Spacing.lg },
  stampRow: { paddingHorizontal: Spacing.xl, gap: Spacing.sm },
  stampCell: { width: 64, alignItems: 'center' },
  stamp: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  stampDone: { backgroundColor: QuinckleColors.primary, borderWidth: 2, borderColor: QuinckleColors.primary },
  stampCurrent: { borderWidth: 2, borderStyle: 'dashed', borderColor: QuinckleColors.primary, backgroundColor: QuinckleColors.primarySoft },
  stampUpcoming: { borderWidth: 1, borderColor: QuinckleColors.borderStrong, backgroundColor: QuinckleColors.surfaceMuted },
  stampImg: { width: '100%', height: '100%' },
  stampDoneVeil: {
    ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(243,93,59,0.72)',
  },
  stampLabel: { marginTop: 6, fontSize: 10, color: QuinckleColors.textTertiary, maxWidth: 64 },
  stampLabelCurrent: { color: QuinckleColors.primary, fontWeight: '700' },
  stampNum: { fontSize: 13, fontWeight: '600', color: QuinckleColors.textTertiary, fontVariant: ['tabular-nums'] as any },
  stampToday: {
    backgroundColor: QuinckleColors.surfaceElevated, borderRadius: Radius.md,
    borderWidth: 1, borderColor: QuinckleColors.border,
    padding: Spacing.md, marginBottom: Spacing.md,
  },
  stampTodayNudge: { borderColor: QuinckleColors.primarySoftBorder },
  stampKicker: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', color: QuinckleColors.primary },
  stampTitle: { fontSize: 19, fontWeight: '700', color: QuinckleColors.textPrimary, marginTop: 4, marginBottom: 2 },
  stampDetail: { fontSize: 13, color: QuinckleColors.textSecondary },
  stampNote: { fontSize: 12, color: QuinckleColors.textTertiary, marginBottom: Spacing.md },
  stampFacts: { gap: Spacing.sm },
  stampFactRow: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md },
  stampFactLabel: { fontSize: 13, color: QuinckleColors.textSecondary },
  stampFactValue: { flexShrink: 1, fontSize: 13, fontWeight: '600', color: QuinckleColors.textPrimary, textAlign: 'right' },

  actionRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.lg },
  actionCard: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: Spacing.md,
    backgroundColor: QuinckleColors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
  },
  actionCardDisabled: { opacity: 0.4, borderColor: QuinckleColors.borderSubtle },
  actionCardLabel: { fontSize: 12, fontWeight: '600', color: QuinckleColors.textPrimary },
  actionCardLabelDisabled: { color: QuinckleColors.textTertiary },

  sessionGroup: {
    backgroundColor: QuinckleColors.surface,
    borderRadius: Radius.lg,
    overflow: 'hidden',
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
  itemPartialServed: { color: QuinckleColors.success, fontSize: 12, fontWeight: '600', marginTop: 2 },
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
  // Dual-channel only: item-level kitchen state shown beside the serve button.
  serveActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  readyBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 6, backgroundColor: QuinckleColors.successSoft },
  readyBadgeText: { color: QuinckleColors.success, fontSize: 11, fontWeight: '700' },
  prepBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 6, backgroundColor: QuinckleColors.warningSoft },
  prepBadgeText: { color: QuinckleColors.warning, fontSize: 11, fontWeight: '700' },
  itemNameCancelled: { textDecorationLine: 'line-through', color: QuinckleColors.textTertiary },
  cancelledBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, backgroundColor: 'rgba(239,68,68,0.12)' },
  cancelledBadgeText: { color: QuinckleColors.danger, fontSize: 11, fontWeight: '700' },
  // ── Item cancel bottom sheet (content inside the shared BottomSheet) ──
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.huge, gap: Spacing.md },
  emptyText: { color: QuinckleColors.textTertiary, fontSize: 14 },
  // paddingBottom is applied inline from `bottomBarPad` — it depends on the
  // device's navigation-bar inset and cannot be a static value under
  // edge-to-edge. See the comment on bottomBarPad.
  bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: Spacing.xl, paddingTop: Spacing.lg, backgroundColor: QuinckleColors.surface, borderTopWidth: 1, borderTopColor: QuinckleColors.border },
  // Constrained to the right pane's width so it never overlaps the left
  // pane's always-visible receipt at the bottom.
  bottomBarWide: { left: Spacing.lg + 360 + Spacing.lg + 1 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel: { color: QuinckleColors.textTertiary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  totalValueContainer: { flexDirection: 'row', alignItems: 'center' },
  totalDiscountBtn: { padding: 2, marginRight: Spacing.md },
  totalValue: { color: QuinckleColors.textPrimary, fontSize: 26, fontWeight: '700', letterSpacing: -0.5 },
  paidBadge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: Radius.sm, marginTop: 6, borderWidth: 1 },
  paidBadgeActive: { backgroundColor: QuinckleColors.successSoft, borderColor: QuinckleColors.successBorder },
  paidBadgeInactive: { backgroundColor: QuinckleColors.warningSoft, borderColor: QuinckleColors.warningBorder },
  // Khata (pay later): settled but owed — brand orange, distinct from both
  // green (money in hand) and amber (still to collect at the table).
  paidBadgeKhata: { backgroundColor: QuinckleColors.primarySoft, borderColor: QuinckleColors.primarySoftBorder },
  paidBadgeText: { fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  paidBadgeTextActive: { color: QuinckleColors.success },
  paidBadgeTextInactive: { color: QuinckleColors.warning },
  paidBadgeTextKhata: { color: QuinckleColors.primary },
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
