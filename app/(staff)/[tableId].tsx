// app/(staff)/[tableId].tsx
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View, ScrollView, Modal, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { QuinckleColors } from '../../constants/Colors';
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
    tableState: 'reserved',
    orders: [
      { id: '4-1', name: 'Paneer Tikka', status: 'queued', price: 220 },
      { id: '4-2', name: 'Butter Naan', status: 'queued', price: 45 },
      { id: '4-3', name: 'Lemon Soda', status: 'preparing', price: 90 },
    ],
  },
};

const STATUS_META: Record<ItemStatus, { label: string; color: string }> = {
  prep: { label: 'Prep', color: QuinckleColors.warning },
  ready: { label: 'Ready', color: QuinckleColors.success },
  served: { label: 'Served', color: QuinckleColors.info },
};

export default function TableDetail() {
  const insets = useSafeAreaInsets();
  const { tableId } = useLocalSearchParams();
  const router = useRouter();
  const [timeLeft, setTimeLeft] = useState(45); // 45 minutes mock
  const totalTime = 60;
  const progress = timeLeft / totalTime;
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
    actions: Array<{ label: string; onPress: () => void; variant?: 'default' | 'danger' }>;
  }>({ visible: false, title: '', message: '', actions: [] });

  const closeDialog = () => setDialog((prev) => ({ ...prev, visible: false }));

  const showDialog = (
    title: string,
    message: string,
    actions: Array<{ label: string; onPress: () => void; variant?: 'default' | 'danger' }>,
  ) => {
    setDialog({
      visible: true,
      title,
      message,
      actions: actions.map((action) => ({
        ...action,
        onPress: () => {
          closeDialog();
          action.onPress();
        },
      })),
    });
  };

  const handleServe = (itemId: string) => {
    setOrders((prev) =>
      prev.map((order) => (order.id === itemId ? { ...order, status: 'served' } : order)),
    );
  };

  const handleUndoServe = (itemId: string) => {
    const item = orders.find(o => o.id === itemId);
    if (!item) return;

    showDialog(
      'Undo Served',
      `Mark "${item.name}" back as Ready?`,
      [
        { label: 'Cancel', onPress: () => {} },
        { 
          label: 'Yes, Undo', 
          onPress: () => {
            setOrders(prev => prev.map(o => o.id === itemId ? { ...o, status: 'ready' } : o));
          }
        },
      ]
    );
  };

  const totalAmount = orders.reduce((sum, item) => sum + item.price, 0);

  const servedCount = useMemo(() => orders.filter(o => o.status === 'served').length, [orders]);
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
  }, [serviceProgress]);

  const handleCollectCash = () => {
    if (isPaid) return;
    showDialog(
      'Collect Cash Payment',
      `Collect Rs ${totalAmount} cash from Table ${normalizedTableId}?\n\nThis will mark the bill as paid.`,
      [
        { label: 'Cancel', onPress: () => {} },
        { label: 'Mark Collected', onPress: () => setIsPaid(true) },
      ],
    );
  };

  const handleEndSession = () => {
    showDialog(
      'End Session',
      `Close Table ${normalizedTableId} and release it for new guests?`,
      [
        { label: 'Cancel', onPress: () => {} },
        {
          label: 'End Session',
          variant: 'danger',
          onPress: () => router.replace('/(staff)'),
        },
      ],
    );
  };

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backCircle}>
            <Ionicons name="chevron-back" size={20} color={QuinckleColors.textPrimary} />
          </TouchableOpacity>
          <View>
            <Text style={styles.tableTitle}>T{String(normalizedTableId).padStart(2, '0')}</Text>
            <Text style={styles.sinceText}>since 14:15</Text>
          </View>
        </View>

        <View style={styles.headerRight}>
          <View style={styles.countdownBox}>
            <Text style={styles.timeLabel}>{timeLeft}m left</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
            </View>
          </View>
          
          <TouchableOpacity style={styles.moreBtn}>
            <Ionicons name="ellipsis-vertical" size={20} color="rgba(255,255,255,0.4)" />
          </TouchableOpacity>
        </View>
      </View>

      <TouchableOpacity 
        style={styles.manualOrderBtn}
        onPress={() => router.push({
          pathname: '/(staff)/menu',
          params: { tableId: normalizedTableId }
        })}
      >
        <Ionicons name="add-circle" size={18} color="#fff" />
        <Text style={styles.manualOrderText}>Manual Order Taking</Text>
      </TouchableOpacity>

      <View style={styles.sectionHeader}>
        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionTitle}>Active Orders</Text>
          <Text style={styles.progressText}>{servedCount}/{totalCount} Served</Text>
        </View>
        <View style={styles.serviceProgressTrack}>
          <Animated.View 
            style={[
              styles.serviceProgressFill, 
              { 
                width: progressAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['0%', '100%'],
                }) 
              }
            ]} 
          />
        </View>
      </View>

      <FlatList
        data={orders}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<Text style={styles.emptyText}>No items ordered yet.</Text>}
        renderItem={({ item }) => {
          const isServed = item.status === 'served';
          const isReady = item.status === 'ready';
          
          return (
            <TouchableOpacity 
              style={[styles.orderItemRow, isServed && { opacity: 0.5 }]}
              onPress={() => {
                if (isReady) handleServe(item.id);
                else if (isServed) handleUndoServe(item.id);
              }}
              disabled={item.status === 'prep'}
              activeOpacity={0.7}
            >
              <View style={styles.orderItemLeft}>
                <View style={[
                  styles.checkCircle, 
                  isReady && styles.checkCircleReady,
                  isServed && styles.checkCircleServed
                ]}>
                  {isServed && (
                    <Ionicons name="checkmark" size={16} color="#fff" />
                  )}
                </View>
                <View>
                  <Text style={[
                    styles.itemName, 
                    isServed && { textDecorationLine: 'line-through', color: 'rgba(255,255,255,0.3)' }
                  ]}>
                    {item.name}
                  </Text>
                  <View style={styles.itemMetaRow}>
                    <Text style={styles.itemPrice}>₹{item.price}</Text>
                    <Text style={styles.itemDot}>•</Text>
                    <Text style={styles.orderedAtText}>{item.orderedAt}</Text>
                  </View>
                </View>
              </View>

              <View style={[
                styles.statusTag, 
                { backgroundColor: isServed ? 'transparent' : (isReady ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)') }
              ]}>
                <Text style={[
                  styles.statusTagText, 
                  { color: isServed ? 'rgba(255,255,255,0.2)' : (isReady ? '#22c55e' : '#f59e0b') }
                ]}>
                  {isServed ? 'Served' : (item.status === 'prep' ? 'Preparing' : 'Ready')}
                </Text>
              </View>
            </TouchableOpacity>
          );
        }}
      />

      {/* Integrated Bill Accordion */}
      <View style={[styles.bottomBar, isExpanded && styles.bottomBarExpanded]}>
        {isExpanded && (
          <View style={styles.accordionContent}>
            <View style={styles.billHeader}>
              <Text style={styles.billTitle}>Bill Details</Text>
              <TouchableOpacity onPress={() => setIsExpanded(false)}>
                <Ionicons name="chevron-down" size={20} color="rgba(255,255,255,0.4)" />
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
              <Text style={styles.summaryValue}>₹{totalAmount}</Text>
            </View>
            <View style={styles.summaryRow}>
              <Text style={styles.summaryLabel}>GST (5%)</Text>
              <Text style={styles.summaryValue}>₹{(totalAmount * 0.05).toFixed(2)}</Text>
            </View>
            
            <View style={[styles.summaryRow, { marginTop: 12, marginBottom: 20 }]}>
              <Text style={styles.grandTotalLabel}>Grand Total</Text>
              <Text style={styles.grandTotalValue}>₹{(totalAmount * 1.05).toFixed(2)}</Text>
            </View>
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
                {isPaid ? 'PAYMENT SETTLED' : 'PAYMENT PENDING'}
              </Text>
            </View>
          </View>
          <View style={styles.totalValueContainer}>
            <Text style={styles.totalValue}>₹{(totalAmount * 1.05).toFixed(0)}</Text>
            <Ionicons 
              name={isExpanded ? "chevron-down" : "chevron-up"} 
              size={18} 
              color={QuinckleColors.primary} 
              style={{ marginLeft: 8 }}
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
    paddingHorizontal: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  tableTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: QuinckleColors.textPrimary,
    letterSpacing: -0.5,
  },
  sinceText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.4)',
    fontWeight: '600',
    marginTop: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  moreBtn: {
    padding: 4,
    marginRight: -4,
  },
  countdownBox: {
    alignItems: 'flex-end',
    gap: 6,
  },
  timeLabel: {
    fontSize: 13,
    color: QuinckleColors.primary,
    fontWeight: '700',
  },
  progressTrack: {
    width: 80,
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: QuinckleColors.primary,
    borderRadius: 2,
  },
  listContent: { paddingBottom: 160 },
  manualOrderBtn: {
    backgroundColor: QuinckleColors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    gap: 8,
    marginBottom: 24,
    shadowColor: QuinckleColors.primary,
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  manualOrderText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  sectionHeader: {
    marginBottom: 20,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionTitle: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  progressText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 11,
    fontWeight: '700',
  },
  serviceProgressTrack: {
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  serviceProgressFill: {
    height: '100%',
    backgroundColor: '#22c55e',
    borderRadius: 2,
  },
  orderItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  orderItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.1)',
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
    fontSize: 16,
    fontWeight: '600',
  },
  itemPrice: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 13,
    fontWeight: '500',
  },
  itemMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  itemDot: {
    color: 'rgba(255,255,255,0.2)',
    marginHorizontal: 6,
    fontSize: 10,
  },
  orderedAtText: {
    color: 'rgba(255,255,255,0.25)',
    fontSize: 11,
    fontWeight: '600',
  },
  statusTag: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusTagText: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 24,
    paddingBottom: 40,
    paddingTop: 20,
    backgroundColor: '#0A0A0A',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  bottomBarExpanded: {
    paddingTop: 24,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    backgroundColor: '#111',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabel: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 14,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  totalValueContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  totalValue: {
    color: QuinckleColors.textPrimary,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  paidBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    marginTop: 4,
    borderWidth: 1,
  },
  paidBadgeActive: {
    backgroundColor: 'rgba(59,130,246,0.1)',
    borderColor: 'rgba(59,130,246,0.3)',
  },
  paidBadgeInactive: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderColor: 'rgba(255,255,255,0.08)',
  },
  paidBadgeText: {
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  paidBadgeTextActive: {
    color: '#3B82F6',
  },
  paidBadgeTextInactive: {
    color: 'rgba(255,255,255,0.2)',
  },
  accordionContent: {
    marginBottom: 24,
  },
  billHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  billTitle: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  billItemsContainer: {
    maxHeight: 180,
  },
  billItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  billItemName: {
    color: QuinckleColors.textPrimary,
    fontSize: 15,
    fontWeight: '500',
  },
  billItemPrice: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 15,
    fontWeight: '600',
  },
  billDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginVertical: 16,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  summaryLabel: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 14,
    fontWeight: '500',
  },
  summaryValue: {
    color: QuinckleColors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  grandTotalLabel: {
    color: QuinckleColors.textPrimary,
    fontSize: 18,
    fontWeight: '800',
  },
  grandTotalValue: {
    color: QuinckleColors.primary,
    fontSize: 20,
    fontWeight: '800',
  },
});
