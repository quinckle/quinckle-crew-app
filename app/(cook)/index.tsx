// app/(cook)/index.tsx
import React, { useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { QuinckleColors } from '../../constants/Colors';
import { useAuth } from '../../context/AuthContext';

// Mock data representing a global queue of orders
const INITIAL_KITCHEN_ORDERS = [
  { id: '101', table: '3', item: 'Margherita Pizza', status: 'pending' },
  { id: '102', table: '1', item: 'Chicken Alfredo', status: 'preparing' },
  { id: '103', table: '5', item: 'Iced Latte', status: 'pending' },
];

export default function CookDashboard() {
  const { logout } = useAuth();
  const [orders, setOrders] = useState(INITIAL_KITCHEN_ORDERS);

  const updateStatus = (id: string) => {
    setOrders(prev => prev.map(order => {
      if (order.id === id) {
        if (order.status === 'pending') return { ...order, status: 'preparing' };
        if (order.status === 'preparing') return { ...order, status: 'prepared' };
      }
      return order;
    }));
  };

  const getStatusStyle = (status: string) => {
    switch (status) {
      case 'pending': return { bg: QuinckleColors.warning, text: QuinckleColors.textPrimary, label: 'START' };
      case 'preparing': return { bg: QuinckleColors.primary, text: QuinckleColors.textPrimary, label: 'FINISH' };
      case 'prepared': return { bg: QuinckleColors.success, text: QuinckleColors.textPrimary, label: 'DONE' };
      default: return { bg: QuinckleColors.surfaceHover, text: QuinckleColors.textPrimary, label: '' };
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.header}>Kitchen Queue</Text>
          <Text style={styles.subtitle}>{orders.length} Active Tickets</Text>
        </View>
        <TouchableOpacity onPress={logout} style={styles.logoutBtn}>
          <Ionicons name="log-out-outline" size={18} color={QuinckleColors.danger} />
          <Text style={styles.logoutText}>Exit</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={orders}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const style = getStatusStyle(item.status);
          return (
            <View style={styles.ticket}>
              <View style={styles.ticketLeft}>
                <Text style={styles.tableLabel}>TABLE</Text>
                <Text style={styles.tableNum}>{item.table}</Text>
              </View>
              <View style={styles.ticketMid}>
                <Text style={styles.itemName}>{item.item}</Text>
                <View style={styles.statusRow}>
                  <Ionicons
                    name={
                      item.status === 'pending'
                        ? 'time-outline'
                        : item.status === 'preparing'
                          ? 'flame-outline'
                          : 'checkmark-done-circle-outline'
                    }
                    size={14}
                    color={style.bg}
                  />
                  <Text style={[styles.statusText, { color: style.bg }]}>
                    {item.status.toUpperCase()}
                  </Text>
                </View>
              </View>
              <TouchableOpacity 
                style={[styles.actionBtn, { backgroundColor: style.bg }]}
                onPress={() => updateStatus(item.id)}
                disabled={item.status === 'prepared'}
                activeOpacity={0.85}
              >
                <Text style={[styles.actionBtnText, { color: style.text }]}>{style.label}</Text>
              </TouchableOpacity>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: QuinckleColors.background, padding: 20, paddingTop: 50 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  header: { color: QuinckleColors.textPrimary, fontSize: 28, fontWeight: '700' },
  subtitle: { color: QuinckleColors.textSecondary, fontSize: 14 },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: QuinckleColors.surfaceHover,
  },
  logoutText: { color: QuinckleColors.danger, fontWeight: 'bold' },
  ticket: { 
    flexDirection: 'row', 
    backgroundColor: QuinckleColors.surface, 
    borderRadius: 12, 
    marginBottom: 15, 
    overflow: 'hidden',
    height: 90,
    borderWidth: 1,
    borderColor: QuinckleColors.border
  },
  ticketLeft: { 
    width: 70, 
    backgroundColor: QuinckleColors.surfaceHover, 
    justifyContent: 'center', 
    alignItems: 'center',
    borderRightWidth: 1,
    borderRightColor: QuinckleColors.border
  },
  tableLabel: { color: QuinckleColors.textSecondary, fontSize: 10 },
  tableNum: { color: QuinckleColors.textPrimary, fontSize: 28, fontWeight: 'bold' },
  ticketMid: { flex: 1, padding: 15, justifyContent: 'center' },
  itemName: { color: QuinckleColors.textPrimary, fontSize: 18, fontWeight: '600' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  statusText: { fontSize: 12, fontWeight: 'bold' },
  actionBtn: { width: 100, backgroundColor: QuinckleColors.primary, justifyContent: 'center', alignItems: 'center' },
  actionBtnText: { fontWeight: 'bold', fontSize: 14 }
});