// app/(cook)/index.tsx
import React, { useMemo, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { QuinckleColors } from '../../constants/Colors';
import { useAuth } from '../../context/AuthContext';

type KitchenStatus = 'new' | 'urgent' | 'preparing' | 'ready' | 'bumped';

const INITIAL_KITCHEN_ORDERS = [
  {
    id: '1024',
    table: 'T3',
    location: 'Center',
    orderedAgo: '5m ago',
    items: ['1x Classic Margherita Pizza', '2x Cheesy Garlic Naan', '1x Coke Zero'],
    status: 'new' as KitchenStatus,
  },
  {
    id: '1025',
    table: 'T1',
    location: 'Window',
    orderedAgo: '10m ago',
    items: ['1x Ribeye Steak - Medium Rare', '1x Fries', '1x Red Wine Glass'],
    status: 'urgent' as KitchenStatus,
  },
  {
    id: '1026',
    table: 'T5',
    location: 'Patio 5',
    orderedAgo: '15m ago',
    items: ['1x Chicken Alfredo Pasta', '1x Caesar Salad'],
    status: 'preparing' as KitchenStatus,
  },
  {
    id: '1027',
    table: 'T2',
    location: 'Bar',
    orderedAgo: '20m ago',
    items: ['2x Cappuccino', '1x Brownie Sundae'],
    status: 'ready' as KitchenStatus,
  },
];

export default function CookDashboard() {
  const { logout } = useAuth();
  const [orders, setOrders] = useState(INITIAL_KITCHEN_ORDERS);
  const [activeFilter, setActiveFilter] = useState<'all' | KitchenStatus>('all');

  const handleLogout = () => {
    logout();
    router.replace('/login');
  };

  const counts = useMemo(() => {
    return {
      all: orders.length,
      new: orders.filter((o) => o.status === 'new').length,
      urgent: orders.filter((o) => o.status === 'urgent').length,
      preparing: orders.filter((o) => o.status === 'preparing').length,
      ready: orders.filter((o) => o.status === 'ready').length,
      bumped: orders.filter((o) => o.status === 'bumped').length,
      active: orders.filter((o) => o.status !== 'bumped').length,
    };
  }, [orders]);

  const filteredOrders = useMemo(() => {
    if (activeFilter === 'all') return orders;
    return orders.filter((order) => order.status === activeFilter);
  }, [orders, activeFilter]);

  const updateStatus = (id: string, nextStatus: KitchenStatus) => {
    setOrders((prev) => prev.map((order) => (order.id === id ? { ...order, status: nextStatus } : order)));
  };

  const getStatusMeta = (status: KitchenStatus) => {
    switch (status) {
      case 'new':
        return { label: 'NEW ORDER', color: QuinckleColors.success };
      case 'urgent':
        return { label: 'URGENT', color: QuinckleColors.danger };
      case 'preparing':
        return { label: 'PREPARING', color: QuinckleColors.warning };
      case 'ready':
        return { label: 'READY', color: QuinckleColors.info };
      case 'bumped':
        return { label: 'BUMPED', color: QuinckleColors.textSecondary };
      default:
        return { label: 'NEW ORDER', color: QuinckleColors.success };
    }
  };

  const getActionLabels = (status: KitchenStatus) => {
    if (status === 'new' || status === 'urgent') return { left: 'START PREP', right: 'MARK DONE' };
    if (status === 'preparing') return { left: 'IN PROGRESS', right: 'MARK DONE' };
    if (status === 'ready') return { left: 'READY TO SERVE', right: 'BUMP TICKET' };
    return { left: 'COMPLETED', right: 'BUMPED' };
  };

  const handlePrimaryAction = (id: string, status: KitchenStatus) => {
    if (status === 'new' || status === 'urgent') updateStatus(id, 'preparing');
    else if (status === 'preparing') updateStatus(id, 'ready');
  };

  const handleSecondaryAction = (id: string, status: KitchenStatus) => {
    if (status === 'new' || status === 'urgent' || status === 'preparing') updateStatus(id, 'ready');
    else if (status === 'ready') updateStatus(id, 'bumped');
  };

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <Text style={styles.header}>QuinckleCrew: Kitchen</Text>
        <View style={styles.topIcons}>
          <TouchableOpacity onPress={() => {}}>
            <Ionicons name="search" size={20} color={QuinckleColors.textPrimary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleLogout}>
            <Ionicons name="log-out-outline" size={20} color={QuinckleColors.textPrimary} />
          </TouchableOpacity>
        </View>
      </View>

      <Text style={styles.subtitle}>Grill Room Kitchen | Active: {counts.active} | New: {counts.new + counts.urgent}</Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterScroll}
        contentContainerStyle={styles.filterRow}
      >
        {[
          { key: 'all', label: `All (${counts.all})` },
          { key: 'urgent', label: `Urgent (${counts.urgent})` },
          { key: 'preparing', label: `Preparing (${counts.preparing})` },
          { key: 'ready', label: `Ready (${counts.ready})` },
          { key: 'bumped', label: `Bumped (${counts.bumped})` },
        ].map((chip) => (
          <TouchableOpacity
            key={chip.key}
            style={[styles.chip, activeFilter === chip.key && styles.chipActive]}
            onPress={() => setActiveFilter(chip.key as 'all' | KitchenStatus)}
          >
            <Text style={[styles.chipText, activeFilter === chip.key && styles.chipTextActive]}>{chip.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <FlatList
        data={filteredOrders}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          const badge = getStatusMeta(item.status);
          const actionLabels = getActionLabels(item.status);
          const disabled = item.status === 'bumped';

          return (
            <View style={styles.ticket}>
              <View style={styles.ticketHeader}>
                <Text style={styles.ticketId}>#{item.id}</Text>
                <View style={[styles.badge, { backgroundColor: `${badge.color}22` }]}>
                  <Text style={[styles.badgeText, { color: badge.color }]}>{badge.label}</Text>
                </View>
              </View>

              <View style={styles.metaRow}>
                <Ionicons name="location-outline" size={13} color={QuinckleColors.textSecondary} />
                <Text style={styles.metaText}>Table: {item.table}</Text>
                <Text style={styles.metaText}>Ordered: {item.orderedAgo}</Text>
              </View>

              <View style={styles.itemList}>
                {item.items.map((entry) => (
                  <Text key={entry} style={styles.itemLine}>
                    {entry}
                  </Text>
                ))}
              </View>

              <View style={styles.actionsRow}>
                <TouchableOpacity
                  style={[styles.actionOutlineBtn, disabled && styles.actionDisabled]}
                  onPress={() => handlePrimaryAction(item.id, item.status)}
                  disabled={disabled}
                >
                  <Text style={styles.actionOutlineText}>{actionLabels.left}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.actionAccentBtn, disabled && styles.actionDisabled]}
                  onPress={() => handleSecondaryAction(item.id, item.status)}
                  disabled={disabled}
                >
                  <Text style={styles.actionAccentText}>{actionLabels.right}</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="file-tray-outline" size={28} color={QuinckleColors.textSecondary} />
            <Text style={styles.emptyText}>No tickets in this queue.</Text>
          </View>
        }
      />

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: QuinckleColors.background, paddingHorizontal: 14, paddingTop: 52 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  header: { color: QuinckleColors.textPrimary, fontSize: 20, fontWeight: '700', flex: 1 },
  topIcons: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  subtitle: { color: QuinckleColors.textPrimary, fontSize: 24, fontWeight: '500', marginTop: 12, marginBottom: 12 },
  filterScroll: { maxHeight: 48 },
  filterRow: { paddingBottom: 10, gap: 8 },
  chip: {
    backgroundColor: QuinckleColors.surface,
    borderColor: QuinckleColors.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipActive: {
    backgroundColor: `${QuinckleColors.primary}22`,
    borderColor: QuinckleColors.primary,
  },
  chipText: { color: QuinckleColors.textSecondary, fontSize: 12, fontWeight: '500' },
  chipTextActive: { color: QuinckleColors.primary },
  listContent: { paddingBottom: 92 },
  ticket: {
    backgroundColor: QuinckleColors.surface,
    borderColor: QuinckleColors.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
  },
  ticketHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  ticketId: { color: QuinckleColors.textPrimary, fontSize: 28, fontWeight: '700' },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  badgeText: { fontSize: 12, fontWeight: '700' },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
    gap: 4,
  },
  metaText: { color: QuinckleColors.textSecondary, fontSize: 12, marginRight: 8 },
  itemList: {
    borderTopWidth: 1,
    borderTopColor: QuinckleColors.border,
    marginTop: 10,
    paddingTop: 10,
  },
  itemLine: { color: QuinckleColors.textPrimary, fontSize: 14, fontWeight: '500', marginBottom: 2 },
  actionsRow: {
    flexDirection: 'row', 
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  actionOutlineBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: 'center',
  },
  actionOutlineText: { color: QuinckleColors.textPrimary, fontSize: 13, fontWeight: '700' },
  actionAccentBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: QuinckleColors.primary,
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: 'center',
  },
  actionAccentText: { color: QuinckleColors.textPrimary, fontSize: 13, fontWeight: '700' },
  actionDisabled: {
    opacity: 0.45,
  },
  emptyState: { paddingVertical: 36, alignItems: 'center', gap: 8 },
  emptyText: { color: QuinckleColors.textSecondary },
});