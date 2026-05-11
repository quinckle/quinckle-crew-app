import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Swipeable } from 'react-native-gesture-handler';
import {
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemedDialog } from '../../components/ui/themed-dialog';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';
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
      { id: '1024-1', name: '1× Classic Margherita Pizza', isPrepared: false },
      { id: '1024-2', name: '2× Cheesy Garlic Naan', isPrepared: false },
      { id: '1024-3', name: '1× Coke Zero', isPrepared: false },
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
      { id: '1025-1', name: '1× Ribeye Steak — Medium Rare', isPrepared: false },
      { id: '1025-2', name: '1× Fries', isPrepared: true },
      { id: '1025-3', name: '1× Red Wine Glass', isPrepared: false },
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
      { id: '1026-1', name: '1× Chicken Alfredo Pasta', isPrepared: true },
      { id: '1026-2', name: '1× Caesar Salad', isPrepared: false },
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
      { id: '1027-1', name: '2× Cappuccino', isPrepared: true },
      { id: '1027-2', name: '1× Brownie Sundae', isPrepared: true },
    ],
    status: 'ready',
  },
];

const STATUS_META: Record<KitchenStatus, { label: string; color: string }> = {
  new: { label: 'New', color: QuinckleColors.success },
  urgent: { label: 'Urgent', color: QuinckleColors.danger },
  preparing: { label: 'Preparing', color: QuinckleColors.warning },
  ready: { label: 'Ready', color: QuinckleColors.info },
  bumped: { label: 'Bumped', color: QuinckleColors.textTertiary },
};

export default function CookDashboard() {
  const insets = useSafeAreaInsets();
  const { logout } = useAuth();
  const [orders, setOrders] = useState(INITIAL_KITCHEN_ORDERS);
  const [searchText, setSearchText] = useState('');
  const [logoutDialogVisible, setLogoutDialogVisible] = useState(false);
  const [navTab, setNavTab] = useState<'active' | 'completed'>('active');
  const [hiddenReadyIds, setHiddenReadyIds] = useState<string[]>([]);
  const [pendingUndoId, setPendingUndoId] = useState<string | null>(null);
  const removeTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const handleLogout = () => {
    logout();
    router.replace('/login');
  };

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
      const isCompleted = order.status === 'bumped';
      if (navTab === 'active' && isCompleted) return false;
      if (navTab === 'completed' && !isCompleted) return false;

      if (hiddenReadyIds.includes(order.id)) return false;
      const query = searchText.trim().toLowerCase();
      const searchable = `${order.id} ${order.table} ${order.location} ${order.items.map((i) => i.name).join(' ')}`.toLowerCase();
      return !query || searchable.includes(query);
    }),
  [orders, searchText, hiddenReadyIds, navTab]);

  const updateStatus = (id: string, nextStatus: KitchenStatus) => {
    setOrders((prev) => prev.map((o) => (o.id === id ? { ...o, status: nextStatus } : o)));
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


  return (
    <View style={[styles.container, { paddingTop: insets.top + Spacing.sm }]}>
      <View style={styles.topBar}>
        <View style={styles.brandGroup}>
          <Text style={styles.brandTitle}>The Grill Room</Text>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: QuinckleColors.success }]} />
            <Text style={styles.statusText}>Online</Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.avatarBtn}
          onPress={() => setLogoutDialogVisible(true)}
          activeOpacity={0.7}
        >
          <Image
            source={{ uri: 'https://images.unsplash.com/photo-1577219491135-ce391730fb2c?q=80&w=200&h=200&auto=format&fit=crop' }}
            style={styles.avatarImage}
          />
        </TouchableOpacity>
      </View>

      <View style={styles.headerCountWrap}>
        <Text style={styles.headerCountText}>
          {navTab === 'active' ? `${counts.active} active tickets` : `${counts.bumped} completed tickets`}
        </Text>
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={15} color={QuinckleColors.textTertiary} />
        <TextInput
          value={searchText}
          onChangeText={setSearchText}
          placeholder="Search ticket, table, item…"
          placeholderTextColor={QuinckleColors.textTertiary}
          style={styles.searchInput}
        />
        {searchText.length > 0 && (
          <TouchableOpacity onPress={() => setSearchText('')}>
            <Ionicons name="close-circle" size={16} color={QuinckleColors.textTertiary} />
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={filteredOrders}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + 80 }]}
        renderItem={({ item }) => {
          const meta = STATUS_META[item.status];
          const disabled = item.status === 'bumped';
          const preparedCount = item.items.filter((i) => i.isPrepared).length;
          const isUrgent = item.status === 'urgent';

          const cardContent = (
            <View
              style={[
                styles.orderCard,
                disabled && styles.orderCardDimmed,
                isUrgent && styles.orderCardUrgent,
              ]}
            >
              <View style={styles.cardTopRow}>
                <View>
                  <View style={styles.ticketRow}>
                    <Text style={styles.ticketId}>#{item.id}</Text>
                    <View style={styles.tableTag}>
                      <Text style={styles.tableTagText}>{item.table}</Text>
                    </View>
                  </View>
                  </View>
                <View style={[styles.statusPill, { backgroundColor: QuinckleColors.surfaceMutedHover, borderColor: QuinckleColors.borderStrong }]}>
                  <View style={[styles.statusPillDot, { backgroundColor: QuinckleColors.primary }]} />
                  <Text style={[styles.statusPillText, { color: QuinckleColors.textPrimary }]}>
                    {item.status === 'bumped' ? 'BUMPED' : `${preparedCount}/${item.items.length} READY`}
                  </Text>
                </View>
              </View>

              <View style={styles.itemList}>
                <View style={styles.dividerProgressContainer}>
                  <View 
                    style={[
                      styles.dividerProgressFill, 
                      { width: `${(preparedCount / item.items.length) * 100}%` }
                    ]} 
                  />
                </View>
                {item.items.map((entry) => (
                  <TouchableOpacity
                    key={entry.id}
                    style={styles.itemRow}
                    onPress={() => toggleItemPrepared(item.id, entry.id)}
                    activeOpacity={0.7}
                    disabled={disabled}
                  >
                    <View style={[styles.checkbox, entry.isPrepared && styles.checkboxChecked]}>
                      {entry.isPrepared && <Ionicons name="checkmark" size={13} color="#fff" />}
                    </View>
                    <Text style={[styles.itemLine, entry.isPrepared && styles.itemLineDone]}>
                      {entry.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.cardFooter}>
                <View />
                {item.status === 'ready' && (
                  <Text style={styles.swipeHint}>Swipe to bump →</Text>
                )}
              </View>
            </View>
          );

          if (item.status === 'ready') {
            return (
              <Swipeable
                renderRightActions={() => (
                  <View style={styles.swipeAction}>
                    <Ionicons name="archive-outline" size={20} color="#fff" />
                    <Text style={styles.swipeActionText}>Bump</Text>
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
            <Ionicons name="restaurant-outline" size={28} color={QuinckleColors.textTertiary} />
            <Text style={styles.emptyText}>No tickets in this queue.</Text>
          </View>
        }
      />

      {pendingUndoId ? (
        <View style={[styles.undoBar, { bottom: insets.bottom + Spacing.md }]}>
          <Text style={styles.undoText}>Ticket #{pendingUndoId} bumped.</Text>
          <TouchableOpacity onPress={handleUndoRemove}>
            <Text style={styles.undoAction}>Undo</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <ThemedDialog
        visible={logoutDialogVisible}
        title="Log out?"
        message="You'll need to sign in again to receive new kitchen tickets."
        actions={[
          { label: 'Cancel', onPress: () => setLogoutDialogVisible(false) },
          { label: 'Log Out', variant: 'danger', onPress: () => { setLogoutDialogVisible(false); handleLogout(); } },
        ]}
        onClose={() => setLogoutDialogVisible(false)}
      />

      <View style={[styles.bottomNav, { paddingBottom: Math.max(insets.bottom, Spacing.sm) }]}>
        <View style={styles.navRow}>
          <TouchableOpacity 
            style={styles.navBtn} 
            onPress={() => setNavTab('active')}
            activeOpacity={0.7}
          >
            <Ionicons name={navTab === 'active' ? 'flame' : 'flame-outline'} size={22} color={navTab === 'active' ? QuinckleColors.primary : QuinckleColors.textTertiary} />
            <Text style={[styles.navLabel, navTab === 'active' && styles.navLabelActive]}>Active</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={styles.navBtn} 
            onPress={() => setNavTab('completed')}
            activeOpacity={0.7}
          >
            <Ionicons name={navTab === 'completed' ? 'checkmark-done' : 'checkmark-done-outline'} size={22} color={navTab === 'completed' ? QuinckleColors.primary : QuinckleColors.textTertiary} />
            <Text style={[styles.navLabel, navTab === 'completed' && styles.navLabelActive]}>Completed</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: QuinckleColors.background,
    paddingHorizontal: Spacing.lg,
  },

  bottomNav: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: QuinckleColors.background,
    borderTopWidth: 1,
    borderTopColor: QuinckleColors.border,
    paddingTop: Spacing.sm,
  },
  navRow: {
    flexDirection: 'row',
  },
  navBtn: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  navLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: QuinckleColors.textTertiary,
  },
  navLabelActive: {
    color: QuinckleColors.primary,
  },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  brandGroup: {
    gap: 4,
  },
  brandTitle: {
    color: QuinckleColors.textPrimary,
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    color: QuinckleColors.textSecondary,
    fontSize: 12,
    fontWeight: '500',
  },
  avatarBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: QuinckleColors.border,
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },

  headerCountWrap: {
    marginBottom: Spacing.sm,
    paddingHorizontal: 4,
  },
  headerCountText: {
    color: QuinckleColors.textSecondary,
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: QuinckleColors.surfaceMuted,
    borderColor: QuinckleColors.border,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    height: 44,
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  searchInput: {
    flex: 1,
    color: QuinckleColors.textPrimary,
    fontSize: 14,
  },

  listContent: {
    gap: Spacing.md,
  },
  orderCard: {
    backgroundColor: QuinckleColors.surface,
    borderColor: QuinckleColors.border,
    borderWidth: 1,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
  },
  orderCardDimmed: {
    opacity: 0.5,
  },
  orderCardUrgent: {
    borderColor: QuinckleColors.dangerBorder,
    backgroundColor: QuinckleColors.dangerSoft,
  },

  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: Spacing.md,
  },
  ticketRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  ticketId: {
    color: QuinckleColors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  tableTag: {
    backgroundColor: QuinckleColors.surfaceMutedHover,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Radius.sm,
  },
  tableTagText: {
    color: QuinckleColors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    borderWidth: 1,
  },
  statusPillDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
  },
  statusPillText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },

  itemList: {
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: QuinckleColors.borderSubtle,
    marginBottom: Spacing.sm,
  },
  dividerProgressContainer: {
    height: 2,
    backgroundColor: QuinckleColors.borderSubtle,
    width: '100%',
    marginBottom: Spacing.sm,
    borderRadius: 1,
    overflow: 'hidden',
  },
  dividerProgressFill: {
    height: '100%',
    backgroundColor: QuinckleColors.primary,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: 4,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: QuinckleColors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: QuinckleColors.success,
    borderColor: QuinckleColors.success,
  },
  itemLine: {
    color: QuinckleColors.textPrimary,
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  itemLineDone: {
    color: QuinckleColors.textTertiary,
    textDecorationLine: 'line-through',
  },

  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 4,
  },
  progressText: {
    color: QuinckleColors.textTertiary,
    fontSize: 12,
    fontWeight: '500',
  },
  swipeHint: {
    color: QuinckleColors.info,
    fontSize: 11,
    fontWeight: '600',
  },

  swipeAction: {
    width: 92,
    borderRadius: Radius.lg,
    backgroundColor: QuinckleColors.danger,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  swipeActionText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },

  undoBar: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    borderRadius: Radius.md,
    backgroundColor: QuinckleColors.surface,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  undoText: {
    color: QuinckleColors.textPrimary,
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
    marginRight: Spacing.sm,
  },
  undoAction: {
    color: QuinckleColors.primary,
    fontWeight: '600',
    fontSize: 13,
  },

  emptyState: {
    paddingVertical: Spacing.huge,
    alignItems: 'center',
    gap: Spacing.md,
  },
  emptyText: {
    color: QuinckleColors.textTertiary,
    fontSize: 14,
  },
});
