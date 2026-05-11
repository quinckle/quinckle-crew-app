import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Animated, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';
import { ThemedDialog } from '../../components/ui/themed-dialog';

type ItemStatus = 'prep' | 'ready' | 'served';
type TableState = 'occupied' | 'reserved' | 'available';

type OrderItem = {
  id: string;
  name: string;
  status: ItemStatus;
  price: number;
  orderedAt: string;
};

const TABLE_ORDER_DATA: Record<string, { tableState: TableState; orders: OrderItem[] }> = {
  '2': {
    tableState: 'occupied',
    orders: [
      { id: '2-1', name: 'Chicken Biryani', status: 'ready', price: 250, orderedAt: '14:15' },
      { id: '2-2', name: 'Garlic Naan', status: 'prep', price: 50, orderedAt: '14:18' },
      { id: '2-3', name: 'Cold Coffee', status: 'ready', price: 120, orderedAt: '14:22' },
      { id: '2-4', name: 'Butter Chicken', status: 'ready', price: 320, orderedAt: '14:25' },
      { id: '2-5', name: 'Dal Makhani', status: 'prep', price: 180, orderedAt: '14:30' },
    ],
  },
  '4': {
    tableState: 'occupied',
    orders: [
      { id: '4-1', name: 'Paneer Tikka', status: 'prep', price: 220, orderedAt: '13:35' },
      { id: '4-2', name: 'Butter Naan', status: 'prep', price: 45, orderedAt: '13:36' },
      { id: '4-3', name: 'Lemon Soda', status: 'ready', price: 90, orderedAt: '13:40' },
    ],
  },
};

const STATUS_META: Record<ItemStatus, { label: string; color: string; bg: string }> = {
  prep: { label: 'Preparing', color: QuinckleColors.warning, bg: QuinckleColors.warningSoft },
  ready: { label: 'Ready', color: QuinckleColors.success, bg: QuinckleColors.successSoft },
  served: { label: 'Served', color: QuinckleColors.textTertiary, bg: 'transparent' },
};

export default function TableDetail() {
  const insets = useSafeAreaInsets();
  const { tableId } = useLocalSearchParams();
  const router = useRouter();
  const normalizedTableId = Array.isArray(tableId) ? tableId[0] : tableId;

  const tableData = useMemo(
    () =>
      TABLE_ORDER_DATA[String(normalizedTableId)] ?? {
        tableState: 'available' as TableState,
        orders: [],
      },
    [normalizedTableId],
  );

  const [orders, setOrders] = useState<OrderItem[]>(tableData.orders);
  const [isPaid, setIsPaid] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [dialog, setDialog] = useState<{
    visible: boolean;
    title: string;
    message: string;
    actions: { label: string; onPress: () => void; variant?: 'default' | 'danger' | 'primary' }[];
  }>({ visible: false, title: '', message: '', actions: [] });

  const closeDialog = () => setDialog((prev) => ({ ...prev, visible: false }));

  const showDialog = (
    title: string,
    message: string,
    actions: { label: string; onPress: () => void; variant?: 'default' | 'danger' | 'primary' }[],
  ) => {
    setDialog({
      visible: true,
      title,
      message,
      actions: actions.map((action) => ({
        ...action,
        onPress: () => { closeDialog(); action.onPress(); },
      })),
    });
  };

  const handleServe = (itemId: string) => {
    setOrders((prev) => prev.map((order) => (order.id === itemId ? { ...order, status: 'served' } : order)));
  };

  const handleUndoServe = (itemId: string) => {
    const item = orders.find((o) => o.id === itemId);
    if (!item) return;
    showDialog('Undo Served', `Mark "${item.name}" back as Ready?`, [
      { label: 'Cancel', onPress: () => {} },
      {
        label: 'Undo',
        variant: 'primary',
        onPress: () => setOrders((prev) => prev.map((o) => (o.id === itemId ? { ...o, status: 'ready' } : o))),
      },
    ]);
  };

  const totalAmount = orders.reduce((sum, item) => sum + item.price, 0);
  const tax = totalAmount * 0.05;
  const grandTotal = totalAmount + tax;

  const servedCount = useMemo(() => orders.filter((o) => o.status === 'served').length, [orders]);
  const totalCount = orders.length;
  const serviceProgress = totalCount > 0 ? servedCount / totalCount : 0;

  const progressAnim = React.useRef(new Animated.Value(serviceProgress)).current;

  React.useEffect(() => {
    Animated.spring(progressAnim, {
      toValue: serviceProgress,
      useNativeDriver: false,
      bounciness: 4,
      speed: 12,
    }).start();
  }, [serviceProgress, progressAnim]);

  const handleEndSession = () => {
    showDialog(
      'End Session',
      `Close Table T${String(normalizedTableId).padStart(2, '0')} and release it for new guests?`,
      [
        { label: 'Cancel', onPress: () => {} },
        { label: 'End Session', variant: 'danger', onPress: () => router.replace('/(staff)') },
      ],
    );
  };

  const handleCollectCash = () => {
    if (isPaid) return;
    showDialog(
      'Collect Payment',
      `Collect ₹${grandTotal.toFixed(0)} cash from Table T${String(normalizedTableId).padStart(2, '0')}?`,
      [
        { label: 'Cancel', onPress: () => {} },
        { label: 'Mark Paid', variant: 'primary', onPress: () => setIsPaid(true) },
      ],
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + Spacing.sm }]}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={20} color={QuinckleColors.textPrimary} />
          </TouchableOpacity>
          <View>
            <Text style={styles.tableTitle}>T{String(normalizedTableId).padStart(2, '0')}</Text>
            <Text style={styles.sinceText}>since 14:15</Text>
          </View>
        </View>

        <TouchableOpacity onPress={handleEndSession} style={styles.iconBtn} activeOpacity={0.7}>
          <Ionicons name="ellipsis-horizontal" size={18} color={QuinckleColors.textPrimary} />
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={styles.manualOrderBtn}
        onPress={() => router.push({ pathname: '/(staff)/menu', params: { tableId: normalizedTableId } })}
        activeOpacity={0.85}
      >
        <Ionicons name="add" size={18} color="#fff" />
        <Text style={styles.manualOrderText}>Add Items to Order</Text>
      </TouchableOpacity>

      <View style={styles.sectionHeader}>
        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionTitle}>Active Orders</Text>
          <Text style={styles.progressText}>{servedCount}/{totalCount} served</Text>
        </View>
        <View style={styles.serviceProgressTrack}>
          <Animated.View
            style={[
              styles.serviceProgressFill,
              {
                width: progressAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['0%', '100%'],
                }),
              },
            ]}
          />
        </View>
      </View>

      <FlatList
        data={orders}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
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
              onPress={() => {
                if (isReady) handleServe(item.id);
                else if (isServed) handleUndoServe(item.id);
              }}
              disabled={item.status === 'prep'}
              activeOpacity={0.7}
            >
              <View style={styles.orderItemLeft}>
                <View
                  style={[
                    styles.checkCircle,
                    isReady && styles.checkCircleReady,
                    isServed && styles.checkCircleServed,
                  ]}
                >
                  {isServed && <Ionicons name="checkmark" size={14} color="#fff" />}
                </View>
                <View>
                  <Text style={[styles.itemName, isServed && styles.itemNameServed]}>
                    {item.name}
                  </Text>
                  <View style={styles.itemMetaRow}>
                    <Text style={styles.itemPrice}>₹{item.price}</Text>
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
              {orders.map((item) => (
                <View key={item.id} style={styles.billItemRow}>
                  <Text style={styles.billItemName}>{item.name}</Text>
                  <Text style={styles.billItemPrice}>₹{item.price}</Text>
                </View>
              ))}
            </View>

            <View style={styles.billDivider} />

            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>Subtotal</Text>
              <Text style={styles.summaryValue}>₹{totalAmount.toFixed(0)}</Text>
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
              <Ionicons
                name={isPaid ? 'checkmark-circle' : 'cash-outline'}
                size={18}
                color="#fff"
              />
              <Text style={styles.payBtnText}>{isPaid ? 'Payment Collected' : 'Collect Cash'}</Text>
            </TouchableOpacity>
          </View>
        )}

        <TouchableOpacity
          style={styles.totalRow}
          activeOpacity={0.85}
          onPress={() => setIsExpanded(!isExpanded)}
        >
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
            <Ionicons
              name={isExpanded ? 'chevron-down' : 'chevron-up'}
              size={18}
              color={QuinckleColors.textTertiary}
              style={{ marginLeft: Spacing.sm }}
            />
          </View>
        </TouchableOpacity>
      </View>

      <ThemedDialog
        visible={dialog.visible}
        title={dialog.title}
        message={dialog.message}
        actions={dialog.actions}
        onClose={closeDialog}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: QuinckleColors.background,
    paddingHorizontal: Spacing.lg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.xl,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    backgroundColor: QuinckleColors.surfaceMuted,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tableTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: QuinckleColors.textPrimary,
    letterSpacing: -0.4,
  },
  sinceText: {
    fontSize: 11,
    color: QuinckleColors.textTertiary,
    fontWeight: '500',
    marginTop: 1,
  },

  manualOrderBtn: {
    backgroundColor: QuinckleColors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: Radius.md,
    gap: Spacing.sm,
    marginBottom: Spacing.xl,
  },
  manualOrderText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },

  sectionHeader: {
    marginBottom: Spacing.md,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  sectionTitle: {
    color: QuinckleColors.textTertiary,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  progressText: {
    color: QuinckleColors.textTertiary,
    fontSize: 11,
    fontWeight: '600',
  },
  serviceProgressTrack: {
    height: 3,
    backgroundColor: QuinckleColors.surfaceMutedHover,
    borderRadius: 2,
    overflow: 'hidden',
  },
  serviceProgressFill: {
    height: '100%',
    backgroundColor: QuinckleColors.success,
  },

  listContent: { paddingBottom: 220 },
  orderItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: QuinckleColors.borderSubtle,
  },
  orderItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    flex: 1,
  },
  checkCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: QuinckleColors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkCircleReady: {
    borderColor: QuinckleColors.primary,
  },
  checkCircleServed: {
    backgroundColor: QuinckleColors.primary,
    borderColor: QuinckleColors.primary,
  },
  itemName: {
    color: QuinckleColors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  itemNameServed: {
    textDecorationLine: 'line-through',
    color: QuinckleColors.textTertiary,
  },
  itemMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 3,
    gap: 6,
  },
  itemPrice: {
    color: QuinckleColors.textTertiary,
    fontSize: 12,
    fontWeight: '500',
  },
  itemDot: {
    color: QuinckleColors.textMuted,
    fontSize: 11,
  },
  itemTime: {
    color: QuinckleColors.textTertiary,
    fontSize: 11,
    fontWeight: '500',
  },
  statusTag: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.sm,
  },
  statusTagText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.huge,
    gap: Spacing.md,
  },
  emptyText: {
    color: QuinckleColors.textTertiary,
    fontSize: 14,
  },

  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xxl,
    paddingTop: Spacing.lg,
    backgroundColor: QuinckleColors.surface,
    borderTopWidth: 1,
    borderTopColor: QuinckleColors.border,
  },
  bottomBarExpanded: {
    borderTopLeftRadius: Radius.xxl,
    borderTopRightRadius: Radius.xxl,
    backgroundColor: QuinckleColors.surface,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabel: {
    color: QuinckleColors.textTertiary,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  totalValueContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  totalValue: {
    color: QuinckleColors.textPrimary,
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  paidBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Radius.sm,
    marginTop: 6,
    borderWidth: 1,
  },
  paidBadgeActive: {
    backgroundColor: QuinckleColors.successSoft,
    borderColor: QuinckleColors.successBorder,
  },
  paidBadgeInactive: {
    backgroundColor: QuinckleColors.warningSoft,
    borderColor: QuinckleColors.warningBorder,
  },
  paidBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  paidBadgeTextActive: {
    color: QuinckleColors.success,
  },
  paidBadgeTextInactive: {
    color: QuinckleColors.warning,
  },

  accordionContent: {
    marginBottom: Spacing.xl,
  },
  billHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.lg,
  },
  billTitle: {
    color: QuinckleColors.textTertiary,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  billItemsContainer: {
    maxHeight: 180,
  },
  billItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  billItemName: {
    color: QuinckleColors.textPrimary,
    fontSize: 14,
    fontWeight: '500',
  },
  billItemPrice: {
    color: QuinckleColors.textSecondary,
    fontSize: 14,
    fontWeight: '500',
  },
  billDivider: {
    height: 1,
    backgroundColor: QuinckleColors.borderSubtle,
    marginVertical: Spacing.md,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  summaryLabel: {
    color: QuinckleColors.textSecondary,
    fontSize: 13,
    fontWeight: '500',
  },
  summaryValue: {
    color: QuinckleColors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  grandTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: Spacing.md,
    marginBottom: Spacing.lg,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: QuinckleColors.border,
  },
  grandTotalLabel: {
    color: QuinckleColors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  grandTotalValue: {
    color: QuinckleColors.primary,
    fontSize: 18,
    fontWeight: '700',
  },

  payBtn: {
    backgroundColor: QuinckleColors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: 14,
    borderRadius: Radius.md,
  },
  payBtnPaid: {
    backgroundColor: QuinckleColors.success,
  },
  payBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
});
