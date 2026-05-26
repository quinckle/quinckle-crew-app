/**
 * Cook Dashboard — polished kitchen view.
 *
 * Behaviour is unchanged from the previous implementation: same data flow,
 * same Ably wiring, same auto-bump-on-last-item logic. This file owns the
 * page chrome (top bar, header line, search, list, bottom nav) and delegates
 * the actual ticket UI to <KitchenTicketCard> + <KitchenSkeleton>.
 */

import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Audio } from 'expo-av';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  LayoutAnimation,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  UIManager,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { kitchen, printerApi } from '../../services/api';
import { subscribeChannel, watchConnection } from '../../services/realtime';
import { printKot, getStatus as getPrinterStatus } from '../../services/printer';
import { useAuth } from '../../context/AuthContext';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';
import { PICKUP_LAYOUT_PRESET } from '../../components/ui/pickup';
import { BottomNavbar, type BottomNavTab } from '../../components/ui/BottomNavbar';
import {
  KitchenTicketCard,
  type KitchenTicket,
} from '../../components/ui/KitchenTicketCard';
import { KitchenSkeleton } from '../../components/ui/KitchenSkeleton';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const READY_FADE_DELAY = 700;

async function playSound(file: any) {
  try {
    await Audio.setAudioModeAsync({ playsInSilentModeIOS: true });
    const { sound } = await Audio.Sound.createAsync(file);
    await sound.playAsync();
    sound.setOnPlaybackStatusUpdate((s) => {
      if (s.isLoaded && s.didJustFinish) sound.unloadAsync();
    });
  } catch {
    /* non-fatal */
  }
}

type CookTab = 'active' | 'completed';

const COOK_NAV_TABS: BottomNavTab<CookTab>[] = [
  { key: 'active',    label: 'Active',    icon: 'flame-outline',          iconActive: 'flame' },
  { key: 'completed', label: 'Completed', icon: 'checkmark-done-outline', iconActive: 'checkmark-done' },
];

function getInitials(name: string | undefined | null): string {
  if (!name) return 'C';
  return name
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export default function CookDashboard() {
  const insets = useSafeAreaInsets();
  const { staffInfo } = useAuth();
  const knownOrderIdsRef = useRef<Set<string>>(new Set());

  const [orders,        setOrders]        = useState<KitchenTicket[]>([]);
  const [bumpedOrders,  setBumpedOrders]  = useState<KitchenTicket[]>([]);
  const [isLoading,     setIsLoading]     = useState(true);
  const [searchText,    setSearchText]    = useState('');
  const [navTab,        setNavTab]        = useState<CookTab>('active');
  const [realtimeOk,    setRealtimeOk]    = useState(true);

  // ── Data mapping (unchanged) ─────────────────────────────────────────────
  const mapTicket = (t: any, statusOverride?: KitchenTicket['status']): KitchenTicket => {
    const allDone = t.items.every((i: any) => i.item_status === 'done');
    const anyDone = t.items.some((i: any) => i.item_status === 'done');
    const status: KitchenTicket['status'] =
      statusOverride ?? (allDone ? 'ready' : anyDone ? 'preparing' : 'new');
    return {
      id:       t.order_id,
      table:    `T${t.table_number}`,
      location: '',
      placedAt: t.placed_at,
      status,
      items: t.items.map((item: any) => ({
        id:               item.item_id,
        name:             `${item.qty}× ${item.name}${item.note ? ` — ${item.note}` : ''}`,
        modifiersSummary: item.modifiers_summary ?? null,
        isPrepared:       item.item_status === 'done',
      })),
    };
  };

  const loadOrders = useCallback(async () => {
    try {
      const [activeRes, completedRes] = await Promise.all([
        kitchen.getOrders() as Promise<any>,
        kitchen.getCompleted().catch(() => ({ tickets: [] })) as Promise<any>,
      ]);
      const tickets: any[] = activeRes?.tickets ?? [];

      const incomingIds = new Set(tickets.map((t: any) => t.order_id as string));
      const hasNew = tickets.some((t: any) => !knownOrderIdsRef.current.has(t.order_id));
      if (hasNew && knownOrderIdsRef.current.size > 0) {
        void playSound(require('../../assets/audio/notifications/kitchen notification.wav'));
      }
      knownOrderIdsRef.current = incomingIds;

      setOrders(tickets.map((t) => mapTicket(t)));
      const completedTickets: any[] = completedRes?.tickets ?? [];
      setBumpedOrders(completedTickets.map((t) => mapTicket(t, 'bumped')));
    } catch {
      // keep existing data on network error
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  // Ably: realtime push for the kitchen channel
  useEffect(() => {
    const restaurantId = staffInfo?.restaurantId;
    if (!restaurantId) return;

    const unsubNew = subscribeChannel(`kitchen:${restaurantId}`, 'new_order', (data: any) => {
      const orderId = data?.orderId as string | undefined;
      if (orderId && !knownOrderIdsRef.current.has(orderId)) {
        knownOrderIdsRef.current.add(orderId);
        void playSound(require('../../assets/audio/notifications/kitchen notification.wav'));
      }
      void loadOrders();

      // ── Auto-print: fires on ANY device that has a printer locally paired ──
      // The backend NewOrderEvent doesn't carry printerPairedTo, so we rely on
      // local printer state. A physical BT printer can only connect to one
      // device, so only one phone will actually succeed; duplicate acks are
      // idempotent on the backend (kotPrintedAt only stamps on first success).
      if (getPrinterStatus() === 'connected') {
        // items come directly from the NewOrderEvent shape
        const items = (data?.items ?? []).map((i: any) => ({
          name: i.menuItemName ?? i.name ?? '',
          quantity: i.quantity,
          notes: i.notes,
          modifiersSummary: i.modifiersSummary ?? undefined,
          category: i.category ?? undefined,
        }));
        if (data?.orderId && items.length > 0) {
          void printKot({
            id: data.orderId,
            orderNumber: data.orderNumber != null ? String(data.orderNumber) : undefined,
            tableNumber: String(data.tableNumber ?? '?'),
            restaurantName: staffInfo?.restaurantName ?? '',
            createdAt: data.createdAt ?? new Date().toISOString(),
            items,
            isAddOn: false,
          }, false);
        }
      }
    });
    const unsubBumped    = subscribeChannel(`kitchen:${restaurantId}`, 'item_bumped',     () => void loadOrders());
    const unsubCancelled = subscribeChannel(`kitchen:${restaurantId}`, 'order_cancelled', () => void loadOrders());

    // Reprint request — fires on any device with printer connected
    const unsubReprint = subscribeChannel(`partner:${restaurantId}`, 'reprint_request', (data: any) => {
      if (getPrinterStatus() === 'connected' && data?.order) {
        const items = (data.order.items ?? []).map((i: any) => ({
          name: i.name ?? i.menuItemName ?? '',
          quantity: i.quantity,
          notes: i.notes,
          modifiersSummary: i.modifiersSummary ?? undefined,
          category: i.category ?? undefined,
        }));
        void printKot({
          id: data.order.id,
          tableNumber: String(data.order.tableNumber ?? '?'),
          restaurantName: staffInfo?.restaurantName ?? '',
          createdAt: data.order.createdAt ?? new Date().toISOString(),
          items,
          isAddOn: false,
        }, false);
      }
    });

    return () => {
      unsubNew();
      unsubBumped();
      unsubCancelled();
      unsubReprint();
    };
  }, [staffInfo?.restaurantId, loadOrders]);

  // Connection indicator — same pattern as staff
  useEffect(() => {
    const restaurantId = staffInfo?.restaurantId;
    if (!restaurantId) return;
    return watchConnection(`kitchen:${restaurantId}`, (connected) => setRealtimeOk(connected));
  }, [staffInfo?.restaurantId]);

  const counts = useMemo(
    () => ({
      active:    orders.length,
      ready:     orders.filter((o) => o.status === 'ready').length,
      completed: bumpedOrders.length,
    }),
    [orders, bumpedOrders],
  );

  const filteredOrders = useMemo(() => {
    const source = navTab === 'completed' ? bumpedOrders : orders;
    const query = searchText.trim().toLowerCase();
    if (!query) return source;
    return source.filter((order) => {
      const blob = `${order.id} ${order.table} ${order.location} ${order.items
        .map((i) => i.name)
        .join(' ')}`.toLowerCase();
      return blob.includes(query);
    });
  }, [orders, bumpedOrders, searchText, navTab]);

  // Auto-bump to Completed when the last item flips to done — unchanged
  const sweepReadyOrderToCompleted = (id: string) => {
    setTimeout(() => {
      LayoutAnimation.configureNext(PICKUP_LAYOUT_PRESET);
      setOrders((prev) => {
        const order = prev.find((o) => o.id === id);
        if (!order) return prev;
        setBumpedOrders((b) => [{ ...order, status: 'bumped' as const }, ...b]);
        return prev.filter((o) => o.id !== id);
      });
    }, READY_FADE_DELAY);
  };

  const toggleItemPrepared = async (orderId: string, itemId: string) => {
    const order = orders.find((o) => o.id === orderId);
    if (!order || order.status === 'bumped') return;
    const item = order.items.find((i) => i.id === itemId);
    if (!item) return;
    const newIsPrepared = !item.isPrepared;

    let becameFullyReady = false;

    setOrders((prev) =>
      prev.map((o) => {
        if (o.id !== orderId) return o;
        const updated = o.items.map((i) =>
          i.id === itemId ? { ...i, isPrepared: newIsPrepared } : i,
        );
        const allDone = updated.every((i) => i.isPrepared);
        const anyDone = updated.some((i) => i.isPrepared);
        const status: KitchenTicket['status'] = allDone ? 'ready' : anyDone ? 'preparing' : 'new';
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

  // ── Header line: "5 cooking · 2 ready" / "12 completed today" ───────────
  const headerLine = useMemo(() => {
    if (navTab === 'completed') {
      return counts.completed === 1
        ? '1 completed today'
        : `${counts.completed} completed today`;
    }
    if (counts.active === 0) return 'No active tickets';
    const cooking = counts.active - counts.ready;
    const parts: string[] = [];
    if (cooking > 0) parts.push(`${cooking} cooking`);
    if (counts.ready > 0) parts.push(`${counts.ready} ready`);
    return parts.join(' · ');
  }, [navTab, counts]);

  return (
    <View style={[styles.container, { paddingTop: insets.top + Spacing.sm }]}>
      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <View style={styles.topBar}>
        <View style={styles.brandGroup}>
          <Text style={styles.brandTitle}>{staffInfo?.restaurantName ?? 'The Grill Room'}</Text>
          <View style={styles.badgeRow}>
            <View style={styles.roleBadge}>
              <Text style={styles.roleBadgeText}>Kitchen</Text>
            </View>
            {!realtimeOk && (
              <View style={styles.statusRow}>
                <View style={[styles.statusDot, { backgroundColor: QuinckleColors.warning }]} />
                <Text style={styles.statusText}>No live updates</Text>
              </View>
            )}
          </View>
        </View>

        <TouchableOpacity
          style={styles.avatarBtn}
          onPress={() => router.push('/(cook)/profile')}
          activeOpacity={0.7}
        >
          {staffInfo?.photoUrl ? (
            <Image source={{ uri: staffInfo.photoUrl }} style={styles.avatarImage} />
          ) : (
            <View style={styles.avatarFallback}>
              <Text style={styles.avatarFallbackText}>{getInitials(staffInfo?.name)}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* ── Section header line ────────────────────────────────────────── */}
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionEyebrow}>
          {navTab === 'active' ? 'Queue' : 'History'}
        </Text>
        <Text style={styles.sectionTitle}>{headerLine}</Text>
      </View>

      {/* ── Search ──────────────────────────────────────────────────────── */}
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

      {/* ── List / Skeleton / Empty state ──────────────────────────────── */}
      {isLoading && filteredOrders.length === 0 ? (
        <View style={{ paddingHorizontal: Spacing.lg }}>
          <KitchenSkeleton />
        </View>
      ) : (
        <FlatList
          data={filteredOrders}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: insets.bottom + 80 },
          ]}
          ItemSeparatorComponent={() => <View style={{ height: Spacing.md }} />}
          renderItem={({ item, index }) => (
            <KitchenTicketCard
              ticket={item}
              index={
                navTab === 'completed'
                  ? bumpedOrders.indexOf(item) + 1
                  : index + 1
              }
              onTogglePrepared={(itemId) => toggleItemPrepared(item.id, itemId)}
              isCompletedTab={navTab === 'completed'}
              onReprint={getPrinterStatus() === 'connected' ? () => {
                void printerApi.reprint(item.id, 'Manual reprint from cook screen');
              } : undefined}
            />
          )}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <View style={styles.emptyIconWrap}>
                <Ionicons
                  name={
                    navTab === 'active'
                      ? 'restaurant-outline'
                      : 'time-outline'
                  }
                  size={32}
                  color={QuinckleColors.textTertiary}
                />
              </View>
              <Text style={styles.emptyTitle}>
                {navTab === 'active'
                  ? 'All caught up'
                  : 'Nothing completed yet'}
              </Text>
              <Text style={styles.emptySubtitle}>
                {navTab === 'active'
                  ? 'New tickets will appear here as they come in.'
                  : 'Bumped tickets show up here for the rest of the day.'}
              </Text>
            </View>
          }
        />
      )}

      {/* ── Bottom nav (shared component) ──────────────────────────────── */}
      <BottomNavbar<CookTab>
        activeTab={navTab}
        onTabChange={setNavTab}
        tabs={COOK_NAV_TABS}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex:            1,
    backgroundColor: QuinckleColors.background,
    paddingHorizontal: Spacing.lg,
  },

  // ── Top bar ────────────────────────────────────────────────────────────
  topBar: {
    flexDirection:  'row',
    alignItems:     'center',
    justifyContent: 'space-between',
    marginBottom:   Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  brandGroup: {
    flex: 1,
    gap:  6,
  },
  brandTitle: {
    color:          QuinckleColors.textPrimary,
    fontSize:       22,
    fontWeight:     '700',
    letterSpacing:  -0.4,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           Spacing.sm,
  },
  roleBadge: {
    alignSelf:        'flex-start',
    paddingHorizontal: 8,
    paddingVertical:   2,
    borderRadius:      6,
    backgroundColor:   'rgba(139, 92, 246, 0.15)',
    borderWidth:       1,
    borderColor:       'rgba(167, 139, 250, 0.4)',
  },
  roleBadgeText: {
    color:          '#C4B5FD',
    fontSize:       11,
    fontWeight:     '600',
    letterSpacing:  0.4,
    textTransform:  'uppercase',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           4,
  },
  statusDot: {
    width:        6,
    height:       6,
    borderRadius: 3,
  },
  statusText: {
    color:      QuinckleColors.warning,
    fontSize:   11,
    fontWeight: '500',
  },
  avatarBtn: {
    width:        36,
    height:       36,
    borderRadius: 18,
    borderWidth:  1.5,
    borderColor:  QuinckleColors.border,
    overflow:     'hidden',
  },
  avatarImage: {
    width:  '100%',
    height: '100%',
  },
  avatarFallback: {
    width:           '100%',
    height:          '100%',
    backgroundColor: QuinckleColors.primary,
    alignItems:      'center',
    justifyContent:  'center',
  },
  avatarFallbackText: {
    color:      '#fff',
    fontWeight: '700',
    fontSize:   14,
  },

  // ── Section header line ───────────────────────────────────────────────
  sectionHeader: {
    paddingHorizontal: 4,
    marginBottom:      Spacing.md,
  },
  sectionEyebrow: {
    color:          QuinckleColors.primary,
    fontSize:       10,
    fontWeight:     '800',
    letterSpacing:  1.2,
    textTransform:  'uppercase',
    marginBottom:   2,
  },
  sectionTitle: {
    color:          QuinckleColors.textPrimary,
    fontSize:       18,
    fontWeight:     '700',
    letterSpacing:  -0.3,
  },

  // ── Search ────────────────────────────────────────────────────────────
  searchWrap: {
    flexDirection:    'row',
    alignItems:       'center',
    backgroundColor:  QuinckleColors.surfaceMuted,
    borderColor:      QuinckleColors.border,
    borderWidth:      1,
    borderRadius:     Radius.md,
    paddingHorizontal: Spacing.md,
    height:           42,
    gap:              Spacing.sm,
    marginBottom:     Spacing.md,
  },
  searchInput: {
    flex:     1,
    color:    QuinckleColors.textPrimary,
    fontSize: 14,
  },

  // ── List ──────────────────────────────────────────────────────────────
  listContent: {
    paddingHorizontal: 0,
  },

  // ── Empty state ───────────────────────────────────────────────────────
  emptyState: {
    paddingVertical:  Spacing.huge,
    alignItems:       'center',
    gap:              Spacing.sm,
  },
  emptyIconWrap: {
    width:           54,
    height:          54,
    borderRadius:    27,
    backgroundColor: QuinckleColors.surfaceMuted,
    borderWidth:     1,
    borderColor:     QuinckleColors.border,
    alignItems:      'center',
    justifyContent:  'center',
    marginBottom:    Spacing.xs,
  },
  emptyTitle: {
    color:          QuinckleColors.textPrimary,
    fontSize:       15,
    fontWeight:     '700',
    letterSpacing:  -0.2,
  },
  emptySubtitle: {
    color:        QuinckleColors.textTertiary,
    fontSize:     12,
    textAlign:    'center',
    maxWidth:     260,
    lineHeight:   17,
  },
});
