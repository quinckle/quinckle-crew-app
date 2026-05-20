import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Animated, FlatList, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';
import { ThemedDialog } from '../../components/ui/themed-dialog';
import { crewSessions, crewOrders, crewPayments, restaurantApi } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import type { BillOrderItem, BillOrder, MenuItem } from '../../services/api';

type ItemStatus = 'prep' | 'ready' | 'served';

type FlatItem = {
  key: string;
  item_id: string;
  order_id: string;
  name: string;
  status: ItemStatus;
  price: number;
  orderedAt: string;
  qty: number;
};

const STATUS_META: Record<ItemStatus, { label: string; color: string; bg: string }> = {
  prep:   { label: 'Preparing', color: QuinckleColors.warning,      bg: QuinckleColors.warningSoft },
  ready:  { label: 'Ready',     color: QuinckleColors.success,      bg: QuinckleColors.successSoft },
  served: { label: 'Served',    color: QuinckleColors.textTertiary, bg: 'transparent' },
};

function itemStatus(item: BillOrderItem, orderStatus: BillOrder['status']): ItemStatus {
  if (item.served) return 'served';
  if (orderStatus === 'ready' || item.item_status === 'done') return 'ready';
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
  const [isLoading, setIsLoading] = useState(true);
  const [orders, setOrders] = useState<BillOrder[]>([]);
  const [sessionTotal, setSessionTotal] = useState(0);
  const [sessionStatus, setSessionStatus] = useState<'active' | 'paid' | 'closed'>('active');
  const [since, setSince] = useState('');
  const [isPaid, setIsPaid] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  // Add items modal
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [isMenuLoading, setIsMenuLoading] = useState(false);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);

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
      setOrders(bill.orders);
      setSessionTotal(bill.session_total);
      setSessionStatus(bill.status);
      setIsPaid(bill.status === 'paid');
    } catch {
      // keep current
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadBill();
    const interval = setInterval(loadBill, 5000);
    return () => clearInterval(interval);
  }, [sessionId]);

  // Fetch menu when modal opens
  useEffect(() => {
    if (showOrderModal && menuItems.length === 0 && staffInfo?.restaurantId) {
      setIsMenuLoading(true);
      restaurantApi.getMenu(staffInfo.restaurantId)
        .then(res => {
          const items = (res.data?.menuItems ?? []).filter((i: any) => i.isAvailable !== false);
          setMenuItems(items);
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

  const handlePlaceOrder = async () => {
    const items = Object.entries(cart).map(([item_id, qty]) => ({ item_id, qty }));
    if (items.length === 0 || !sessionId) return;
    setIsPlacingOrder(true);
    try {
      await crewOrders.placeOrder(sessionId, items);
      setCart({});
      setShowOrderModal(false);
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
        status: itemStatus(item, order.status),
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

  const tax = sessionTotal * 0.05;
  const grandTotal = sessionTotal + tax;

  const handleServe = async (item: FlatItem) => {
    if (item.status !== 'ready') return;
    // Optimistic update
    setOrders(prev => prev.map(o => {
      if (o.order_id !== item.order_id) return o;
      return { ...o, items: o.items.map(i => i.item_id === item.item_id ? { ...i, served: true } : i) };
    }));
    try {
      await crewOrders.serveItem(item.order_id, item.item_id);
      await loadBill();
    } catch { await loadBill(); }
  };

  const handleCollectCash = () => {
    if (isPaid || !staffInfo?.id) return;
    showDialog(
      'Collect Payment',
      `Collect ₹${grandTotal.toFixed(0)} cash from Table T${tableNum}?`,
      [
        { label: 'Cancel', onPress: () => {} },
        {
          label: 'Mark Paid',
          variant: 'primary',
          onPress: async () => {
            try {
              await crewPayments.cashConfirm(sessionId, staffInfo.id, Math.round(grandTotal));
              setIsPaid(true);
              setSessionStatus('paid');
            } catch { /* already collected maybe */ setIsPaid(true); }
          },
        },
      ],
    );
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
            } catch { /* ignore */ }
            router.replace('/(staff)');
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
            {since ? <Text style={styles.sinceText}>since {since}</Text> : null}
          </View>
        </View>
        <TouchableOpacity onPress={handleEndSession} style={styles.iconBtn} activeOpacity={0.7}>
          <Ionicons name="ellipsis-horizontal" size={18} color={QuinckleColors.textPrimary} />
        </TouchableOpacity>
      </View>

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
          const isReady = item.status === 'ready';
          const meta = STATUS_META[item.status];
          return (
            <TouchableOpacity
              style={[styles.orderItemRow, isServed && { opacity: 0.55 }]}
              onPress={() => { if (isReady) void handleServe(item); }}
              disabled={item.status === 'prep'}
              activeOpacity={0.7}
            >
              <View style={styles.orderItemLeft}>
                <View style={[styles.checkCircle, isReady && styles.checkCircleReady, isServed && styles.checkCircleServed]}>
                  {isServed && <Ionicons name="checkmark" size={14} color="#fff" />}
                </View>
                <View>
                  <Text style={[styles.itemName, isServed && styles.itemNameServed]}>{item.name}</Text>
                  <View style={styles.itemMetaRow}>
                    <Text style={styles.itemPrice}>₹{item.price.toFixed(0)}</Text>
                    <Text style={styles.itemDot}>·</Text>
                    <Text style={styles.itemTime}>{item.orderedAt}</Text>
                  </View>
                </View>
              </View>
              <View style={[styles.statusTag, { backgroundColor: meta.bg }]}>
                <Text style={[styles.statusTagText, { color: meta.color }]}>{meta.label}</Text>
              </View>
            </TouchableOpacity>
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
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>GST (5%)</Text>
              <Text style={styles.summaryValue}>₹{tax.toFixed(2)}</Text>
            </View>
            <View style={styles.grandTotalRow}>
              <Text style={styles.grandTotalLabel}>Grand Total</Text>
              <Text style={styles.grandTotalValue}>₹{grandTotal.toFixed(2)}</Text>
            </View>

            <TouchableOpacity
              style={[styles.payBtn, isPaid && styles.payBtnPaid]}
              onPress={handleCollectCash}
              activeOpacity={0.85}
              disabled={isPaid}
            >
              <Ionicons name={isPaid ? 'checkmark-circle' : 'cash-outline'} size={18} color="#fff" />
              <Text style={styles.payBtnText}>{isPaid ? 'Payment Collected' : 'Collect Cash'}</Text>
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity style={styles.totalRow} activeOpacity={0.85} onPress={() => setIsExpanded(!isExpanded)}>
          <View>
            <Text style={styles.totalLabel}>Total Payable</Text>
            <View style={[styles.paidBadge, isPaid ? styles.paidBadgeActive : styles.paidBadgeInactive]}>
              <Text style={[styles.paidBadgeText, isPaid ? styles.paidBadgeTextActive : styles.paidBadgeTextInactive]}>
                {isPaid ? 'Settled' : 'Pending'}
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

      {/* Add Items Modal */}
      <Modal visible={showOrderModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowOrderModal(false)}>
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Add Items — T{tableNum}</Text>
            <TouchableOpacity onPress={() => { setShowOrderModal(false); setCart({}); }} style={styles.iconBtn}>
              <Ionicons name="close" size={20} color={QuinckleColors.textPrimary} />
            </TouchableOpacity>
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
            ) : menuItems.map(item => (
              <View key={item.id} style={styles.menuRow}>
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
  container: { flex: 1, backgroundColor: QuinckleColors.background, paddingHorizontal: Spacing.lg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.xl },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  iconBtn: { width: 40, height: 40, borderRadius: Radius.md, backgroundColor: QuinckleColors.surfaceMuted, borderWidth: 1, borderColor: QuinckleColors.border, alignItems: 'center', justifyContent: 'center' },
  tableTitle: { fontSize: 22, fontWeight: '700', color: QuinckleColors.textPrimary, letterSpacing: -0.4 },
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
  itemMetaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 3, gap: 6 },
  itemPrice: { color: QuinckleColors.textTertiary, fontSize: 12, fontWeight: '500' },
  itemDot: { color: QuinckleColors.textMuted, fontSize: 11 },
  itemTime: { color: QuinckleColors.textTertiary, fontSize: 11, fontWeight: '500' },
  statusTag: { paddingHorizontal: Spacing.sm, paddingVertical: 4, borderRadius: Radius.sm },
  statusTagText: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
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
  menuRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: QuinckleColors.borderSubtle },
  menuItemName: { color: QuinckleColors.textPrimary, fontSize: 15, fontWeight: '500' },
  menuItemPrice: { color: QuinckleColors.textSecondary, fontSize: 13, marginTop: 2 },
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
});
