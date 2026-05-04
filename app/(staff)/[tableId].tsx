// app/(staff)/[tableId].tsx
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { QuinckleColors } from '../../constants/Colors';

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

export default function TableDetail() {
  const { tableId } = useLocalSearchParams();
  const router = useRouter();
  const normalizedTableId = Array.isArray(tableId) ? tableId[0] : tableId;
  const tableData = useMemo(
    () => TABLE_ORDER_DATA[String(normalizedTableId)] ?? { tableState: 'available' as TableState, orders: [] },
    [normalizedTableId],
  );
  const [orders, setOrders] = useState<OrderItem[]>(tableData.orders);

  const handleServe = (id: string) => {
    setOrders(prev => prev.map(item => 
      item.id === id ? { ...item, status: 'served' } : item
    ));
  };
  const totalAmount = orders.reduce((sum, item) => sum + item.price, 0);

  const getStatusColor = (status: ItemStatus) => {
    if (status === 'prepared') return QuinckleColors.success;
    if (status === 'preparing') return QuinckleColors.warning;
    if (status === 'queued') return QuinckleColors.primary;
    return QuinckleColors.info;
  };

  const subtitleText =
    tableData.tableState === 'reserved'
      ? 'Reserved table pre-orders'
      : tableData.tableState === 'occupied'
        ? 'Live order status'
        : 'No active orders for this table';

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
        <Ionicons name="chevron-back" size={18} color={QuinckleColors.primary} />
        <Text style={styles.backText}>Back to Floor</Text>
      </TouchableOpacity>

      <View style={styles.titleRow}>
        <View>
          <Text style={styles.title}>Table {normalizedTableId}</Text>
          <Text style={styles.subtitle}>{subtitleText}</Text>
        </View>
        <View style={styles.billPill}>
          <Ionicons name="cash-outline" size={16} color={QuinckleColors.primary} />
          <Text style={styles.billText}>Rs {totalAmount}</Text>
        </View>
      </View>

      <FlatList
        data={orders}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={<Text style={styles.emptyText}>No items ordered yet.</Text>}
        renderItem={({ item }) => (
          <View style={styles.orderItem}>
            <View>
              <Text style={styles.itemName}>{item.name}</Text>
              <Text style={styles.itemPrice}>Rs {item.price}</Text>
              <Text style={[
                styles.statusText, 
                { color: getStatusColor(item.status) }
              ]}>
                {item.status.toUpperCase()}
              </Text>
            </View>

            {item.status === 'prepared' && (
              <TouchableOpacity 
                style={styles.serveBtn} 
                onPress={() => handleServe(item.id)}
              >
                <Text style={styles.serveBtnText}>SERVE</Text>
              </TouchableOpacity>
            )}

            {item.status === 'served' && (
              <View style={styles.checkIcon}>
                <Ionicons name="checkmark-circle" size={22} color={QuinckleColors.success} />
              </View>
            )}
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, backgroundColor: QuinckleColors.background, paddingTop: 56 },
  backBtn: { marginBottom: 16, flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start' },
  backText: { color: QuinckleColors.primary, fontSize: 15, fontWeight: '600' },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 30, fontWeight: '700', color: QuinckleColors.textPrimary },
  subtitle: { fontSize: 16, color: QuinckleColors.textSecondary },
  billPill: {
    backgroundColor: QuinckleColors.surface,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  billText: { color: QuinckleColors.textPrimary, fontWeight: '600', fontSize: 13 },
  listContent: { paddingBottom: 20 },
  orderItem: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    padding: 20, 
    backgroundColor: QuinckleColors.surface,
    borderRadius: 12, 
    marginBottom: 12,
    borderWidth: 1,
    borderColor: QuinckleColors.border
  },
  itemName: { fontSize: 18, fontWeight: '500', color: QuinckleColors.textPrimary },
  itemPrice: { marginTop: 4, color: QuinckleColors.textSecondary, fontSize: 13 },
  statusText: { fontSize: 12, fontWeight: 'bold', marginTop: 4 },
  serveBtn: { backgroundColor: QuinckleColors.primary, paddingVertical: 8, paddingHorizontal: 15, borderRadius: 8 },
  serveBtnText: { color: QuinckleColors.textPrimary, fontWeight: 'bold' },
  checkIcon: { padding: 8 },
  emptyText: { color: QuinckleColors.textSecondary, textAlign: 'center', paddingVertical: 30 },
});