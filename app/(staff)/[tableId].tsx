// app/(staff)/[tableId].tsx
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { QuinckleColors } from '../../constants/Colors';

const MOCK_ORDERS = [
  { id: '1', name: 'Chicken Biryani', status: 'prepared', price: 250 },
  { id: '2', name: 'Garlic Naan', status: 'preparing', price: 50 },
  { id: '3', name: 'Cold Coffee', status: 'served', price: 120 },
];

export default function TableDetail() {
  const { tableId } = useLocalSearchParams();
  const router = useRouter();
  const [orders, setOrders] = useState(MOCK_ORDERS);

  const handleServe = (id: string) => {
    setOrders(prev => prev.map(item => 
      item.id === id ? { ...item, status: 'served' } : item
    ));
  };
  const totalAmount = orders.reduce((sum, item) => sum + item.price, 0);

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
        <Ionicons name="chevron-back" size={18} color={QuinckleColors.primary} />
        <Text style={styles.backText}>Back to Floor</Text>
      </TouchableOpacity>

      <View style={styles.titleRow}>
        <View>
          <Text style={styles.title}>Table {tableId}</Text>
          <Text style={styles.subtitle}>Live order status</Text>
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
        renderItem={({ item }) => (
          <View style={styles.orderItem}>
            <View>
              <Text style={styles.itemName}>{item.name}</Text>
              <Text style={styles.itemPrice}>Rs {item.price}</Text>
              <Text style={[
                styles.statusText, 
                {
                  color:
                    item.status === 'prepared'
                      ? QuinckleColors.success
                      : item.status === 'preparing'
                        ? QuinckleColors.warning
                        : QuinckleColors.info,
                }
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
  checkIcon: { padding: 8 }
});