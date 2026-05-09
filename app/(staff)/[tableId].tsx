// app/(staff)/[tableId].tsx
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { QuinckleColors } from '../../constants/Colors';
import { ThemedDialog } from '../../components/ui/themed-dialog';

type ItemStatus = 'queued' | 'preparing' | 'prepared' | 'served';
type TableState = 'occupied' | 'reserved' | 'available';

type OrderItem = {
  id: string;
  name: string;
  status: ItemStatus;
  price: number;
};

const TABLE_ORDER_DATA: Record<string, { tableState: TableState; orders: OrderItem[] }> = {
  '2': {
    tableState: 'occupied',
    orders: [
      { id: '2-1', name: 'Chicken Biryani', status: 'prepared', price: 250 },
      { id: '2-2', name: 'Garlic Naan', status: 'preparing', price: 50 },
      { id: '2-3', name: 'Cold Coffee', status: 'served', price: 120 },
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
  queued: { label: 'Queued', color: QuinckleColors.primary },
  preparing: { label: 'Preparing', color: QuinckleColors.warning },
  prepared: { label: 'Ready', color: QuinckleColors.success },
  served: { label: 'Served', color: QuinckleColors.info },
};

export default function TableDetail() {
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

  const handleServe = (id: string) => {
    setOrders((prev) =>
      prev.map((item) => (item.id === id ? { ...item, status: 'served' } : item)),
    );
  };

  const totalAmount = orders.reduce((sum, item) => sum + item.price, 0);

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

  const subtitleText =
    tableData.tableState === 'reserved'
      ? 'Reserved — pre-orders'
      : tableData.tableState === 'occupied'
        ? 'Live order status'
        : 'No active orders';

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
        <Ionicons name="chevron-back" size={18} color={QuinckleColors.primary} />
        <Text style={styles.backText}>Floor</Text>
      </TouchableOpacity>

      <View style={styles.titleRow}>
        <View>
          <Text style={styles.title}>Table {normalizedTableId}</Text>
          <Text style={styles.subtitle}>{subtitleText}</Text>
        </View>
        <View style={[styles.billPill, isPaid && styles.billPillPaid]}>
          <Ionicons
            name={isPaid ? 'checkmark-circle' : 'cash-outline'}
            size={15}
            color={isPaid ? QuinckleColors.success : QuinckleColors.primary}
          />
          <Text style={[styles.billAmount, isPaid && styles.billAmountPaid]}>
            {isPaid ? 'Paid' : `Rs ${totalAmount}`}
          </Text>
        </View>
      </View>

      <FlatList
        data={orders}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<Text style={styles.emptyText}>No items ordered yet.</Text>}
        renderItem={({ item }) => {
          const meta = STATUS_META[item.status];
          return (
            <View style={styles.orderCard}>
              <View style={styles.orderInfo}>
                <Text style={styles.itemName}>{item.name}</Text>
                <Text style={styles.itemPrice}>Rs {item.price}</Text>
              </View>
              <View style={styles.orderRight}>
                <View style={[styles.statusPill, { backgroundColor: `${meta.color}18` }]}>
                  <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
                </View>
                {item.status === 'prepared' && (
                  <TouchableOpacity style={styles.serveBtn} onPress={() => handleServe(item.id)}>
                    <Text style={styles.serveBtnText}>SERVE</Text>
                  </TouchableOpacity>
                )}
                {item.status === 'served' && (
                  <Ionicons name="checkmark-circle" size={22} color={QuinckleColors.success} />
                )}
              </View>
            </View>
          );
        }}
      />

      {/* Bottom action bar */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={[styles.bottomBtn, isPaid ? styles.bottomBtnPaid : styles.bottomBtnCash]}
          onPress={handleCollectCash}
          disabled={isPaid}
          activeOpacity={0.82}
        >
          <Ionicons
            name={isPaid ? 'checkmark-circle' : 'cash-outline'}
            size={16}
            color={isPaid ? QuinckleColors.success : '#fff'}
          />
          <Text style={[styles.bottomBtnLabel, isPaid && styles.bottomBtnLabelPaid]}>
            {isPaid ? 'Cash Collected' : 'Collect Cash'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.bottomBtn, styles.bottomBtnEnd]}
          onPress={handleEndSession}
          activeOpacity={0.82}
        >
          <Ionicons name="log-out-outline" size={16} color={QuinckleColors.danger} />
          <Text style={[styles.bottomBtnLabel, styles.bottomBtnLabelEnd]}>End Session</Text>
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
    paddingTop: 56,
    paddingHorizontal: 16,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    alignSelf: 'flex-start',
    marginBottom: 14,
  },
  backText: { color: QuinckleColors.primary, fontSize: 14, fontWeight: '600' },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 30,
    fontWeight: '700',
    color: QuinckleColors.textPrimary,
    letterSpacing: -0.5,
  },
  subtitle: { fontSize: 13, color: QuinckleColors.textSecondary, marginTop: 2 },
  billPill: {
    backgroundColor: 'rgba(243,93,59,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(243,93,59,0.28)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  billPillPaid: {
    backgroundColor: 'rgba(16,185,129,0.10)',
    borderColor: 'rgba(16,185,129,0.30)',
  },
  billAmount: { color: QuinckleColors.primary, fontWeight: '700', fontSize: 13 },
  billAmountPaid: { color: QuinckleColors.success },
  listContent: { paddingBottom: 108 },
  orderCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
  },
  orderInfo: { flex: 1, gap: 4 },
  itemName: { fontSize: 16, fontWeight: '500', color: QuinckleColors.textPrimary },
  itemPrice: { fontSize: 13, color: QuinckleColors.textSecondary },
  orderRight: { alignItems: 'flex-end', gap: 8 },
  statusPill: { borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 },
  statusText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.2 },
  serveBtn: {
    backgroundColor: QuinckleColors.primary,
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  serveBtnText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  emptyText: { color: QuinckleColors.textSecondary, textAlign: 'center', paddingVertical: 30 },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 30,
    paddingTop: 12,
    backgroundColor: `${QuinckleColors.background}F2`,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.07)',
  },
  bottomBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 13,
    borderRadius: 14,
    borderWidth: 1,
  },
  bottomBtnCash: {
    backgroundColor: QuinckleColors.primary,
    borderColor: QuinckleColors.primary,
    elevation: 4,
    shadowColor: QuinckleColors.primary,
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
  },
  bottomBtnPaid: {
    backgroundColor: 'rgba(16,185,129,0.10)',
    borderColor: 'rgba(16,185,129,0.30)',
  },
  bottomBtnEnd: {
    backgroundColor: 'rgba(239,68,68,0.08)',
    borderColor: 'rgba(239,68,68,0.28)',
  },
  bottomBtnLabel: { color: '#fff', fontWeight: '700', fontSize: 13 },
  bottomBtnLabelPaid: { color: QuinckleColors.success },
  bottomBtnLabelEnd: { color: QuinckleColors.danger },
});
