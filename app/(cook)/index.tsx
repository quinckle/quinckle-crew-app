// app/(cook)/index.tsx
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Swipeable } from 'react-native-gesture-handler';
import { FlatList, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { ThemedDialog } from '../../components/ui/themed-dialog';
import { QuinckleColors } from '../../constants/Colors';
import { useAuth } from '../../context/AuthContext';

type KitchenStatus = 'new' | 'urgent' | 'preparing' | 'ready' | 'bumped';
type KitchenOrderItem = { id: string; name: string; isPrepared: boolean };

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
    status: 'new',
  },
  {
    id: '1025',
    table: 'T1',
    location: 'Window',
    orderedAgo: '10m ago',
    priority: 'urgent',
    items: [
      { id: '1025-1', name: '1x Ribeye Steak — Medium Rare', isPrepared: false },
      { id: '1025-2', name: '1x Fries', isPrepared: true },
      { id: '1025-3', name: '1x Red Wine Glass', isPrepared: false },
    ],
    status: 'urgent',
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
    status: 'preparing',
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
    status: 'ready',
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

  const handleLogout = () => { logout(); router.replace('/login'); };

  const counts = useMemo(() => ({
    all: orders.length,
    new: orders.filter((o) => o.status === 'new').length,
    urgent: orders.filter((o) => o.status === 'urgent').length,
    preparing: orders.filter((o) => o.status === 'preparing').length,
    ready: orders.filter((o) => o.status === 'ready').length,
    bumped: orders.filter((o) => o.status === 'bumped').length,
    active: orders.filter((o) => o.status !== 'bumped').length,
  }), [orders]);

  const filteredOrders = useMemo(() =>
    orders.filter((order) => {
      if (hiddenReadyIds.includes(order.id)) return false;
      const matchesFilter = activeFilter === 'all' || order.status === activeFilter;
      const query = searchText.trim().toLowerCase();
      const searchable = `${order.id} ${order.table} ${order.location} ${order.items.map((i) => i.name).join(' ')}`.toLowerCase();
      return matchesFilter && (!query || searchable.includes(query));
    }),
  [orders, activeFilter, searchText, hiddenReadyIds]);

  const updateStatus = (id: string, nextStatus: KitchenStatus) => {
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status: nextStatus } : o)));
  };

  const getStatusMeta = (status: KitchenStatus) => {
    switch (status) {
      case 'new': return { label: 'NEW', color: QuinckleColors.success };
      case 'urgent': return { label: 'URGENT', color: QuinckleColors.danger };
      case 'preparing': return { label: 'PREPARING', color: QuinckleColors.warning };
      case 'ready': return { label: 'READY', color: QuinckleColors.info };
      case 'bumped': return { label: 'BUMPED', color: QuinckleColors.textSecondary };
    }
  };

  const getActionLabels = (status: KitchenStatus) => {
    if (status === 'new' || status === 'urgent') return { left: 'Start Prep', right: 'Mark Done' };
    if (status === 'preparing') return { left: 'In Progress', right: 'Mark Done' };
    if (status === 'ready') return { left: 'Ready to Serve', right: 'Bump Ticket' };
    return { left: 'Completed', right: 'Bumped' };
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
    if (removeTimersRef.current[id]) clearTimeout(removeTimersRef.current[id]);
    removeTimersRef.current[id] = setTimeout(() => {
      updateStatus(id, 'bumped');
      setHiddenReadyIds((prev) => prev.filter((hid) => hid !== id));
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
    setHiddenReadyIds((prev) => prev.filter((hid) => hid !== pendingUndoId));
    setPendingUndoId(null);
  };

  useEffect(() => {
    return () => {
      Object.values(removeTimersRef.current).forEach(clearTimeout);
      removeTimersRef.current = {};
    };
  }, []);

  const toggleItemPrepared = (orderId: string, itemId: string) => {
    setOrders((prev) =>
      prev.map((order) => {
        if (order.id !== orderId || order.status === 'bumped') return order;
        const updatedItems = order.items.map((item) =>
          item.id === itemId ? { ...item, isPrepared: !item.isPrepared } : item,
        );
        const allPrepared = updatedItems.length > 0 && updatedItems.every((i) => i.isPrepared);
        const anyPrepared = updatedItems.some((i) => i.isPrepared);
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

  const FILTER_CHIPS = [
    { key: 'all', label: `All (${counts.all})` },
    { key: 'urgent', label: `Urgent (${counts.urgent})` },
    { key: 'preparing', label: `Preparing (${counts.preparing})` },
    { key: 'ready', label: `Ready (${counts.ready})` },
    { key: 'bumped', label: `Bumped (${counts.bumped})` },
  ] as const;

  return (
    <View style={styles.container}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <Text style={styles.header}>QuinckleCrew: Kitchen</Text>
        <TouchableOpacity onPress={() => setLogoutDialogVisible(true)}>
          <Ionicons name="log-out-outline" size={20} color={QuinckleColors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Summary card */}
      <View style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>Grill Room Kitchen</Text>
        <View style={styles.summaryStatsRow}>
          <View style={styles.statPill}>
            <Ionicons name="file-tray-outline" size={12} color={QuinckleColors.textSecondary} />
            <Text style={styles.statText}>Tickets: {counts.all}</Text>
          </View>
          <View style={styles.statPill}>
            <Ionicons name="flame-outline" size={12} color={QuinckleColors.primary} />
            <Text style={styles.statText}>Active: {counts.active}</Text>
          </View>
          <View style={styles.statPill}>
            <Ionicons name="sparkles-outline" size={12} color={QuinckleColors.success} />
            <Text style={styles.statText}>New: {counts.new + counts.urgent}</Text>
          </View>
        </View>
      </View>

      {/* Filter chips (scrollable) */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterScroll}
        contentContainerStyle={styles.filterRow}
      >
        {FILTER_CHIPS.map((chip) => (
          <TouchableOpacity
            key={chip.key}
            style={[styles.chip, activeFilter === chip.key && styles.chipActive]}
            onPress={() => setActiveFilter(chip.key as 'all' | KitchenStatus)}
          >
            <Text style={[styles.chipText, activeFilter === chip.key && styles.chipTextActive]}>
              {chip.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Search */}
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={16} color={QuinckleColors.textSecondary} />
        <TextInput
          value={searchText}
          onChangeText={setSearchText}
          placeholder="Search ticket, table, item…"
          placeholderTextColor={QuinckleColors.textSecondary}
          style={styles.searchInput}
        />
        {searchText.length > 0 && (
          <TouchableOpacity onPress={() => setSearchText('')}>
            <Ionicons name="close-circle" size={16} color={QuinckleColors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Order list */}
      <FlatList
        data={filteredOrders}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          const badge = getStatusMeta(item.status);
          const actionLabels = getActionLabels(item.status);
          const disabled = item.status === 'bumped';

          const cardContent = (
            <View style={[styles.tableCard, disabled && styles.tableCardDimmed]}>
              <View style={styles.cardTopRow}>
                <View>
                  <Text style={styles.ticketId}>#{item.id}</Text>
                  <View style={styles.metaRow}>
                    <Ionicons name="location-outline" size={12} color={QuinckleColors.textSecondary} />
                    <Text style={styles.metaText}>{item.table} · {item.location}</Text>
                    <Text style={styles.metaDivider}>·</Text>
                    <Text style={styles.metaText}>{item.orderedAgo}</Text>
                  </View>
                </View>
                <View style={[styles.badge, { backgroundColor: `${badge.color}18` }]}>
                  <Text style={[styles.badgeText, { color: badge.color }]}>{badge.label}</Text>
                </View>
              </View>

              <View style={styles.itemList}>
                {item.items.map((entry) => (
                  <TouchableOpacity
                    key={entry.id}
                    style={styles.itemRow}
                    onPress={() => toggleItemPrepared(item.id, entry.id)}
                    activeOpacity={0.8}
                    disabled={disabled}
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
                renderRightActions={() => (
                  <View style={styles.swipeAction}>
                    <Ionicons name="archive-outline" size={20} color="#fff" />
                    <Text style={styles.swipeActionText}>Remove</Text>
                  </View>
                )}
                overshootRight={false}
                onSwipeableOpen={() => handleSwipeRemoveReady(item.id)}
              >
                {cardContent}
              </Swipeable>
            );
          }

          return cardContent;
        }}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="file-tray-outline" size={28} color={QuinckleColors.textSecondary} />
            <Text style={styles.emptyText}>No tickets in this queue.</Text>
          </View>
        }
      />

      {/* Undo bar */}
      {pendingUndoId ? (
        <View style={styles.undoBar}>
          <Text style={styles.undoText}>Ticket #{pendingUndoId} removed.</Text>
          <TouchableOpacity onPress={handleUndoRemove}>
            <Text style={styles.undoAction}>UNDO</Text>
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
  container: {
    flex: 1,
    backgroundColor: QuinckleColors.background,
    paddingHorizontal: 14,
    paddingTop: 52,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  header: { color: QuinckleColors.textPrimary, fontSize: 17, fontWeight: '700', flex: 1 },
  summaryCard: {
    backgroundColor: 'rgba(243,93,59,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(243,93,59,0.14)',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  summaryTitle: {
    color: QuinckleColors.textPrimary,
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 10,
    letterSpacing: -0.3,
  },
  summaryStatsRow: { flexDirection: 'row', gap: 8 },
  statPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 6,
  },
  statText: { color: QuinckleColors.textPrimary, fontSize: 11, fontWeight: '600' },
  filterScroll: { marginBottom: 12, flexGrow: 0 },
  filterRow: { flexDirection: 'row', gap: 7, paddingRight: 4 },
  chip: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipActive: {
    borderColor: 'rgba(243,93,59,0.45)',
    backgroundColor: 'rgba(243,93,59,0.13)',
  },
  chipText: { color: QuinckleColors.textSecondary, fontSize: 12, fontWeight: '500' },
  chipTextActive: { color: QuinckleColors.primary, fontWeight: '600' },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    marginBottom: 12,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    color: QuinckleColors.textPrimary,
    paddingVertical: 10,
    fontSize: 14,
  },
  listContent: { paddingBottom: 30 },
  tableCard: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderColor: 'rgba(255,255,255,0.09)',
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
  },
  tableCardDimmed: { opacity: 0.5 },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  ticketId: {
    color: QuinckleColors.textPrimary,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3,
  },
  metaText: { color: QuinckleColors.textSecondary, fontSize: 12 },
  metaDivider: { color: QuinckleColors.textSecondary, fontSize: 12 },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  badgeText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  itemList: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.07)',
    marginTop: 8,
    paddingTop: 10,
    gap: 8,
  },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  itemLine: { color: QuinckleColors.textPrimary, fontSize: 14, fontWeight: '500', flex: 1 },
  itemLineDone: {
    color: QuinckleColors.textSecondary,
    textDecorationLine: 'line-through',
  },
  cardActions: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.07)',
    paddingTop: 10,
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  actionBtn: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    paddingVertical: 9,
    alignItems: 'center',
  },
  actionBtnAccent: {
    borderColor: 'rgba(243,93,59,0.35)',
    backgroundColor: 'rgba(243,93,59,0.08)',
  },
  actionText: { color: QuinckleColors.textPrimary, fontSize: 12, fontWeight: '600' },
  actionDisabled: { opacity: 0.4 },
  swipeAction: {
    width: 92,
    marginBottom: 10,
    borderRadius: 12,
    backgroundColor: QuinckleColors.danger,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  swipeActionText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  undoBar: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: 14,
    paddingVertical: 11,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  undoText: { color: QuinckleColors.textPrimary, fontSize: 13, flex: 1, marginRight: 10 },
  undoAction: { color: QuinckleColors.primary, fontWeight: '700', fontSize: 13 },
  emptyState: { paddingVertical: 40, alignItems: 'center', gap: 8 },
  emptyText: { color: QuinckleColors.textSecondary, fontSize: 14 },
});
