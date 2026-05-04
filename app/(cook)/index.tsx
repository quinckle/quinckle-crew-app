// app/(cook)/index.tsx
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Swipeable } from 'react-native-gesture-handler';
import { FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { ThemedDialog } from '../../components/ui/themed-dialog';
import { QuinckleColors } from '../../constants/Colors';
import { useAuth } from '../../context/AuthContext';

type KitchenStatus = 'new' | 'urgent' | 'preparing' | 'ready' | 'bumped';
type KitchenOrderItem = {
  id: string;
  name: string;
  isPrepared: boolean;
};

type KitchenOrder = {
  id: string;
  table: string;
  location: string;
  orderedAgo: string;
  priority: 'normal' | 'urgent';
  items: KitchenOrderItem[];
  status: KitchenStatus;
};

const INITIAL_KITCHEN_ORDERS: KitchenOrder[] = [
  {
    id: '1024',
    table: 'T3',
    location: 'Center',
    orderedAgo: '5m ago',
    priority: 'normal',
    items: [
      { id: '1024-1', name: '1x Classic Margherita Pizza', isPrepared: false },
      { id: '1024-2', name: '2x Cheesy Garlic Naan', isPrepared: false },
      { id: '1024-3', name: '1x Coke Zero', isPrepared: false },
    ],
    status: 'new' as KitchenStatus,
  },
  {
    id: '1025',
    table: 'T1',
    location: 'Window',
    orderedAgo: '10m ago',
    priority: 'urgent',
    items: [
      { id: '1025-1', name: '1x Ribeye Steak - Medium Rare', isPrepared: false },
      { id: '1025-2', name: '1x Fries', isPrepared: true },
      { id: '1025-3', name: '1x Red Wine Glass', isPrepared: false },
    ],
    status: 'urgent' as KitchenStatus,
  },
  {
    id: '1026',
    table: 'T5',
    location: 'Patio 5',
    orderedAgo: '15m ago',
    priority: 'normal',
    items: [
      { id: '1026-1', name: '1x Chicken Alfredo Pasta', isPrepared: true },
      { id: '1026-2', name: '1x Caesar Salad', isPrepared: false },
    ],
    status: 'preparing' as KitchenStatus,
  },
  {
    id: '1027',
    table: 'T2',
    location: 'Bar',
    orderedAgo: '20m ago',
    priority: 'normal',
    items: [
      { id: '1027-1', name: '2x Cappuccino', isPrepared: true },
      { id: '1027-2', name: '1x Brownie Sundae', isPrepared: true },
    ],
    status: 'ready' as KitchenStatus,
  },
];

export default function CookDashboard() {
  const { logout } = useAuth();
  const [orders, setOrders] = useState(INITIAL_KITCHEN_ORDERS);
  const [activeFilter, setActiveFilter] = useState<'all' | KitchenStatus>('all');
  const [searchText, setSearchText] = useState('');
  const [logoutDialogVisible, setLogoutDialogVisible] = useState(false);
  const [hiddenReadyIds, setHiddenReadyIds] = useState<string[]>([]);
  const [pendingUndoId, setPendingUndoId] = useState<string | null>(null);
  const removeTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

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
    return orders.filter((order) => {
      if (hiddenReadyIds.includes(order.id)) return false;
      const matchesFilter = activeFilter === 'all' ? true : order.status === activeFilter;
      const query = searchText.trim().toLowerCase();
      const searchableItems = order.items.map((item) => item.name).join(' ');
      const searchable = `${order.id} ${order.table} ${order.location} ${searchableItems}`.toLowerCase();
      const matchesSearch = !query || searchable.includes(query);
      return matchesFilter && matchesSearch;
    });
  }, [orders, activeFilter, searchText, hiddenReadyIds]);

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

  const handleSwipeRemoveReady = (id: string) => {
    const order = orders.find((o) => o.id === id);
    if (!order || order.status !== 'ready') return;

    setHiddenReadyIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setPendingUndoId(id);

    if (removeTimersRef.current[id]) {
      clearTimeout(removeTimersRef.current[id]);
    }

    removeTimersRef.current[id] = setTimeout(() => {
      updateStatus(id, 'bumped');
      setHiddenReadyIds((prev) => prev.filter((hiddenId) => hiddenId !== id));
      setPendingUndoId((prev) => (prev === id ? null : prev));
      delete removeTimersRef.current[id];
    }, 5000);
  };

  const handleUndoRemove = () => {
    if (!pendingUndoId) return;
    if (removeTimersRef.current[pendingUndoId]) {
      clearTimeout(removeTimersRef.current[pendingUndoId]);
      delete removeTimersRef.current[pendingUndoId];
    }
    setHiddenReadyIds((prev) => prev.filter((hiddenId) => hiddenId !== pendingUndoId));
    setPendingUndoId(null);
  };

  useEffect(() => {
    return () => {
      Object.values(removeTimersRef.current).forEach((timer) => clearTimeout(timer));
      removeTimersRef.current = {};
    };
  }, []);

  const renderSwipeRightAction = () => (
    <View style={styles.swipeAction}>
      <Ionicons name="archive-outline" size={20} color={QuinckleColors.textPrimary} />
      <Text style={styles.swipeActionText}>Remove</Text>
    </View>
  );

  const toggleItemPrepared = (orderId: string, itemId: string) => {
    setOrders((prev) =>
      prev.map((order) => {
        if (order.id !== orderId) return order;
        if (order.status === 'bumped') return order;
        const updatedItems = order.items.map((item) =>
          item.id === itemId ? { ...item, isPrepared: !item.isPrepared } : item,
        );
        const allPrepared = updatedItems.length > 0 && updatedItems.every((item) => item.isPrepared);
        const anyPrepared = updatedItems.some((item) => item.isPrepared);
        const nextStatus: KitchenStatus = allPrepared
          ? 'ready'
          : anyPrepared
            ? 'preparing'
            : order.priority === 'urgent'
              ? 'urgent'
              : 'new';
        return { ...order, items: updatedItems, status: nextStatus };
      }),
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <Text style={styles.header}>QuinckleCrew: Kitchen</Text>
        <View style={styles.topIcons}>
          <TouchableOpacity onPress={() => {}}>
            <Ionicons name="search" size={20} color={QuinckleColors.textPrimary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setLogoutDialogVisible(true)}>
            <Ionicons name="log-out-outline" size={20} color={QuinckleColors.textPrimary} />
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>Grill Room Kitchen</Text>
        <View style={styles.summaryStatsRow}>
          <View style={styles.summaryStatPill}>
            <Ionicons name="file-tray-outline" size={12} color={QuinckleColors.textSecondary} />
            <Text style={styles.summaryStatText}>Tickets: {counts.all}</Text>
          </View>
          <View style={styles.summaryStatPill}>
            <Ionicons name="flame-outline" size={12} color={QuinckleColors.primary} />
            <Text style={styles.summaryStatText}>Active: {counts.active}</Text>
          </View>
          <View style={styles.summaryStatPill}>
            <Ionicons name="sparkles-outline" size={12} color={QuinckleColors.success} />
            <Text style={styles.summaryStatText}>New: {counts.new + counts.urgent}</Text>
          </View>
        </View>
      </View>

      <View style={styles.filterRow}>
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
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={18} color={QuinckleColors.textSecondary} />
        <TextInput
          value={searchText}
          onChangeText={setSearchText}
          placeholder="Search Ticket, Table, Item..."
          placeholderTextColor={QuinckleColors.textSecondary}
          style={styles.searchInput}
        />
      </View>

      <FlatList
        data={filteredOrders}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          const badge = getStatusMeta(item.status);
          const actionLabels = getActionLabels(item.status);
          const disabled = item.status === 'bumped';

          const cardContent = (
            <View style={styles.tableCard}>
              <View style={styles.cardTopRow}>
                <Text style={styles.tableTitle}>#{item.id}</Text>
                <View style={[styles.badge, { backgroundColor: `${badge.color}22` }]}>
                  <Text style={[styles.statusPillText, { color: badge.color }]}>{badge.label}</Text>
                </View>
              </View>

              <View style={styles.metaRow}>
                <Ionicons name="location-outline" size={13} color={QuinckleColors.textSecondary} />
                <Text style={styles.metaText}>Table: {item.table}</Text>
                <Text style={styles.metaText}>Ordered: {item.orderedAgo}</Text>
              </View>

              <View style={styles.itemList}>
                {item.items.map((entry) => (
                  <TouchableOpacity
                    key={entry.id}
                    style={styles.itemRow}
                    onPress={() => toggleItemPrepared(item.id, entry.id)}
                    activeOpacity={0.85}
                  >
                    <Ionicons
                      name={entry.isPrepared ? 'checkbox' : 'square-outline'}
                      size={18}
                      color={entry.isPrepared ? QuinckleColors.success : QuinckleColors.textSecondary}
                    />
                    <Text style={[styles.itemLine, entry.isPrepared && styles.itemLineDone]}>
                      {entry.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.cardActions}>
                <TouchableOpacity
                  style={[styles.actionBtn, disabled && styles.actionDisabled]}
                  onPress={() => handlePrimaryAction(item.id, item.status)}
                  disabled={disabled}
                >
                  <Text style={styles.actionText}>{actionLabels.left}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.actionBtn, styles.actionBtnAccent, disabled && styles.actionDisabled]}
                  onPress={() => handleSecondaryAction(item.id, item.status)}
                  disabled={disabled}
                >
                  <Text style={styles.actionText}>{actionLabels.right}</Text>
                </TouchableOpacity>
              </View>
            </View>
          );

          if (item.status === 'ready') {
            return (
              <Swipeable
                renderRightActions={renderSwipeRightAction}
                overshootRight={false}
                onSwipeableOpen={() => handleSwipeRemoveReady(item.id)}
              >
                {cardContent}
              </Swipeable>
            );
          }

          return (
            cardContent
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="file-tray-outline" size={28} color={QuinckleColors.textSecondary} />
            <Text style={styles.emptyText}>No tickets in this queue.</Text>
          </View>
        }
      />

      {pendingUndoId ? (
        <View style={styles.undoBar}>
          <Text style={styles.undoText}>Ticket #{pendingUndoId} removed from view.</Text>
          <TouchableOpacity onPress={handleUndoRemove}>
            <Text style={styles.undoActionText}>UNDO</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <ThemedDialog
        visible={logoutDialogVisible}
        title="Logout"
        message="Are you sure you want to log out?"
        actions={[
          { label: 'Cancel', onPress: () => setLogoutDialogVisible(false) },
          { label: 'Logout', variant: 'danger', onPress: handleLogout },
        ]}
        onClose={() => setLogoutDialogVisible(false)}
      />

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: QuinckleColors.background, paddingHorizontal: 14, paddingTop: 52 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
    backgroundColor: `${QuinckleColors.surface}CC`,
    borderWidth: 1,
    borderColor: `${QuinckleColors.border}CC`,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  header: { color: QuinckleColors.textPrimary, fontSize: 20, fontWeight: '700', flex: 1 },
  topIcons: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  summaryCard: {
    backgroundColor: `${QuinckleColors.surface}CC`,
    borderWidth: 1,
    borderColor: `${QuinckleColors.border}CC`,
    borderRadius: 14,
    padding: 12,
    marginBottom: 12,
  },
  summaryTitle: {
    color: QuinckleColors.textPrimary,
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 10,
  },
  summaryStatsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  summaryStatPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: QuinckleColors.surfaceHover,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 8,
  },
  summaryStatText: {
    color: QuinckleColors.textPrimary,
    fontSize: 11,
    fontWeight: '600',
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  chip: {
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    backgroundColor: `${QuinckleColors.surface}CC`,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  chipActive: {
    borderColor: QuinckleColors.primary,
    backgroundColor: `${QuinckleColors.primary}22`,
  },
  chipText: { color: QuinckleColors.textSecondary, fontSize: 12, fontWeight: '500' },
  chipTextActive: { color: QuinckleColors.primary },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: QuinckleColors.surface,
    borderColor: QuinckleColors.border,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    color: QuinckleColors.textPrimary,
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  listContent: { paddingBottom: 92 },
  tableCard: {
    backgroundColor: `${QuinckleColors.surface}D9`,
    borderColor: QuinckleColors.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    elevation: 2,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  tableTitle: { color: QuinckleColors.textPrimary, fontSize: 28, fontWeight: '700' },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusPillText: { fontSize: 12, fontWeight: '600' },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  metaText: { color: QuinckleColors.textSecondary, fontSize: 12, marginRight: 6 },
  itemList: {
    borderTopWidth: 1,
    borderTopColor: QuinckleColors.border,
    marginTop: 10,
    paddingTop: 10,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  itemLine: { color: QuinckleColors.textPrimary, fontSize: 14, fontWeight: '500', marginBottom: 2 },
  itemLineDone: {
    color: QuinckleColors.textSecondary,
    textDecorationLine: 'line-through',
  },
  cardActions: {
    borderTopWidth: 1,
    borderTopColor: QuinckleColors.border,
    paddingTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  actionBtn: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    paddingVertical: 10,
    alignItems: 'center',
  },
  actionBtnAccent: {
    borderColor: QuinckleColors.primary,
  },
  actionText: { color: QuinckleColors.textPrimary, fontSize: 12, fontWeight: '600' },
  actionDisabled: {
    opacity: 0.45,
  },
  swipeAction: {
    width: 96,
    marginBottom: 10,
    borderRadius: 12,
    backgroundColor: QuinckleColors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  swipeActionText: {
    color: QuinckleColors.textPrimary,
    fontSize: 12,
    fontWeight: '700',
  },
  undoBar: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 14,
    borderRadius: 12,
    backgroundColor: `${QuinckleColors.surface}EE`,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  undoText: {
    color: QuinckleColors.textPrimary,
    fontSize: 12,
    flex: 1,
    marginRight: 10,
  },
  undoActionText: {
    color: QuinckleColors.primary,
    fontWeight: '700',
    fontSize: 12,
  },
  emptyState: { paddingVertical: 36, alignItems: 'center', gap: 8 },
  emptyText: { color: QuinckleColors.textSecondary },
});