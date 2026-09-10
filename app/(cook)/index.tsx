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
  AppState,
  FlatList,
  Image,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  UIManager,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { kitchen, printerApi, restaurantApi } from '../../services/api';
import { subscribeChannel, watchConnection } from '../../services/realtime';
import { printKot, getStatus as getPrinterStatus } from '../../services/printer';
import { setSinkContext, drainPendingPrintJobs, handleSinkSuperseded } from '../../services/printSink';
import { getPrintDeviceId } from '../../services/printDevice';
import { useAuth } from '../../context/AuthContext';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';
import { BottomNavbar, type BottomNavTab } from '../../components/ui/BottomNavbar';
import {
  KitchenTicketCard,
  type KitchenTicket,
} from '../../components/ui/KitchenTicketCard';
import { KitchenSkeleton } from '../../components/ui/KitchenSkeleton';
import { normalizeChannel, isOffPremise, channelLabel, locationLabel } from '../../constants/channel';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

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
  // Auto-print fires when this device holds the Bluetooth pairing AND the
  // restaurant's KOT auto-print toggle is on. We gate on the *local* printer
  // connection (getPrinterStatus), never on staff identity — the BT pairing is
  // the real single-sink guarantee, so any crew member on the paired device
  // can drive printing. (The old pairedById === staffInfo.id check silently
  // killed auto-print whenever a different cook logged in.)
  const kotAutoPrintRef = useRef(true);

  const [orders,        setOrders]        = useState<KitchenTicket[]>([]);
  const [completedOrders, setCompletedOrders] = useState<KitchenTicket[]>([]);
  const [completedPage, setCompletedPage] = useState(1);
  const [completedHasMore, setCompletedHasMore] = useState(false);
  const [isLoadingMoreCompleted, setIsLoadingMoreCompleted] = useState(false);
  const [isLoading,     setIsLoading]     = useState(true);
  const [searchText,    setSearchText]    = useState('');
  const [navTab,        setNavTab]        = useState<CookTab>('active');
  const [realtimeOk,    setRealtimeOk]    = useState(true);
  // Venue order-status flow. In DUAL_CHANNEL the cook marks items ready; in
  // SIMPLE the ticket list stays a read-only display board. Defaults to SIMPLE.
  const [dinerStatusMode, setDinerStatusMode] = useState<'SIMPLE' | 'DUAL_CHANNEL'>('SIMPLE');

  // KOT drain: the SHARED implementation in printSink.ts (also used by the
  // staff screen + FGS) — flushes the ack outbox, pulls the server queue with
  // this device's sink identity, prints first prints + durable reprints. The
  // auto-print toggle reaches it via setSinkContext.

  // ── Data mapping ─────────────────────────────────────────────────────────
  const mapTicket = (t: any, isCompleted = false): KitchenTicket => ({
    id:       t.order_id,
    // Every one of these used to be `=== 'TAKEAWAY' ? … : dine-in`, which
    // showed a delivery ticket as table "T0" on the kitchen display. The
    // counter now reads prep state off THIS board to decide what is packable
    // (DELIVERY_V2_PLAN §2), so the kitchen has to say which channel it is.
    table:    locationLabel(t.channel, { token: t.pickup_token, tableNumber: t.table_number }),
    location: isOffPremise(t.channel) ? channelLabel(t.channel) : '',
    channel:  normalizeChannel(t.channel),
    pickupToken: t.pickup_token ?? null,
    sessionRef: t.session_ref ?? null,
    placedAt: t.placed_at,
    status:   isCompleted ? 'completed' : 'new',
    items: t.items.map((item: any) => ({
      id:               item.item_id,
      name:             `${item.qty}× ${item.name}${item.note ? ` — ${item.note}` : ''}`,
      modifiersSummary: item.modifiers_summary ?? item.modifiersSummary ?? null,
      item_status:      (item.item_status ?? 'pending') as 'pending' | 'done',
    })),
  });

  const loadOrders = useCallback(async () => {
    try {
      const [activeRes, completedRes] = await Promise.all([
        kitchen.getOrders() as Promise<any>,
        kitchen.getCompleted(1, 30).catch(() => ({ tickets: [], page: 1, limit: 30, hasMore: false })) as Promise<any>,
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
      setCompletedPage(1);
      setCompletedHasMore(Boolean(completedRes?.hasMore));
      setCompletedOrders(completedTickets.map((t) => mapTicket(t, true)));
    } catch {
      // keep existing data on network error
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadMoreCompleted = useCallback(async () => {
    if (isLoadingMoreCompleted || !completedHasMore) return;
    setIsLoadingMoreCompleted(true);
    try {
      const nextPage = completedPage + 1;
      const res = await kitchen.getCompleted(nextPage, 30) as any;
      const nextRows: KitchenTicket[] = (res?.tickets ?? []).map((t: any) => mapTicket(t, true));
      setCompletedOrders((prev) => {
        const existing = new Set(prev.map((o) => o.id));
        const merged = [...prev];
        for (const row of nextRows) if (!existing.has(row.id)) merged.push(row);
        return merged;
      });
      setCompletedPage(nextPage);
      setCompletedHasMore(Boolean(res?.hasMore));
    } finally {
      setIsLoadingMoreCompleted(false);
    }
  }, [completedHasMore, completedPage, isLoadingMoreCompleted]);

  // Load the venue's order-status flow once — gates the mark-ready UI below.
  useEffect(() => {
    const restaurantId = staffInfo?.restaurantId;
    if (!restaurantId) return;
    let cancelled = false;
    restaurantApi.getBranding(restaurantId)
      .then((res) => {
        if (cancelled || !res?.success) return;
        setDinerStatusMode((res.data.dinerStatusMode ?? 'SIMPLE') as 'SIMPLE' | 'DUAL_CHANNEL');
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [staffInfo?.restaurantId]);

  // Cook marks a single item ready/undone. Optimistic; the backend flips the
  // order to PREPARING on the first done and auto-bumps to READY on the last,
  // and pushes item_ready so the steward sees that plate go Ready in real time.
  const handleToggleItem = useCallback(async (orderId: string, itemId: string, next: 'done' | 'pending') => {
    setOrders((prev) => prev.map((o) => o.id !== orderId ? o : {
      ...o,
      items: o.items.map((it) => it.id === itemId ? { ...it, item_status: next } : it),
    }));
    try {
      await kitchen.updateItemStatus(orderId, itemId, next);
    } catch {
      void loadOrders(); // reconcile from server on failure
    }
  }, [loadOrders]);

  // "Mark all ready" — flip every not-yet-done item on the ticket to done.
  const handleMarkAllReady = useCallback(async (orderId: string) => {
    const order = orders.find((o) => o.id === orderId);
    if (!order) return;
    const pending = order.items.filter((it) => it.item_status !== 'done');
    if (pending.length === 0) return;
    setOrders((prev) => prev.map((o) => o.id !== orderId ? o : {
      ...o,
      items: o.items.map((it) => ({ ...it, item_status: 'done' as const })),
    }));
    try {
      await Promise.all(pending.map((it) => kitchen.updateItemStatus(orderId, it.id, 'done')));
    } catch {
      void loadOrders();
    }
  }, [orders, loadOrders]);

  useEffect(() => {
    loadOrders();
  }, [loadOrders]);

  useEffect(() => {
    // Sync the KOT auto-print toggle from the server. Default stays true so a
    // transient status-fetch failure never silently disables printing.
    void printerApi.getStatus()
      .then((res) => {
        if (typeof res?.data?.kotAutoPrint === 'boolean') {
          kotAutoPrintRef.current = res.data.kotAutoPrint;
          setSinkContext({ autoPrint: res.data.kotAutoPrint });
        }
      })
      .catch(() => { /* keep last known toggle value */ });

    // Event-driven KOT reconciliation (no polling): drain on mount, on return
    // to foreground, and whenever the kitchen realtime socket (re)connects —
    // exactly when a live push could have been missed. printKot de-dupes so
    // these overlap harmlessly with the live push.
    void drainPendingPrintJobs();
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void drainPendingPrintJobs();
      }
    });
    const restaurantId = staffInfo?.restaurantId;
    const unwatchConn = restaurantId
      ? watchConnection(`kitchen:${restaurantId}`, (connected) => {
          if (connected) void drainPendingPrintJobs();
        })
      : undefined;
    return () => {
      appStateSub.remove();
      unwatchConn?.();
    };
  }, [staffInfo?.restaurantId]);

  // Keep the screen awake while this device is the print sink, so Android can't
  // suspend the JS runtime (and miss the live Ably push) when the kitchen
  // tablet's screen would otherwise sleep. Re-checked on a short timer since
  // printer connection can change at runtime.
  useEffect(() => {
    let active = false;
    const apply = () => {
      const shouldStayAwake = getPrinterStatus() === 'connected';
      if (shouldStayAwake && !active) {
        active = true;
        activateKeepAwakeAsync('kot-print-sink').catch(() => {});
      } else if (!shouldStayAwake && active) {
        active = false;
        deactivateKeepAwake('kot-print-sink').catch(() => {});
      }
    };
    apply();
    const t = setInterval(apply, 10_000);
    return () => {
      clearInterval(t);
      if (active) deactivateKeepAwake('kot-print-sink').catch(() => {});
    };
  }, []);

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

      // ── Auto-print fast path ──────────────────────────────────────────────
      // Fires on whichever device holds the BT pairing (getPrinterStatus), gated
      // by the auto-print toggle. The event-driven reconciliation drain (mount /
      // foreground / socket reconnect) is the backstop if this push is ever
      // missed; printKot de-dupes so the push and the drain can't double-print.
      if (kotAutoPrintRef.current && getPrinterStatus() === 'connected') {
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
            sessionId: data.sessionId ?? undefined,
            orderNumber: data.orderNumber != null ? String(data.orderNumber) : undefined,
            tableNumber: `${String(data.tableNumber ?? '?')}${data.partyGroupLabel ? ` · ${data.partyGroupLabel}` : ''}`,
            channel: data.channel,
            pickupToken: data.pickupToken ?? undefined,
            sessionRef: data.sessionRef ?? undefined,
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
    // When staff marks the last item served the order flips to SERVED and the
    // backend publishes order_served to the kitchen channel — reload so the
    // ticket disappears from the active queue in real-time.
    const unsubServed    = subscribeChannel(`kitchen:${restaurantId}`, 'order_served',    () => void loadOrders());

    // Reprint request — manual, user-initiated. Always prints on the connected
    // device regardless of the auto-print toggle, and force-bypasses de-dup so a
    // deliberate reprint within the de-dup window still goes through.
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
          sessionId: data.order.sessionId ?? data.sessionId ?? undefined,
          orderNumber: data.order.orderNumber != null ? String(data.order.orderNumber) : undefined,
          tableNumber: `${String(data.order.tableNumber ?? '?')}${data.order.partyGroupLabel ? ` · ${data.order.partyGroupLabel}` : ''}`,
          channel: data.order.channel,
          pickupToken: data.order.pickupToken ?? undefined,
          sessionRef: data.order.sessionRef ?? undefined,
          restaurantName: staffInfo?.restaurantName ?? '',
          createdAt: data.order.createdAt ?? new Date().toISOString(),
          items,
          isAddOn: false,
        }, false, data.requestedAt != null
          // Shared key with the durable pull-queue fallback — same reprint
          // request never prints twice; a NEW request (new requestedAt) does.
          ? { dedupeKey: `reprint:${data.order.id}:${data.requestedAt}` }
          : { force: true }); // old backend without requestedAt: legacy behaviour
      }
    });

    // Sink handover — another device paired (or the pairing was cleared).
    // Clear the stale local pairing so this device can never dual-print
    // against the new sink (critical for LAN/tcp printers).
    const unsubPrinterPaired = subscribeChannel(`partner:${restaurantId}`, 'printer_paired', (data: any) => {
      void (async () => {
        if (getPrinterStatus() !== 'connected') return;
        const myDeviceId = await getPrintDeviceId();
        if (data?.deviceId !== myDeviceId) await handleSinkSuperseded();
      })();
    });
    const unsubPrinterUnpaired = subscribeChannel(`partner:${restaurantId}`, 'printer_unpaired', () => {
      if (getPrinterStatus() === 'connected') void handleSinkSuperseded();
    });

    // Keep the auto-print toggle in sync when changed from any device/dashboard.
    const unsubAutoPrint = subscribeChannel(`partner:${restaurantId}`, 'kot_autoprint_changed', (data: any) => {
      if (typeof data?.enabled === 'boolean') {
        kotAutoPrintRef.current = data.enabled;
        setSinkContext({ autoPrint: data.enabled });
      }
    });

    return () => {
      unsubNew();
      unsubBumped();
      unsubCancelled();
      unsubServed();
      unsubReprint();
      unsubAutoPrint();
      unsubPrinterPaired();
      unsubPrinterUnpaired();
    };
  }, [staffInfo?.restaurantId, staffInfo?.restaurantName, staffInfo?.id, loadOrders]);

  // Connection indicator — same pattern as staff
  useEffect(() => {
    const restaurantId = staffInfo?.restaurantId;
    if (!restaurantId) return;
    return watchConnection(`kitchen:${restaurantId}`, (connected) => setRealtimeOk(connected));
  }, [staffInfo?.restaurantId]);

  const counts = useMemo(
    () => ({ active: orders.length, completed: completedOrders.length }),
    [orders, completedOrders],
  );

  const filteredOrders = useMemo(() => {
    const source = navTab === 'completed' ? completedOrders : orders;
    const query = searchText.trim().toLowerCase();
    if (!query) return source;
    return source.filter((order) => {
      const blob = `${order.id} ${order.table} ${order.location} ${order.items
        .map((i) => i.name)
        .join(' ')}`.toLowerCase();
      return blob.includes(query);
    });
  }, [orders, completedOrders, searchText, navTab]);

  // ── Header line ──────────────────────────────────────────────────────────
  const headerLine = useMemo(() => {
    if (navTab === 'completed') {
      return counts.completed === 1 ? '1 served today' : `${counts.completed} served today`;
    }
    if (counts.active === 0) return 'No active tickets';
    return counts.active === 1 ? '1 active ticket' : `${counts.active} active tickets`;
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
              index={index + 1}
              isCompletedTab={navTab === 'completed'}
              dualChannel={dinerStatusMode === 'DUAL_CHANNEL'}
              onToggleItem={(itemId, next) => void handleToggleItem(item.id, itemId, next)}
              onMarkAllReady={() => void handleMarkAllReady(item.id)}
              onReprint={getPrinterStatus() === 'connected' ? () => {
                // Print directly — printer is on this device. No Ably round-trip needed.
                // KitchenItem.name is already prefixed "2× Paneer Tikka" from mapTicket,
                // so parse out qty + clean name to avoid "1x 2× Paneer Tikka" on the KOT.
                const parseItem = (rawName: string, modifiersSummary?: string | null) => {
                  const m = rawName.match(/^(\d+)×\s*(.*?)(?:\s+—\s+(.*))?$/);
                  if (m) return { name: m[2].trim(), quantity: parseInt(m[1], 10), notes: m[3] ?? undefined, modifiersSummary: modifiersSummary ?? undefined };
                  return { name: rawName, quantity: 1, modifiersSummary: modifiersSummary ?? undefined };
                };
                void printKot({
                  id: item.id,
                  tableNumber: item.table,
                  channel: item.channel,
                  pickupToken: item.pickupToken ?? undefined,
                  sessionRef: item.sessionRef ?? undefined,
                  restaurantName: staffInfo?.restaurantName ?? '',
                  createdAt: item.placedAt ?? new Date().toISOString(),
                  items: item.items.map((i) => parseItem(i.name, i.modifiersSummary)),
                  isAddOn: false,
                }, false, { force: true });
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
                  : 'Orders served in the last 24 hours appear here.'}
              </Text>
            </View>
          }
          ListFooterComponent={
            navTab === 'completed' && completedHasMore ? (
              <TouchableOpacity
                style={styles.loadMoreBtn}
                onPress={() => void loadMoreCompleted()}
                disabled={isLoadingMoreCompleted}
                activeOpacity={0.8}
              >
                {isLoadingMoreCompleted ? (
                  <Text style={styles.loadMoreText}>Loading…</Text>
                ) : (
                  <Text style={styles.loadMoreText}>Load more</Text>
                )}
              </TouchableOpacity>
            ) : null
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
  loadMoreBtn: {
    marginTop: Spacing.md,
    alignSelf: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: QuinckleColors.borderStrong,
    backgroundColor: QuinckleColors.surfaceMuted,
  },
  loadMoreText: {
    color: QuinckleColors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
});
