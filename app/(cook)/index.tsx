import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Audio } from 'expo-av';
import { kitchen } from '../../services/api';
import { subscribeChannel } from '../../services/realtime';

async function playSound(file: any) {
  try {
    await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
    const { sound } = await Audio.Sound.createAsync(file);
    await sound.playAsync();
    sound.setOnPlaybackStatusUpdate(s => {
      if (s.isLoaded && s.didJustFinish) sound.unloadAsync();
    });
  } catch { /* non-fatal */ }
}
import {
  Animated,
  Easing,
  FlatList,
  LayoutAnimation,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  UIManager,
  View,
  Image,
} from 'react-native';
import { PICKUP_LAYOUT_PRESET } from '../../components/ui/pickup';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const READY_FADE_DELAY = 700; // give the cook a beat to see the card go full-ready before it slides out
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { ThemedDialog } from '../../components/ui/themed-dialog';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';
import { useAuth } from '../../context/AuthContext';

type KitchenStatus = 'new' | 'urgent' | 'preparing' | 'ready' | 'bumped';
type KitchenOrderItem = { id: string; name: string; modifiersSummary?: string | null; isPrepared: boolean };

type KitchenOrder = {
  id: string;
  table: string;
  location: string;
  orderedAgo: string;
  placedAt?: string;
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

/* ───────────── Kitchen order card ─────────────
 * Extracted so each card has its own lifecycle hooks for entry/exit
 * animation. Cards in the Completed tab slide in from the right; the
 * READY banner inside an active card softly fades + rises on appearance
 * instead of popping in. Matches the staff Orders page feel.
 */
type KitchenCardProps = {
  item: KitchenOrder;
  index: number;
  onTogglePrepared: (itemId: string) => void;
  isCompletedTab: boolean;
};

function KitchenOrderCard({ item, index, onTogglePrepared, isCompletedTab }: KitchenCardProps) {
  const disabled = item.status === 'bumped';
  const preparedCount = item.items.filter((i) => i.isPrepared).length;
  const isUrgent = item.status === 'urgent';

  // Entry animation when this card mounts into the Completed tab.
  const entryTranslate = useRef(new Animated.Value(isCompletedTab ? 24 : 0)).current;
  const entryOpacity = useRef(new Animated.Value(isCompletedTab ? 0 : 1)).current;
  useEffect(() => {
    if (!isCompletedTab) return;
    Animated.parallel([
      Animated.timing(entryTranslate, {
        toValue: 0,
        duration: 320,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(entryOpacity, {
        toValue: 1,
        duration: 320,
        useNativeDriver: true,
      }),
    ]).start();
    // run-once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // READY banner: soft slide-up + fade when status flips to 'ready'
  const bannerTranslate = useRef(new Animated.Value(item.status === 'ready' ? 0 : 8)).current;
  const bannerOpacity = useRef(new Animated.Value(item.status === 'ready' ? 1 : 0)).current;
  useEffect(() => {
    if (item.status !== 'ready') return;
    bannerTranslate.setValue(8);
    bannerOpacity.setValue(0);
    Animated.parallel([
      Animated.spring(bannerTranslate, {
        toValue: 0,
        friction: 7,
        tension: 100,
        useNativeDriver: true,
      }),
      Animated.timing(bannerOpacity, {
        toValue: 1,
        duration: 260,
        useNativeDriver: true,
      }),
    ]).start();
  }, [item.status, bannerTranslate, bannerOpacity]);

  return (
    <Animated.View
      style={[
        styles.orderCard,
        disabled && styles.orderCardDimmed,
        isUrgent && styles.orderCardUrgent,
        {
          opacity: entryOpacity,
          transform: [{ translateX: entryTranslate }],
        },
      ]}
    >
      <View style={styles.cardTopRow}>
        <View>
          <View style={styles.ticketRow}>
            <Text style={styles.ticketId}>#{index}</Text>
            <View style={styles.tableTag}>
              <Text style={styles.tableTagText}>{item.table}</Text>
            </View>
          </View>
          <Text style={styles.placedAtLine}>
            {item.placedAt
              ? `${new Date(item.placedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${item.orderedAgo}`
              : item.orderedAgo}
          </Text>
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
            onPress={() => onTogglePrepared(entry.id)}
            activeOpacity={0.7}
            disabled={disabled}
          >
            <View style={[styles.checkbox, entry.isPrepared && styles.checkboxChecked]}>
              {entry.isPrepared && <Ionicons name="checkmark" size={13} color="#fff" />}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.itemLine, entry.isPrepared && styles.itemLineDone]}>{entry.name}</Text>
              {entry.modifiersSummary ? (
                <Text style={styles.itemModifiers}>{entry.modifiersSummary}</Text>
              ) : null}
            </View>
          </TouchableOpacity>
        ))}
      </View>

      {item.status === 'ready' && (
        <Animated.View
          style={[
            styles.readyBanner,
            {
              opacity: bannerOpacity,
              transform: [{ translateY: bannerTranslate }],
            },
          ]}
        >
          <Ionicons name="checkmark-circle" size={16} color={QuinckleColors.success} />
          <Text style={styles.readyBannerText}>Ready · sending out</Text>
        </Animated.View>
      )}
    </Animated.View>
  );
}

export default function CookDashboard() {
  const insets = useSafeAreaInsets();
  const { logout, staffInfo } = useAuth();
  const knownOrderIdsRef = useRef<Set<string>>(new Set());
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [bumpedOrders, setBumpedOrders] = useState<KitchenOrder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchText, setSearchText] = useState('');
  const [navTab, setNavTab] = useState<'active' | 'completed'>('active');

  const handleLogout = () => {
    logout();
    router.replace('/login');
  };

  const mapTicket = (t: any, statusOverride?: KitchenStatus): KitchenOrder => {
    const allDone = t.items.every((i: any) => i.item_status === 'done');
    const anyDone = t.items.some((i: any) => i.item_status === 'done');
    const status: KitchenStatus =
      statusOverride ?? (allDone ? 'ready' : anyDone ? 'preparing' : 'new');
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
      placedAt: t.placed_at,
      priority: 'normal' as const,
      items: t.items.map((item: any) => ({
        id: item.item_id,
        name: `${item.qty}× ${item.name}${item.note ? ` — ${item.note}` : ''}`,
        modifiersSummary: item.modifiers_summary ?? null,
        isPrepared: item.item_status === 'done',
      })),
      status,
    };
  };

  const loadOrders = useCallback(async () => {
    try {
      // Fetch active + completed in parallel so the Completed tab is always populated.
      const [activeRes, completedRes] = await Promise.all([
        kitchen.getOrders() as Promise<any>,
        kitchen.getCompleted().catch(() => ({ tickets: [] })) as Promise<any>,
      ]);
      const tickets: any[] = activeRes?.tickets ?? [];

      // Play kitchen sound for brand-new orders
      const incomingIds = new Set(tickets.map((t: any) => t.order_id as string));
      const hasNew = tickets.some((t: any) => !knownOrderIdsRef.current.has(t.order_id));
      if (hasNew && knownOrderIdsRef.current.size > 0) {
        void playSound(require('../../assets/audio/notifications/kitchen notification.wav'));
      }
      knownOrderIdsRef.current = incomingIds;

      setOrders(tickets.map((t) => mapTicket(t)));

      const completedTickets: any[] = completedRes?.tickets ?? [];
      setBumpedOrders(completedTickets.map((t) => mapTicket(t, 'bumped' as KitchenStatus)));
    } catch {
      // keep existing orders on network error; don't fall back to mock data
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load once on mount — Ably drives all subsequent updates
  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  // Ably: kitchen:{restaurantId} — pure push, no polling
  useEffect(() => {
    const restaurantId = staffInfo?.restaurantId;
    if (!restaurantId) return;

    // new_order → play sound + refresh queue
    const unsubNew = subscribeChannel(`kitchen:${restaurantId}`, 'new_order', (data: any) => {
      const orderId = data?.orderId as string | undefined;
      if (orderId && !knownOrderIdsRef.current.has(orderId)) {
        knownOrderIdsRef.current.add(orderId);
        void playSound(require('../../assets/audio/notifications/kitchen notification.wav'));
      }
      void loadOrders();
    });

    // item_bumped → refresh so item status updates in kitchen view
    const unsubBumped = subscribeChannel(`kitchen:${restaurantId}`, 'item_bumped', () => {
      void loadOrders();
    });

    // order_cancelled → remove from queue immediately
    const unsubCancelled = subscribeChannel(`kitchen:${restaurantId}`, 'order_cancelled', () => {
      void loadOrders();
    });

    return () => { unsubNew(); unsubBumped(); unsubCancelled(); };
  }, [staffInfo?.restaurantId, loadOrders]);

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

  // Backend auto-bumps the order to READY when the last item flips to done.
  // We mirror that locally: after a short visual pause so the cook sees the
  // card go full-ready, animate-move it from Active → Completed.
  const sweepReadyOrderToCompleted = (id: string) => {
    setTimeout(() => {
      // Same buttery preset as the staff Orders page: card fades fast,
      // neighbors spring upward into the empty slot with soft damping.
      LayoutAnimation.configureNext(PICKUP_LAYOUT_PRESET);
      setOrders(prev => {
        const order = prev.find(o => o.id === id);
        if (!order) return prev;
        setBumpedOrders(b => [{ ...order, status: 'bumped' as KitchenStatus }, ...b]);
        return prev.filter(o => o.id !== id);
      });
    }, READY_FADE_DELAY);
  };

  // Real-time activity feed — backed by realtime events emitted by the
  // kitchen/queue routes. Starts empty; entries are pushed as the cook
  // bumps tickets / marks items in this session. Previously hard-coded
  // demo data here.
  const COOK_ACTIVITY: Array<{ id: string; message: string; date: string; time: string }> = [];

  const toggleItemPrepared = async (orderId: string, itemId: string) => {
    const order = orders.find(o => o.id === orderId);
    if (!order || order.status === 'bumped') return;
    const item = order.items.find(i => i.id === itemId);
    if (!item) return;
    const newIsPrepared = !item.isPrepared;

    let becameFullyReady = false;

    // Optimistic update
    setOrders(prev =>
      prev.map(o => {
        if (o.id !== orderId) return o;
        const updated = o.items.map(i => (i.id === itemId ? { ...i, isPrepared: newIsPrepared } : i));
        const allDone = updated.every(i => i.isPrepared);
        const anyDone = updated.some(i => i.isPrepared);
        const status: KitchenStatus = allDone ? 'ready' : anyDone ? 'preparing' : 'new';
        if (allDone && o.status !== 'ready') becameFullyReady = true;
        return { ...o, items: updated, status };
      }),
    );

    if (becameFullyReady) sweepReadyOrderToCompleted(orderId);

    try {
      await kitchen.updateItemStatus(orderId, itemId, newIsPrepared ? 'done' : 'pending');
    } catch {
      await loadOrders();
    }
  };


  const showTopBar = true;

  return (
    <View style={[styles.container, { paddingTop: insets.top + Spacing.sm }]}>
      {showTopBar && (
      <View style={styles.topBar}>
        <View style={styles.brandGroup}>
          <Text style={styles.brandTitle}>{staffInfo?.restaurantName ?? 'The Grill Room'}</Text>
          <View style={styles.roleBadge}>
            <Text style={styles.roleBadgeText}>Kitchen</Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.avatarBtn}
          onPress={() => router.push('/(cook)/profile')}
          activeOpacity={0.7}
        >
          <Image
            source={{ uri: 'https://images.unsplash.com/photo-1577219491135-ce391730fb2c?q=80&w=200&h=200&auto=format&fit=crop' }}
            style={styles.avatarImage}
          />
        </TouchableOpacity>
      </View>
      )}

      {(
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
            renderItem={({ item, index }) => (
              <KitchenOrderCard
                item={item}
                index={navTab === 'completed' ? bumpedOrders.indexOf(item) + 1 : index + 1}
                onTogglePrepared={(itemId) => toggleItemPrepared(item.id, itemId)}
                isCompletedTab={navTab === 'completed'}
              />
            )}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Ionicons name="restaurant-outline" size={28} color={QuinckleColors.textTertiary} />
                {isLoading && <Text style={styles.emptyText}>Loading tickets…</Text>}
                <Text style={styles.emptyText}>No tickets in this queue.</Text>
              </View>
            }
          />

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
  roleBadge: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(167, 139, 250, 0.4)',
  },
  roleBadgeText: {
    color: '#C4B5FD',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
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
  placedAtLine: {
    color: QuinckleColors.textTertiary,
    fontSize: 11,
    fontWeight: '500',
    marginTop: 4,
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
    width: 22,
    height: 22,
    borderRadius: 11,
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
  },
  itemLineDone: {
    color: QuinckleColors.textTertiary,
    textDecorationLine: 'line-through',
  },
  itemModifiers: {
    color: QuinckleColors.textTertiary,
    fontSize: 11,
    fontStyle: 'italic',
    marginTop: 1,
  },

  readyBanner: {
    marginTop: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: Radius.md,
    backgroundColor: 'rgba(34, 197, 94, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.35)',
  },
  readyBannerText: {
    color: QuinckleColors.success,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
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
  profileBody: {
    paddingHorizontal: Spacing.lg,
    marginTop: Spacing.lg,
  },
  kitchenBanner: {
    width: '100%',
    height: 320,
    position: 'relative',
    backgroundColor: '#111',
  },
  kitchenBannerImage: {
    width: '100%',
    height: '100%',
  },
  bannerBackBtn: {
    position: 'absolute',
    left: Spacing.lg,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerTextWrap: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    bottom: Spacing.lg,
    gap: 8,
  },
  bannerRoleBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: 'rgba(139, 92, 246, 0.25)',
    borderWidth: 1,
    borderColor: 'rgba(167, 139, 250, 0.55)',
  },
  bannerRoleBadgeText: {
    color: '#E9D5FF',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  bannerRestaurantName: {
    color: '#fff',
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.4,
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
    borderRadius: 4,
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
