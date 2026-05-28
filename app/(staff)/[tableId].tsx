import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Animated, FlatList, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, ActivityIndicator, Share } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';
import { ThemedDialog } from '../../components/ui/themed-dialog';
import { crewSessions, crewTables, crewOrders, crewPayments, restaurantApi, printerApi } from '../../services/api';
import type { CrewTable, SessionBill } from '../../services/api';
import { printBill, getStatus as getPrinterStatus } from '../../services/printer';
import type { InvoiceBill } from '../../services/invoiceTemplate';
import { useAuth } from '../../context/AuthContext';
import { subscribeChannel } from '../../services/realtime';
import type { BillOrderItem, BillOrder, MenuItem } from '../../services/api';

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

export default function TableDetail() {
  const insets = useSafeAreaInsets();
  const { tableId, sessionId: paramSessionId, tableDbId } = useLocalSearchParams<{ tableId: string; sessionId: string; tableDbId: string }>();
  const router = useRouter();
  const { staffInfo } = useAuth();

  const tableNum = String(tableId ?? '').padStart(2, '0');

  const [sessionId] = useState(paramSessionId ?? '');
  const [sessionRef, setSessionRef] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [orders, setOrders] = useState<BillOrder[]>([]);
  const [sessionTotal, setSessionTotal] = useState(0);
  const [taxTotal, setTaxTotal] = useState(0);
  const [serviceChargeTotal, setServiceChargeTotal] = useState(0);
  const [discountTotal, setDiscountTotal] = useState(0);
  const [tipTotal, setTipTotal] = useState(0);
  const [payableTotal, setPayableTotal] = useState(0);
  const [sessionStatus, setSessionStatus] = useState<'active' | 'paid' | 'closed'>('active');
  const [since, setSince] = useState('');
  const [isPaid, setIsPaid] = useState(false);
  const [billTaxRate, setBillTaxRate] = useState(0);
  const [billPaymentMethod, setBillPaymentMethod] = useState<SessionBill['payment_method']>(undefined);
  const [billSplits, setBillSplits] = useState<SessionBill['splits']>(undefined);
  const [isExpanded, setIsExpanded] = useState(false);

  // Add items modal
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [isMenuLoading, setIsMenuLoading] = useState(false);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [cartNotes, setCartNotes] = useState<Record<string, string>>({});
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const [menuSearchText, setMenuSearchText] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const [menuCategories, setMenuCategories] = useState<string[]>(['All']);

  // Online payment QR modal state
  const [showQRModal, setShowQRModal] = useState(false);
  const [paymentLinkUrl, setPaymentLinkUrl] = useState('');
  const [paymentLinkAmount, setPaymentLinkAmount] = useState(0);
  const [isGeneratingLink, setIsGeneratingLink] = useState(false);

  // Action menu + swap-table state for the 3-dot header
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [printMenuOpen, setPrintMenuOpen] = useState(false);
  const [swapOpen, setSwapOpen] = useState(false);
  const [swapTargets, setSwapTargets] = useState<CrewTable[]>([]);
  const [swapTargetId, setSwapTargetId] = useState<string | null>(null);
  const [swapSubmitting, setSwapSubmitting] = useState(false);

  const openSwapModal = async () => {
    setActionMenuOpen(false);
    setSwapTargetId(null);
    setSwapOpen(true);
    try {
      const { tables } = await crewTables.list();
      // tableDbId, not the URL `tableId` (which is the display number)
      setSwapTargets(tables.filter(t => t.status === 'available' && t.table_id !== tableDbId));
    } catch {
      setSwapTargets([]);
    }
  };

  const confirmSwap = async () => {
    if (!swapTargetId || !tableDbId) return;
    setSwapSubmitting(true);
    try {
      // Backend expects the DB id, not the table number. The URL's
      // `tableId` is the display number (e.g. "5") — `tableDbId` is the
      // actual Table.id cuid that the swap endpoint needs.
      const res = await crewTables.transferSession(tableDbId, swapTargetId);
      setSwapOpen(false);
      router.replace('/(staff)');
      showDialog(
        'Moved',
        `Guest moved to T${String(res.data.toTableNumber).padStart(2, '0')} — ${res.data.ordersMoved} order${res.data.ordersMoved === 1 ? '' : 's'} relocated.`,
        [{ label: 'OK', onPress: () => {} }]
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
      const disc    = bd?.discount ?? bill.discount_total ?? 0;
      const tipV    = bd?.tip ?? bill.tip_total ?? 0;
      const grand   = bd?.total ?? bill.total_payable ?? (subt + tax + charges + tipV - disc);
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
    } catch {
      // keep current
    } finally {
      setIsLoading(false);
    }
  };

  // Load once on mount; Ably drives all subsequent updates
  useEffect(() => { loadBill(); }, [sessionId]);

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

  // Fetch menu when modal opens
  useEffect(() => {
    if (showOrderModal && menuItems.length === 0 && staffInfo?.restaurantId) {
      setIsMenuLoading(true);
      restaurantApi.getMenu(staffInfo.restaurantId)
        .then(res => {
          const categories: any[] = (res as any)?.data ?? [];
          const items = categories.flatMap((c: any) => {
            const catName = c.name || '';
            const catItems = c.items ?? [];
            return catItems.map((i: any) => ({
              ...i,
              category: i.category || catName,
            }));
          }).filter((i: any) => i.isAvailable !== false);
          setMenuItems(items);
          setMenuCategories(['All', ...categories.map((c: any) => c.name).filter(Boolean)]);
        })
        .catch(() => setMenuItems([]))
        .finally(() => setIsMenuLoading(false));
    }
  }, [showOrderModal]);

  const addToCart = (itemId: string) => setCart(prev => ({ ...prev, [itemId]: (prev[itemId] ?? 0) + 1 }));
  const removeFromCart = (itemId: string) => setCart(prev => {
    const qty = (prev[itemId] ?? 0) - 1;
    if (qty <= 0) { const next = { ...prev }; delete next[itemId]; return next; }
    return { ...prev, [itemId]: qty };
  });
  const cartTotal = Object.entries(cart).reduce((sum, [id, qty]) => {
    const item = menuItems.find(m => m.id === id);
    return sum + (parseFloat(item?.price ?? '0') * qty);
  }, 0);

  const filteredMenuItems = useMemo(() => {
    return menuItems.filter(item => {
      const matchesSearch = item.name.toLowerCase().includes(menuSearchText.toLowerCase());
      const matchesCategory = activeCategory === 'All' || item.category === activeCategory;
      return matchesSearch && matchesCategory;
    });
  }, [menuItems, menuSearchText, activeCategory]);

  const handlePlaceOrder = async () => {
    const items = Object.entries(cart).map(([item_id, qty]) => ({
      item_id,
      qty,
      ...(cartNotes[item_id]?.trim() ? { note: cartNotes[item_id].trim() } : {}),
    }));
    if (items.length === 0 || !sessionId) return;
    setIsPlacingOrder(true);
    try {
      await crewOrders.placeOrder(sessionId, items);
      setCart({});
      setCartNotes({});
      setShowOrderModal(false);
      setMenuSearchText('');
      setActiveCategory('All');
      await loadBill();
    } catch (e: any) {
      // show error in modal — keep it open
    } finally {
      setIsPlacingOrder(false);
    }
  };

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

    const result = await printBill({
      restaurantName: staffInfo?.restaurantName ?? '',
      tableNumber: tableNum,
      sessionRef,
      items: invoiceItems,
      subtotal: sessionTotal,
      tax: taxTotal,
      taxRate: billTaxRate,
      grandTotal,
      isPaid,
      paymentMethod: billPaymentMethod,
      splits: billSplits?.map(s => ({ method: s.method ?? '', amount: Number(s.amount ?? 0) })),
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
      <View style={[styles.container, { paddingTop: insets.top + Spacing.sm, justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color={QuinckleColors.primary} size="large" />
        <Text style={{ color: QuinckleColors.textTertiary, marginTop: Spacing.md }}>Loading table…</Text>
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
            {since ? <Text style={styles.sinceText}>since {since}</Text> : null}
          </View>
        </View>
        <View style={styles.headerRight}>
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

      {!isPaid && (
        <TouchableOpacity
          style={styles.manualOrderBtn}
          onPress={() => setShowOrderModal(true)}
          activeOpacity={0.85}
        >
          <Ionicons name="add" size={18} color="#fff" />
          <Text style={styles.manualOrderText}>Add Items to Order</Text>
        </TouchableOpacity>
      )}

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
        onRefresh={loadBill}
        refreshing={false}
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
            {serviceChargeTotal > 0 && (
              <View style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>Service charge</Text>
                <Text style={styles.summaryValue}>₹{serviceChargeTotal.toFixed(0)}</Text>
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

        {isPaid ? (
          <View style={styles.paidStrip}>
            <Ionicons name="checkmark-circle" size={16} color="#4ade80" />
            {billPaymentMethod === 'mixed' && billSplits ? (() => {
              const cash = billSplits.find(s => s.method === 'CASH');
              const upi  = billSplits.find(s => s.method === 'UPI_DIRECT');
              return (
                <>
                  {cash && (
                    <View style={styles.paidMethodChip}>
                      <Ionicons name="cash-outline" size={13} color="#86efac" />
                      <Text style={styles.paidMethodAmt}>₹{cash.amount}</Text>
                      <Text style={styles.paidMethodTag}>Cash</Text>
                    </View>
                  )}
                  {upi && (
                    <View style={[styles.paidMethodChip, styles.paidMethodChipUpi]}>
                      <Ionicons name="qr-code-outline" size={13} color="#93c5fd" />
                      <Text style={[styles.paidMethodAmt, { color: '#93c5fd' }]}>₹{upi.amount}</Text>
                      <Text style={[styles.paidMethodTag, { color: '#93c5fd' }]}>UPI</Text>
                    </View>
                  )}
                </>
              );
            })() : (
              <View style={[styles.paidMethodChip, billPaymentMethod === 'upi_direct' && styles.paidMethodChipUpi]}>
                <Ionicons
                  name={billPaymentMethod === 'upi_direct' ? 'qr-code-outline' : 'cash-outline'}
                  size={13}
                  color={billPaymentMethod === 'upi_direct' ? '#93c5fd' : '#86efac'}
                />
                <Text style={[styles.paidMethodAmt, billPaymentMethod === 'upi_direct' && { color: '#93c5fd' }]}>
                  ₹{grandTotal.toFixed(0)}
                </Text>
                <Text style={[styles.paidMethodTag, billPaymentMethod === 'upi_direct' && { color: '#93c5fd' }]}>
                  {billPaymentMethod === 'upi_direct' ? 'UPI' : 'Cash'}
                </Text>
              </View>
            )}
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.onlinePayBtn, isGeneratingLink && styles.onlinePayBtnLoading]}
            onPress={handleRequestOnlinePayment}
            activeOpacity={0.85}
            disabled={isGeneratingLink}
          >
            {isGeneratingLink ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="qr-code-outline" size={17} color="#fff" />
            )}
            <Text style={styles.onlinePayBtnText}>
              {isGeneratingLink ? 'Generating…' : 'Send Online Payment Link'}
            </Text>
          </TouchableOpacity>
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
      </View>

      <ThemedDialog visible={dialog.visible} title={dialog.title} message={dialog.message} actions={dialog.actions} onClose={closeDialog} />

      {/* Swap-table modal */}
      <Modal visible={swapOpen} transparent animationType="fade" onRequestClose={() => !swapSubmitting && setSwapOpen(false)}>
        <View style={styles.swapBackdrop}>
          <View style={styles.swapCard}>
            <Text style={styles.swapEyebrow}>Move guest</Text>
            <Text style={styles.swapTitle}>Swap T{tableNum} to another table</Text>
            <Text style={styles.swapSubtitle}>Pick an empty table. The cart, orders, and bill move with them.</Text>

            {swapTargets.length === 0 ? (
              <View style={styles.swapEmpty}>
                <Text style={styles.swapEmptyText}>No available tables right now.</Text>
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 280 }} contentContainerStyle={styles.swapGrid}>
                {swapTargets.map(t => {
                  const active = swapTargetId === t.table_id;
                  return (
                    <TouchableOpacity
                      key={t.table_id}
                      onPress={() => setSwapTargetId(t.table_id)}
                      disabled={swapSubmitting}
                      style={[styles.swapTile, active && styles.swapTileActive]}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.swapTileNum, active && styles.swapTileNumActive]}>T{String(t.table_number).padStart(2, '0')}</Text>
                      <Text style={styles.swapTileSeats}>{t.capacity} seats</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}

            <View style={styles.swapFooter}>
              <TouchableOpacity onPress={() => setSwapOpen(false)} disabled={swapSubmitting} style={styles.swapCancel} activeOpacity={0.7}>
                <Text style={styles.swapCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={confirmSwap}
                disabled={!swapTargetId || swapSubmitting || swapTargets.length === 0}
                style={[styles.swapConfirm, (!swapTargetId || swapSubmitting) && { opacity: 0.4 }]}
                activeOpacity={0.85}
              >
                <Text style={styles.swapConfirmText}>{swapSubmitting ? 'Moving…' : 'Move guest'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

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

      {/* Add Items Modal */}
      <Modal
        visible={showOrderModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => {
          setShowOrderModal(false);
          setCart({});
          setCartNotes({});
          setMenuSearchText('');
          setActiveCategory('All');
        }}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Add Items — T{tableNum}</Text>
            <TouchableOpacity
              onPress={() => {
                setShowOrderModal(false);
                setCart({});
                setCartNotes({});
                setMenuSearchText('');
                setActiveCategory('All');
              }}
              style={styles.iconBtn}
            >
              <Ionicons name="close" size={20} color={QuinckleColors.textPrimary} />
            </TouchableOpacity>
          </View>

          {/* Search bar inside Modal */}
          <View style={styles.modalSearchRow}>
            <View style={styles.modalSearchContainer}>
              <Ionicons name="search" size={15} color={QuinckleColors.textTertiary} />
              <TextInput
                style={styles.modalSearchInput}
                placeholder="Search menu items…"
                placeholderTextColor={QuinckleColors.textTertiary}
                value={menuSearchText}
                onChangeText={setMenuSearchText}
              />
              {menuSearchText.length > 0 && (
                <TouchableOpacity onPress={() => setMenuSearchText('')}>
                  <Ionicons name="close-circle" size={16} color={QuinckleColors.textTertiary} />
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* Category selection horizontal list */}
          <View style={styles.modalChipRowContainer}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.modalChipScroll}
              style={styles.modalChipRow}
            >
              {menuCategories.map((cat) => (
                <TouchableOpacity
                  key={cat}
                  style={[styles.modalChip, activeCategory === cat && styles.modalChipActive]}
                  onPress={() => setActiveCategory(cat)}
                >
                  <Text style={[styles.modalChipText, activeCategory === cat && styles.modalChipTextActive]}>{cat}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 120 }}>
            {isMenuLoading ? (
              <View style={styles.emptyState}>
                <ActivityIndicator color={QuinckleColors.primary} />
                <Text style={styles.emptyText}>Loading menu…</Text>
              </View>
            ) : menuItems.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="restaurant-outline" size={28} color={QuinckleColors.textTertiary} />
                <Text style={styles.emptyText}>No menu items found.</Text>
              </View>
            ) : filteredMenuItems.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="search-outline" size={28} color={QuinckleColors.textTertiary} />
                <Text style={styles.emptyText}>No items match your search.</Text>
              </View>
            ) : filteredMenuItems.map(item => (
              <View key={item.id} style={styles.menuRow}>
                <View style={styles.menuRowTop}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.menuItemName}>{item.name}</Text>
                    <Text style={styles.menuItemPrice}>₹{parseFloat(item.price).toFixed(0)}</Text>
                  </View>
                  <View style={styles.qtyControl}>
                    <TouchableOpacity onPress={() => removeFromCart(item.id)} style={styles.qtyBtn} disabled={!cart[item.id]}>
                      <Ionicons name="remove" size={16} color={cart[item.id] ? QuinckleColors.primary : QuinckleColors.borderStrong} />
                    </TouchableOpacity>
                    <Text style={styles.qtyText}>{cart[item.id] ?? 0}</Text>
                    <TouchableOpacity onPress={() => addToCart(item.id)} style={styles.qtyBtn}>
                      <Ionicons name="add" size={16} color={QuinckleColors.primary} />
                    </TouchableOpacity>
                  </View>
                </View>
                {!!cart[item.id] && (
                  <TextInput
                    style={styles.itemNoteInput}
                    placeholder="Add a note… (e.g. no onions)"
                    placeholderTextColor={QuinckleColors.textTertiary}
                    value={cartNotes[item.id] ?? ''}
                    onChangeText={(text) => setCartNotes(prev => ({ ...prev, [item.id]: text }))}
                    returnKeyType="done"
                  />
                )}
              </View>
            ))}
          </ScrollView>

          <View style={styles.modalFooter}>
            <View style={styles.cartSummary}>
              <Text style={styles.cartLabel}>{Object.values(cart).reduce((a, b) => a + b, 0)} items</Text>
              <Text style={styles.cartTotal}>₹{cartTotal.toFixed(0)}</Text>
            </View>
            <TouchableOpacity
              style={[styles.placeOrderBtn, (Object.keys(cart).length === 0 || isPlacingOrder) && styles.placeOrderBtnDisabled]}
              onPress={handlePlaceOrder}
              disabled={Object.keys(cart).length === 0 || isPlacingOrder}
              activeOpacity={0.85}
            >
              <Text style={styles.placeOrderText}>{isPlacingOrder ? 'Placing Order…' : 'Place Order'}</Text>
            </TouchableOpacity>
          </View>
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
  sectionHeader: { marginBottom: Spacing.md },
  sectionTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.sm },
  sectionTitle: { color: QuinckleColors.textTertiary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 },
  progressText: { color: QuinckleColors.textTertiary, fontSize: 11, fontWeight: '600' },
  serviceProgressTrack: { height: 3, backgroundColor: QuinckleColors.surfaceMutedHover, borderRadius: 2, overflow: 'hidden' },
  serviceProgressFill: { height: '100%', backgroundColor: QuinckleColors.success },
  listContent: { paddingBottom: 220 },
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
});
