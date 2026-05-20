import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { kitchen } from '../../services/api';
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
  const { logout, staffInfo } = useAuth();
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [bumpedOrders, setBumpedOrders] = useState<KitchenOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [navTab, setNavTab] = useState<'active' | 'completed' | 'profile'>('active');
  const [isOnline, setIsOnline] = useState(true);
  const [shiftStart, setShiftStart] = useState<Date | null>(new Date(Date.now() - 3.5 * 60 * 60 * 1000));
  const [activeDuration, setActiveDuration] = useState('03h 30m');
  const [shiftPeriod, setShiftPeriod] = useState<'today' | 'week'>('today');
  const [shiftLogs, setShiftLogs] = useState([
    { d: 'Mon', t: '10:00 - 18:00', h: 8.0 },
    { d: 'Tue', t: '09:30 - 17:30', h: 8.0 },
    { d: 'Wed', t: '10:00 - 16:00', h: 6.0 },
  ]);
  const [pendingUndoId, setPendingUndoId] = useState<string | null>(null);

  const handleLogout = () => {
    logout();
    router.replace('/login');
  };

  const loadOrders = useCallback(async () => {
    try {
      const res = await kitchen.getOrders() as any;
      const tickets: any[] = res?.tickets ?? [];
      setOrders(
        tickets.map(t => {
          const allDone = t.items.every((i: any) => i.item_status === 'done');
          const anyDone = t.items.some((i: any) => i.item_status === 'done');
          const status: KitchenStatus = allDone ? 'ready' : anyDone ? 'preparing' : 'new';
          return {
            id: t.order_id,
            table: `T${t.table_number}`,
            location: '',
            orderedAgo: (() => {
              const mins = Math.floor((Date.now() - new Date(t.placed_at).getTime()) / 60000);
              if (mins < 1) return 'just now';
              if (mins < 60) return `${mins}m ago`;
              return `${Math.floor(mins / 60)}h ${mins % 60}m ago`;
            })(),
            priority: 'normal' as const,
            items: t.items.map((item: any) => ({
              id: item.item_id,
              name: `${item.qty}× ${item.name}${item.note ? ` — ${item.note}` : ''}`,
              isPrepared: item.item_status === 'done',
            })),
            status,
          };
        })
      );
    } catch {
      setOrders(prev => (prev.length === 0 ? INITIAL_KITCHEN_ORDERS : prev));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOrders();
    const interval = setInterval(loadOrders, 15000);
    return () => clearInterval(interval);
  }, [loadOrders]);

  const counts = useMemo(() => ({
    all: orders.length + bumpedOrders.length,
    new: orders.filter((o) => o.status === 'new').length,
    urgent: orders.filter((o) => o.status === 'urgent').length,
    preparing: orders.filter((o) => o.status === 'preparing').length,
    ready: orders.filter((o) => o.status === 'ready').length,
    bumped: bumpedOrders.length,
    active: orders.length,
  }), [orders, bumpedOrders]);

  const filteredOrders = useMemo(() => {
    const source = navTab === 'completed' ? bumpedOrders : orders;
    return source.filter((order) => {
      const query = searchText.trim().toLowerCase();
      const searchable = `${order.id} ${order.table} ${order.location} ${order.items.map((i) => i.name).join(' ')}`.toLowerCase();
      return !query || searchable.includes(query);
    });
  }, [orders, bumpedOrders, searchText, navTab]);

  const handleSwipeRemoveReady = async (id: string) => {
    const order = orders.find((o) => o.id === id);
    if (!order || order.status !== 'ready') return;

    setOrders(prev => prev.filter(o => o.id !== id));
    setBumpedOrders(prev => [...prev, { ...order, status: 'bumped' as KitchenStatus }]);
    setPendingUndoId(id);

    try {
      await kitchen.bumpOrder(id);
    } catch {
      setOrders(prev => [...prev, order]);
      setBumpedOrders(prev => prev.filter(o => o.id !== id));
      setPendingUndoId(null);
    }
  };

  const handleUndoRemove = async () => {
    if (!pendingUndoId) return;
    const id = pendingUndoId;
    const bumpedOrder = bumpedOrders.find(o => o.id === id);
    setPendingUndoId(null);

    if (bumpedOrder) {
      setBumpedOrders(prev => prev.filter(o => o.id !== id));
      setOrders(prev => [...prev, { ...bumpedOrder, status: 'ready' as KitchenStatus }]);
    }

    try {
      await kitchen.undoBump(id);
      await loadOrders();
    } catch {
      if (bumpedOrder) {
        setOrders(prev => prev.filter(o => o.id !== id));
        setBumpedOrders(prev => [...prev, { ...bumpedOrder, status: 'bumped' as KitchenStatus }]);
      }
    }
  };

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isOnline && shiftStart) {
      const updateDuration = () => {
        const diff = Date.now() - shiftStart.getTime();
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        setActiveDuration(`${String(hours).padStart(2, '0')}h ${String(mins).padStart(2, '0')}m`);
      };
      updateDuration();
      interval = setInterval(updateDuration, 60000);
    } else {
      setActiveDuration('--');
    }
    return () => clearInterval(interval);
  }, [isOnline, shiftStart]);

  const formatNow = () => {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  };

  const handleToggleOnline = () => {
    if (isOnline && shiftStart) {
      const diff = Date.now() - shiftStart.getTime();
      const hours = diff / (1000 * 60 * 60);
      if (hours > 0.05) {
        const startStr = `${String(shiftStart.getHours()).padStart(2, '0')}:${String(shiftStart.getMinutes()).padStart(2, '0')}`;
        const endStr = formatNow();
        const dayStr = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date().getDay()];
        setShiftLogs((prev) => [...prev, { d: dayStr, t: `${startStr} - ${endStr}`, h: parseFloat(hours.toFixed(1)) }]);
      }
      setShiftStart(null);
    } else {
      setShiftStart(new Date());
    }
    setIsOnline((prev) => !prev);
  };

  const chartData = useMemo(() => {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const currentDayIndex = (new Date().getDay() + 6) % 7;
    return days.map((day, i) => {
      let hours = 0;
      if (i === currentDayIndex) {
        hours = isOnline && shiftStart ? (Date.now() - shiftStart.getTime()) / (1000 * 60 * 60) : 0;
      } else {
        const log = shiftLogs.find((l) => l.d === day);
        hours = log ? log.h : 0;
      }
      return { day, percentage: Math.min((hours / 12) * 100, 100), isToday: i === currentDayIndex, label: day[0] };
    });
  }, [shiftLogs, shiftStart, isOnline]);

  const totalTodayHours = useMemo(() => {
    const dayStr = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date().getDay()];
    const completed = shiftLogs.filter((l) => l.d === dayStr).reduce((acc, l) => acc + l.h, 0);
    const active = isOnline && shiftStart ? (Date.now() - shiftStart.getTime()) / (1000 * 60 * 60) : 0;
    const total = completed + active;
    return `${String(Math.floor(total)).padStart(2, '0')}h ${String(Math.floor((total % 1) * 60)).padStart(2, '0')}m`;
  }, [shiftLogs, isOnline, shiftStart]);

  const COOK_ACTIVITY = [
    { id: '1', message: 'Bumped ticket #1027 — T2 (Cappuccino × 2, Brownie Sundae)', date: '20 May', time: '14:30' },
    { id: '2', message: 'Marked all items ready for ticket #1026 — T5', date: '20 May', time: '14:20' },
    { id: '3', message: 'Marked Ribeye Steak as prepared on ticket #1025 — T1', date: '20 May', time: '14:10' },
    { id: '4', message: 'Started preparing ticket #1024 — T3', date: '20 May', time: '13:55' },
    { id: '5', message: 'Bumped ticket #1020 — T7 (Chicken Biryani × 1)', date: '19 May', time: '13:10' },
    { id: '6', message: 'Marked 3 items ready for ticket #1019 — T4', date: '19 May', time: '12:45' },
  ];

  const toggleItemPrepared = async (orderId: string, itemId: string) => {
    const order = orders.find(o => o.id === orderId);
    if (!order || order.status === 'bumped') return;
    const item = order.items.find(i => i.id === itemId);
    if (!item) return;
    const newIsPrepared = !item.isPrepared;

    // Optimistic update
    setOrders(prev =>
      prev.map(o => {
        if (o.id !== orderId) return o;
        const updated = o.items.map(i => (i.id === itemId ? { ...i, isPrepared: newIsPrepared } : i));
        const allDone = updated.every(i => i.isPrepared);
        const anyDone = updated.some(i => i.isPrepared);
        const status: KitchenStatus = allDone ? 'ready' : anyDone ? 'preparing' : 'new';
        return { ...o, items: updated, status };
      }),
    );

    try {
      await kitchen.updateItemStatus(orderId, itemId, newIsPrepared ? 'done' : 'pending');
    } catch {
      await loadOrders();
    }
  };


  const showTopBar = navTab !== 'profile';

  return (
    <View style={[styles.container, { paddingTop: insets.top + Spacing.sm }]}>
      {showTopBar && (
      <View style={styles.topBar}>
        <View style={styles.brandGroup}>
          <Text style={styles.brandTitle}>{staffInfo?.restaurantName ?? 'The Grill Room'}</Text>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: isOnline ? QuinckleColors.success : QuinckleColors.textTertiary }]} />
            <Text style={styles.statusText}>{isOnline ? 'Online' : 'Off-duty'}</Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.avatarBtn}
          onPress={() => setNavTab('profile')}
          activeOpacity={0.7}
        >
          <Image
            source={{ uri: 'https://images.unsplash.com/photo-1577219491135-ce391730fb2c?q=80&w=200&h=200&auto=format&fit=crop' }}
            style={styles.avatarImage}
          />
        </TouchableOpacity>
      </View>
      )}

      {navTab !== 'profile' && (
        <>
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
              const disabled = item.status === 'bumped';
              const preparedCount = item.items.filter((i) => i.isPrepared).length;
              const isUrgent = item.status === 'urgent';

              const cardContent = (
                <View style={[styles.orderCard, disabled && styles.orderCardDimmed, isUrgent && styles.orderCardUrgent]}>
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
                      <View style={[styles.dividerProgressFill, { width: `${(preparedCount / item.items.length) * 100}%` }]} />
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
                        <Text style={[styles.itemLine, entry.isPrepared && styles.itemLineDone]}>{entry.name}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  <View style={styles.cardFooter}>
                    <View />
                    {item.status === 'ready' && <Text style={styles.swipeHint}>Swipe to bump →</Text>}
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
                    onSwipeableOpen={() => { void handleSwipeRemoveReady(item.id); }}
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
                {isLoading && <Text style={styles.emptyText}>Loading tickets…</Text>}
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

          <View style={[styles.bottomNav, { paddingBottom: Math.max(insets.bottom, Spacing.sm) }]}>
            <View style={styles.navRow}>
              <TouchableOpacity style={styles.navBtn} onPress={() => setNavTab('active')} activeOpacity={0.7}>
                <Ionicons name={navTab === 'active' ? 'flame' : 'flame-outline'} size={22} color={navTab === 'active' ? QuinckleColors.primary : QuinckleColors.textTertiary} />
                <Text style={[styles.navLabel, navTab === 'active' && styles.navLabelActive]}>Active</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.navBtn} onPress={() => setNavTab('completed')} activeOpacity={0.7}>
                <Ionicons name={navTab === 'completed' ? 'checkmark-done' : 'checkmark-done-outline'} size={22} color={navTab === 'completed' ? QuinckleColors.primary : QuinckleColors.textTertiary} />
                <Text style={[styles.navLabel, navTab === 'completed' && styles.navLabelActive]}>Completed</Text>
              </TouchableOpacity>
            </View>
          </View>
        </>
      )}

      {navTab === 'profile' && (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.profileContent}>
          <View style={styles.profileHeaderRow}>
            <TouchableOpacity style={styles.iconBtn} onPress={() => setNavTab('active')}>
              <Ionicons name="chevron-back" size={20} color={QuinckleColors.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.screenTitle}>Profile</Text>
            <View style={styles.iconBtnPlaceholder} />
          </View>

          <View style={styles.profileHero}>
            <View style={styles.profileImageContainer}>
              <Image
                source={{ uri: 'https://images.unsplash.com/photo-1577219491135-ce391730fb2c?q=80&w=200&h=200&auto=format&fit=crop' }}
                style={styles.profileImage}
              />
              <View style={styles.uploadBadge}>
                <Ionicons name="camera" size={12} color="#fff" />
              </View>
            </View>
            <Text style={styles.profileName}>{staffInfo?.name ?? 'Kitchen Staff'}</Text>
            <Text style={styles.profilePhone}>{staffInfo?.restaurantName ?? 'The Grill Room'}</Text>
          </View>

          <View style={styles.card}>
            <View style={styles.dutyRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>Duty Status</Text>
                <Text style={styles.cardSubtitle}>{isOnline ? 'Receiving kitchen tickets' : 'Currently off-duty'}</Text>
              </View>
              <TouchableOpacity
                onPress={handleToggleOnline}
                style={[styles.toggleBase, isOnline ? styles.toggleOn : styles.toggleOff]}
              >
                <View style={[styles.toggleCircle, isOnline ? styles.toggleCircleOn : styles.toggleCircleOff]} />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.shiftStatsRow}>
              <View style={styles.shiftStatItem}>
                <Text style={styles.shiftStatLabel}>Today's Hours</Text>
                <Text style={styles.shiftStatValue}>{totalTodayHours}</Text>
              </View>
              <View style={styles.shiftStatDivider} />
              <View style={styles.shiftStatItem}>
                <Text style={styles.shiftStatLabel}>Current Session</Text>
                <Text style={[styles.shiftStatValue, isOnline && { color: QuinckleColors.success }]}>{activeDuration}</Text>
              </View>
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.venueRow}>
              <Image
                source={{ uri: 'https://images.unsplash.com/photo-1544148103-0773bf10d330?q=80&w=100&h=100&auto=format&fit=crop' }}
                style={styles.venueLogo}
              />
              <View style={styles.venueInfo}>
                <Text style={styles.venueLabel}>Linked Restaurant</Text>
                <Text style={styles.venueName}>{staffInfo?.restaurantName ?? 'The Grill Room'}</Text>
                <Text style={styles.venueId}>{staffInfo?.restaurantId?.slice(0, 12).toUpperCase() ?? 'QNK-7782-GR'}</Text>
              </View>
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.perfRow}>
              <View style={styles.perfItem}>
                <Text style={styles.shiftStatLabel}>Tickets Today</Text>
                <Text style={styles.shiftStatValue}>{counts.bumped + counts.active}</Text>
              </View>
              <View style={styles.shiftStatDivider} />
              <View style={styles.perfItem}>
                <Text style={styles.shiftStatLabel}>Completed</Text>
                <Text style={[styles.shiftStatValue, { color: QuinckleColors.success }]}>{counts.bumped}</Text>
              </View>
              <View style={styles.shiftStatDivider} />
              <View style={styles.perfItem}>
                <Text style={styles.shiftStatLabel}>In Progress</Text>
                <Text style={[styles.shiftStatValue, { color: QuinckleColors.warning }]}>{counts.active}</Text>
              </View>
            </View>
          </View>

          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <View>
                <Text style={styles.cardTitle}>Shift Insights</Text>
                <Text style={styles.cardSubtitle}>
                  {shiftPeriod === 'today' ? "Today's session details" : 'Performance this week'}
                </Text>
              </View>
              <View style={styles.periodPicker}>
                <TouchableOpacity
                  onPress={() => setShiftPeriod('today')}
                  style={[styles.periodBtn, shiftPeriod === 'today' && styles.periodBtnActive]}
                >
                  <Text style={[styles.periodBtnText, shiftPeriod === 'today' && styles.periodBtnTextActive]}>Today</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setShiftPeriod('week')}
                  style={[styles.periodBtn, shiftPeriod === 'week' && styles.periodBtnActive]}
                >
                  <Text style={[styles.periodBtnText, shiftPeriod === 'week' && styles.periodBtnTextActive]}>Week</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.weeklyGrid}>
              {chartData.map((data, i) => (
                <View key={i} style={styles.dayColumn}>
                  <View style={styles.dayBarTrack}>
                    <View style={[styles.dayBar, { height: `${data.percentage}%` }, data.isToday ? { backgroundColor: QuinckleColors.primary } : { backgroundColor: QuinckleColors.primarySoftBorder }]} />
                  </View>
                  <Text style={[styles.dayLabel, data.isToday && { color: QuinckleColors.primary, fontWeight: '700' }]}>{data.label}</Text>
                </View>
              ))}
            </View>

            <View style={styles.timingDetails}>
              {shiftPeriod === 'today' ? (
                <View style={styles.todayTiming}>
                  <View style={styles.timingRow}>
                    <Ionicons name="time-outline" size={14} color={QuinckleColors.textTertiary} />
                    <Text style={styles.timingText}>Shift Started: <Text style={styles.timingVal}>
                      {shiftStart ? `${String(shiftStart.getHours()).padStart(2, '0')}:${String(shiftStart.getMinutes()).padStart(2, '0')}` : '--:--'}
                    </Text></Text>
                  </View>
                  <View style={styles.timingRow}>
                    <Ionicons name="flame-outline" size={14} color={QuinckleColors.textTertiary} />
                    <Text style={styles.timingText}>Current Session: <Text style={styles.timingVal}>{activeDuration}</Text></Text>
                  </View>
                  <View style={styles.timingDivider} />
                  <Text style={styles.timingSummary}>
                    {isOnline
                      ? `You are currently ${activeDuration} into your shift. Keep it up!`
                      : 'You are currently off-duty. Your timings will appear here once you go online.'}
                  </Text>
                </View>
              ) : (
                <View style={styles.weekTiming}>
                  {shiftLogs.map((log, idx) => (
                    <View key={idx} style={styles.weekLogItem}>
                      <Text style={styles.weekLogDay}>{log.d}</Text>
                      <Text style={styles.weekLogTime}>{log.t}</Text>
                      <Text style={styles.weekLogHours}>{log.h}h</Text>
                    </View>
                  ))}
                  {isOnline && (
                    <View style={styles.weekLogItem}>
                      <Text style={[styles.weekLogDay, { color: QuinckleColors.primary }]}>Today</Text>
                      <Text style={styles.weekLogTime}>Active Session</Text>
                      <Text style={styles.weekLogHours}>{activeDuration}</Text>
                    </View>
                  )}
                  <View style={styles.weekSubtotal}>
                    <Text style={styles.subtotalLabel}>Weekly Total</Text>
                    <Text style={styles.subtotalVal}>
                      {(shiftLogs.reduce((acc, l) => acc + l.h, 0) + (isOnline && shiftStart ? (Date.now() - shiftStart.getTime()) / (1000 * 60 * 60) : 0)).toFixed(1)} Hours
                    </Text>
                  </View>
                </View>
              )}
            </View>
          </View>

          <View style={styles.card}>
            <Text style={[styles.cardTitle, { marginBottom: Spacing.md }]}>Kitchen Activity</Text>
            {COOK_ACTIVITY.map((item) => (
              <View key={item.id} style={styles.activityItem}>
                <Text style={styles.activityMessage}>{item.message}</Text>
                <View style={styles.activityMeta}>
                  <Text style={styles.activityDate}>{item.date}</Text>
                  <Text style={styles.activityDot}>·</Text>
                  <Text style={styles.activityTime}>{item.time}</Text>
                </View>
              </View>
            ))}
          </View>

          <Text style={styles.adminText}>
            Contact your restaurant administrator to update profile details.
          </Text>

          <TouchableOpacity
            style={styles.logoutBtn}
            onPress={handleLogout}
            activeOpacity={0.7}
          >
            <Ionicons name="log-out-outline" size={18} color={QuinckleColors.danger} />
            <Text style={styles.logoutBtnText}>Log Out</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
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

  profileContent: {
    paddingBottom: Spacing.huge,
  },
  profileHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.xl,
    paddingVertical: Spacing.sm,
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
  iconBtnPlaceholder: {
    width: 40,
    height: 40,
  },
  screenTitle: {
    color: QuinckleColors.textPrimary,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  profileHero: {
    alignItems: 'center',
    marginBottom: Spacing.xxl,
  },
  profileImageContainer: {
    width: 92,
    height: 92,
    borderRadius: 46,
    marginBottom: Spacing.md,
    position: 'relative',
  },
  profileImage: {
    width: '100%',
    height: '100%',
    borderRadius: 46,
    borderWidth: 2,
    borderColor: QuinckleColors.border,
  },
  uploadBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: QuinckleColors.primary,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: QuinckleColors.background,
  },
  profileName: {
    color: QuinckleColors.textPrimary,
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  profilePhone: {
    color: QuinckleColors.textSecondary,
    fontSize: 13,
    fontWeight: '500',
    marginTop: 4,
  },
  card: {
    backgroundColor: QuinckleColors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
  },
  cardTitle: {
    color: QuinckleColors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  cardSubtitle: {
    color: QuinckleColors.textTertiary,
    fontSize: 12,
    marginTop: 2,
  },
  dutyRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  toggleBase: {
    width: 44,
    height: 26,
    borderRadius: 13,
    padding: 3,
    justifyContent: 'center',
  },
  toggleOn: {
    backgroundColor: QuinckleColors.success,
  },
  toggleOff: {
    backgroundColor: QuinckleColors.surfaceMutedHover,
  },
  toggleCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  toggleCircleOn: {
    alignSelf: 'flex-end',
  },
  toggleCircleOff: {
    alignSelf: 'flex-start',
  },
  shiftStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  shiftStatItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  shiftStatDivider: {
    width: 1,
    height: 30,
    backgroundColor: QuinckleColors.border,
    marginHorizontal: Spacing.md,
  },
  shiftStatLabel: {
    color: QuinckleColors.textTertiary,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  shiftStatValue: {
    color: QuinckleColors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  venueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  venueLogo: {
    width: 50,
    height: 50,
    borderRadius: Radius.sm,
    backgroundColor: QuinckleColors.surfaceMuted,
  },
  venueInfo: {
    flex: 1,
    gap: 2,
  },
  venueLabel: {
    color: QuinckleColors.textTertiary,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  venueName: {
    color: QuinckleColors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  venueId: {
    color: QuinckleColors.textTertiary,
    fontSize: 12,
    fontWeight: '500',
  },
  perfRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  perfItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  periodPicker: {
    flexDirection: 'row',
    backgroundColor: QuinckleColors.surfaceMuted,
    borderRadius: Radius.sm,
    padding: 3,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
  },
  periodBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radius.xs,
  },
  periodBtnActive: {
    backgroundColor: QuinckleColors.surface,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  periodBtnText: {
    fontSize: 10,
    fontWeight: '600',
    color: QuinckleColors.textTertiary,
  },
  periodBtnTextActive: {
    color: QuinckleColors.primary,
  },
  weeklyGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    height: 100,
    marginTop: Spacing.lg,
    paddingHorizontal: Spacing.sm,
  },
  dayColumn: {
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  dayBarTrack: {
    width: 6,
    height: 70,
    backgroundColor: QuinckleColors.surfaceMuted,
    borderRadius: 3,
    justifyContent: 'flex-end',
  },
  dayBar: {
    width: '100%',
    borderRadius: 3,
  },
  dayLabel: {
    color: QuinckleColors.textTertiary,
    fontSize: 10,
    fontWeight: '600',
  },
  timingDetails: {
    marginTop: Spacing.xl,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: QuinckleColors.borderSubtle,
  },
  todayTiming: {
    gap: 10,
  },
  timingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  timingText: {
    color: QuinckleColors.textSecondary,
    fontSize: 13,
  },
  timingVal: {
    color: QuinckleColors.textPrimary,
    fontWeight: '600',
  },
  timingDivider: {
    height: 1,
    backgroundColor: QuinckleColors.borderSubtle,
    marginVertical: 4,
  },
  timingSummary: {
    color: QuinckleColors.textTertiary,
    fontSize: 12,
    lineHeight: 18,
  },
  weekTiming: {
    gap: 12,
  },
  weekLogItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  weekLogDay: {
    width: 45,
    fontSize: 12,
    fontWeight: '600',
    color: QuinckleColors.textSecondary,
  },
  weekLogTime: {
    flex: 1,
    fontSize: 12,
    color: QuinckleColors.textTertiary,
    textAlign: 'center',
  },
  weekLogHours: {
    width: 50,
    fontSize: 12,
    fontWeight: '700',
    color: QuinckleColors.textPrimary,
    textAlign: 'right',
  },
  weekSubtotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: QuinckleColors.borderSubtle,
  },
  subtotalLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: QuinckleColors.textPrimary,
  },
  subtotalVal: {
    fontSize: 15,
    fontWeight: '800',
    color: QuinckleColors.primary,
  },
  activityItem: {
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: QuinckleColors.borderSubtle,
    gap: 4,
  },
  activityMessage: {
    color: QuinckleColors.textPrimary,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
  activityMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  activityDate: {
    color: QuinckleColors.textTertiary,
    fontSize: 11,
    fontWeight: '500',
  },
  activityDot: {
    color: QuinckleColors.textMuted,
    fontSize: 11,
  },
  activityTime: {
    color: QuinckleColors.textTertiary,
    fontSize: 11,
    fontWeight: '500',
  },
  adminText: {
    color: QuinckleColors.textTertiary,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    marginTop: Spacing.xl,
    paddingHorizontal: Spacing.lg,
  },
  logoutBtn: {
    marginTop: Spacing.xxl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: QuinckleColors.dangerBorder,
    backgroundColor: QuinckleColors.dangerSoft,
  },
  logoutBtnText: {
    color: QuinckleColors.danger,
    fontSize: 14,
    fontWeight: '600',
  },
});
