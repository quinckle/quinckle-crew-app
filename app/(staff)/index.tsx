import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  FlatList,
  Image,
  LayoutAnimation,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

const SCREEN_WIDTH = Dimensions.get('window').width;

// Graph-paper grid overlay component — renders thin lines that fade to transparent with a golden glow
function GridTexture({ height = 100 }: { height?: number }) {
  const gridSize = 18;
  const cols = Math.ceil(SCREEN_WIDTH / gridSize);
  const rows = Math.ceil(height / gridSize);

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height, overflow: 'hidden' }} pointerEvents="none">
      {/* Golden glow gradient background */}
      <LinearGradient
        colors={['rgba(245, 159, 11, 0.25)', 'rgba(245, 159, 11, 0.08)', 'transparent']}
        locations={[0, 0.5, 1]}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: height * 0.8 }}
        pointerEvents="none"
      />
      {/* Horizontal lines */}
      {Array.from({ length: rows + 1 }).map((_, i) => (
        <View
          key={`h${i}`}
          style={{
            position: 'absolute',
            top: i * gridSize,
            left: 0,
            right: 0,
            height: StyleSheet.hairlineWidth,
            backgroundColor: 'rgba(245, 158, 11, 0.08)',
          }}
        />
      ))}
      {/* Vertical lines */}
      {Array.from({ length: cols + 1 }).map((_, i) => (
        <View
          key={`v${i}`}
          style={{
            position: 'absolute',
            top: 0,
            left: i * gridSize,
            width: StyleSheet.hairlineWidth,
            height,
            backgroundColor: 'rgba(245, 158, 11, 0.08)',
          }}
        />
      ))}
      {/* Fade to transparent/background */}
      <LinearGradient
        colors={['transparent', QuinckleColors.background]}
        style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: height * 0.6 }}
        pointerEvents="none"
      />
    </View>
  );
}
import { useAuth } from '../../context/AuthContext';
import { Audio } from 'expo-av';
import { crewTables, crewSessions, crewOrders, crewPayments, restaurantApi, crewAuth, printerApi } from '../../services/api';
import { subscribeChannel, watchConnection } from '../../services/realtime';
import { printKot, getStatus as getPrinterStatus } from '../../services/printer';

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
import type { ActiveOrder, MenuItem } from '../../services/api';
import { router } from 'expo-router';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';
import { ThemedDialog } from '../../components/ui/themed-dialog';
import { BottomNavbar } from '../../components/ui/BottomNavbar';
import { PICKUP_LAYOUT_PRESET, PickupCard, PickupSegmented } from '../../components/ui/pickup';
import { TableSkeleton } from '../../components/ui/TableSkeleton';
import { MenuSkeleton } from '../../components/ui/MenuSkeleton';
import { CombosSkeleton } from '../../components/ui/CombosSkeleton';
import { FeaturedSkeleton } from '../../components/ui/FeaturedSkeleton';

// Format an Indian phone like "9051138485" → "+91 90511 38485" for display
function formatPhone(raw?: string | null): string {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  const last10 = digits.slice(-10);
  if (last10.length !== 10) return raw;
  return `+91 ${last10.slice(0, 5)} ${last10.slice(5)}`;
}

Notifications.setNotificationHandler({
  handleNotification: async () => {
    return {
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    } as any;
  },
});

type NavItem = 'tables' | 'menu' | 'orders';
type TableStatus = 'available' | 'occupied' | 'offline';

type Table = {
  id: string;
  number: number;
  status: TableStatus;
  seats: number;
  billAmount?: number;
  since?: string;
  location?: string;
  sessionId?: string;
};

const MENU_DATA_INITIAL = [
  { id: '1', name: 'Chicken Biryani', price: 250, category: 'Mains', available: true, image: 'https://images.unsplash.com/photo-1563379091339-03b21bc4a4f8?q=80&w=200&h=200&auto=format&fit=crop' },
  { id: '2', name: 'Butter Chicken', price: 320, category: 'Mains', available: true, image: 'https://images.unsplash.com/photo-1603894584202-93826e796a39?q=80&w=200&h=200&auto=format&fit=crop' },
  { id: '3', name: 'Paneer Tikka', price: 220, category: 'Appetizers', available: true, image: 'https://images.unsplash.com/photo-1567188040759-fb8a883dc6d8?q=80&w=200&h=200&auto=format&fit=crop' },
  { id: '4', name: 'Garlic Naan', price: 60, category: 'Mains', available: true, image: 'https://images.unsplash.com/photo-1533777857889-4be7c70b33f7?q=80&w=200&h=200&auto=format&fit=crop' },
  { id: '5', name: 'Cold Coffee', price: 120, category: 'Beverages', available: true, image: 'https://images.unsplash.com/photo-1517701604599-bb29b565090c?q=80&w=200&h=200&auto=format&fit=crop' },
  { id: '6', name: 'Chocolate Brownie', price: 180, category: 'Desserts', available: false, image: 'https://images.unsplash.com/photo-1606313564200-e75d5e30476c?q=80&w=200&h=200&auto=format&fit=crop' },
  { id: '7', name: 'Lemon Soda', price: 80, category: 'Beverages', available: true, image: 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?q=80&w=200&h=200&auto=format&fit=crop' },
  { id: '8', name: 'Mutton Seekh', price: 350, category: 'Appetizers', available: true, image: 'https://images.unsplash.com/photo-1601050690597-df056fb4ce7a?q=80&w=200&h=200&auto=format&fit=crop' },
  { id: '9', name: 'Special Salad', price: 150, category: 'Appetizers', available: true },
];

type PickupItem = { id: string; name: string; qty: number; orderedAt: string; isServed: boolean; isReady: boolean };
type PickupOrder = { id: string; tableNo: string; items: PickupItem[]; completedAt?: string };

// Real-time activity feed — populated from session/order events on the
// waiter:{restaurantId} Ably channel as they happen. Empty by default;
// historical demo entries were removed (no backend persistence needed for
// this session-scoped feed).
const ACTIVITY_DATA: Array<{ id: string; message: string; date: string; time: string }> = [];

const INITIAL_TABLES: Table[] = [
  { id: '1', number: 1, status: 'occupied', seats: 4, billAmount: 2050, since: '14:15', location: 'Main Hall' },
  { id: '2', number: 2, status: 'occupied', seats: 2, billAmount: 1280, since: '14:40', location: 'Window' },
  { id: '3', number: 3, status: 'available', seats: 2, location: 'Bar Side' },
  { id: '4', number: 4, status: 'occupied', seats: 4, billAmount: 3420, since: '13:30', location: 'Corner' },
  { id: '5', number: 5, status: 'available', seats: 2, location: 'Terrace' },
  { id: '6', number: 6, status: 'offline', seats: 4, location: 'Garden' },
  { id: '7', number: 7, status: 'available', seats: 6, location: 'Main Hall' },
  { id: '8', number: 8, status: 'occupied', seats: 2, since: '15:00', location: 'Window' },
  { id: '9', number: 9, status: 'available', seats: 4, location: 'Garden' },
  { id: '10', number: 10, status: 'available', seats: 8, location: 'Main Hall' },
  { id: '11', number: 11, status: 'offline', seats: 4, location: 'Main Hall' },
  { id: '12', number: 12, status: 'available', seats: 4, location: 'Window' },
];

const STATUS_META: Record<TableStatus, { label: string; color: string }> = {
  available: { label: 'Available', color: QuinckleColors.success },
  occupied: { label: 'Occupied', color: QuinckleColors.primary },
  offline: { label: 'Offline', color: QuinckleColors.textTertiary },
};

export default function StaffDashboard() {
  const insets = useSafeAreaInsets();
  const { staffInfo } = useAuth();
  const [activeTab, setActiveTab] = useState<NavItem>('tables');
  const [filterVisible, setFilterVisible] = useState(false);
  const [tables, setTables] = useState<Table[]>([]);
  const [isLoadingTables, setIsLoadingTables] = useState(true);
  const [isLoadingMenu, setIsLoadingMenu] = useState(true);
  const [menuData, setMenuData] = useState(MENU_DATA_INITIAL);
  const [menuCategories, setMenuCategories] = useState<string[]>(['All', 'Appetizers', 'Mains', 'Beverages', 'Desserts']);
  const [combos, setCombos] = useState<any[]>([]);
  const [highlightedSection, setHighlightedSection] = useState<{ title: string; subtitle?: string; itemIds: string[] } | null>(null);


  const [activeFilter, setActiveFilter] = useState<'all' | TableStatus | string>('all');
  const [menuFilter, setMenuFilter] = useState('All');
  const [searchText, setSearchText] = useState('');
  const [realtimeOk, setRealtimeOk] = useState(true);
  // Pending cash-collection requests across the whole restaurant. Drives the
  // red-dot badge on the cash icon in the header. Updated from:
  //  - initial fetch on mount
  //  - cash_collection_requested Ably event (+1)
  //  - cash_payment_collected   Ably event (−1, floored at 0)
  const [pendingCashCount, setPendingCashCount] = useState(0);
  const [pickupOrders, setPickupOrders] = useState<PickupOrder[]>([]);
  const [liveOrders, setLiveOrders] = useState<ActiveOrder[]>([]);
  const [ordersSubTab, setOrdersSubTab] = useState<'active' | 'completed'>('active');
  const [completingIds, setCompletingIds] = useState<string[]>([]);
  // KOT auto-print toggle — loaded from server, synced via Ably.
  // Stored in both state (for UI) and a ref (so Ably callbacks always see latest value).
  const [kotAutoPrint, setKotAutoPrint] = useState(true);
  const kotAutoPrintRef = useRef(true);
  const setKotAutoPrintSync = (v: boolean) => { kotAutoPrintRef.current = v; setKotAutoPrint(v); };

  const simulateNewOrder = async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

    try {
      // Play a premium, soft "Ding" style chime (elevator arrival sound)
      const { sound } = await Audio.Sound.createAsync(
        { uri: 'https://upload.wikimedia.org/wikipedia/commons/b/b5/Elevator_ding.ogg' },
        { shouldPlay: true }
      );
    } catch (e) {
      console.warn('Could not play in-app sound', e);
    }

    await Notifications.scheduleNotificationAsync({
      content: {
        title: "🛎 New Order Ready!",
        body: "Table T08 - 2x Paneer Tikka is ready for pickup.",
        sound: true,
      },
      trigger: null,
    });
  };

  const togglePickupItem = (orderId: string, itemId: string) => {
    Haptics.selectionAsync().catch(() => {});

    // Optimistic update — mark served immediately. If this was the last
    // pending item, flag the card as "completing" so PickupCard runs its
    // calm in-place celebration. completedAt stays unset during the
    // celebration; handleCompletionFinished sets it (as ISO) when the
    // animation finishes, which is what moves the card to the Completed list.
    let triggersCompletion = false;
    setPickupOrders((prev) =>
      prev.map((order) => {
        if (order.id !== orderId) return order;
        const items = order.items.map((it) =>
          it.id === itemId ? { ...it, isServed: true } : it,
        );
        if (!order.completedAt && items.every((it) => it.isServed)) {
          triggersCompletion = true;
        }
        return { ...order, items };
      }),
    );

    if (triggersCompletion) {
      setCompletingIds((prev) => (prev.includes(orderId) ? prev : [...prev, orderId]));
    }

    // Fire-and-forget — realtime `order_served` event drives the refresh.
    // Awaiting loadPickupOrders here used to snap the list mid-animation.
    void crewOrders
      .serveItem(orderId, itemId)
      .catch(() => {
        // Revert on failure
        setPickupOrders((prev) =>
          prev.map((o) =>
            o.id !== orderId ? o : {
              ...o,
              items: o.items.map((it) =>
                it.id === itemId ? { ...it, isServed: false } : it,
              ),
            }
          ),
        );
        setCompletingIds((prev) => prev.filter((id) => id !== orderId));
      });
  };

  const handleCompletionFinished = (orderId: string) => {
    LayoutAnimation.configureNext(PICKUP_LAYOUT_PRESET);
    const completedIso = new Date().toISOString();
    setPickupOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, completedAt: completedIso } : o)),
    );
    setCompletingIds((prev) => prev.filter((id) => id !== orderId));
  };

  const reopenOrder = (orderId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    LayoutAnimation.configureNext(PICKUP_LAYOUT_PRESET);
    setPickupOrders((prev) =>
      prev.map((order) =>
        order.id === orderId
          ? {
            ...order,
            completedAt: undefined,
            items: order.items.map((it, idx) => (idx === 0 ? { ...it, isServed: false } : it)),
          }
          : order,
      ),
    );
    setOrdersSubTab('active');
  };

  const activePickupOrders = useMemo(
    () => pickupOrders.filter((o) => !o.completedAt),
    [pickupOrders],
  );
  const completedPickupOrders = useMemo(
    () =>
      pickupOrders
        .filter((o) => !!o.completedAt)
        .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '')),
    [pickupOrders],
  );
  const [dialog, setDialog] = useState<{
    visible: boolean;
    title: string;
    message: string;
    actions: { label: string; onPress: () => void; variant?: 'default' | 'danger' | 'primary' }[];
  }>({ visible: false, title: '', message: '', actions: [] });

  const counts = useMemo(() => ({
    available: tables.filter((t) => t.status === 'available').length,
    occupied: tables.filter((t) => t.status === 'occupied').length,
    offline: tables.filter((t) => t.status === 'offline').length,
    all: tables.length,
  }), [tables]);

  const filteredTables = useMemo(() => tables.filter((table) => {
    const matchesFilter = activeFilter === 'all' || table.status === activeFilter;
    const query = searchText.trim().toLowerCase();
    const matchesSearch =
      !query || String(table.number).includes(query) || (table.location && table.location.toLowerCase().includes(query));
    return matchesFilter && matchesSearch;
  }), [tables, activeFilter, searchText]);

  const closeDialog = () => setDialog((prev) => ({ ...prev, visible: false }));

  const showDialog = (
    title: string,
    message: string,
    actions: { label: string; onPress: () => void; variant?: 'default' | 'danger' | 'primary' }[],
  ) => {
    setDialog({
      visible: true,
      title,
      message,
      actions: actions.map((action) => ({
        ...action,
        onPress: () => { closeDialog(); action.onPress(); },
      })),
    });
  };

  const loadTables = async () => {
    try {
      const res = await crewTables.list() as any;
      console.log('[tables] API response:', JSON.stringify(res));
      const apiTables: Table[] = await Promise.all((res?.tables ?? []).map(async (t: any) => {
        let billAmount = typeof t.bill_total === 'number' ? t.bill_total : undefined;
        if (billAmount === undefined && t.session_id) {
          try {
            const bill = await crewSessions.getBill(t.session_id);
            billAmount = typeof bill.total_payable === 'number'
              ? bill.total_payable
              : bill.session_total + (bill.tax_total ?? bill.session_total * 0.05);
          } catch {
            billAmount = undefined;
          }
        }

        return {
          id: t.table_id,
          number: t.table_number,
          status: (t.status === 'reserved' ? 'occupied' : t.status) as TableStatus,
          seats: t.capacity,
          since: t.occupied_since
            ? (() => {
              const d = new Date(t.occupied_since);
              return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
            })()
            : undefined,
          location: undefined,
          sessionId: t.session_id ?? undefined,
          billAmount,
        };
      }));
      apiTables.sort((a, b) => a.number - b.number);
      console.log('[tables] mapped count:', apiTables.length);
      setTables(apiTables);
    } catch (e) {
      console.error('[tables] loadTables error:', e);
    } finally {
      setIsLoadingTables(false);
    }
  };

  const loadMenuFromApi = async () => {
    if (!staffInfo?.restaurantId) return;
    const rid = staffInfo.restaurantId;
    try {
      const [menuRes, combosRes, highlightRes] = await Promise.allSettled([
        restaurantApi.getMenu(rid),
        restaurantApi.getCombos(rid),
        restaurantApi.getHighlighted(rid),
      ]);

      if (menuRes.status === 'fulfilled') {
        const categories: any[] = (menuRes.value as any)?.data ?? [];
        const items = categories.flatMap((cat: any) => cat.items ?? []);
        if (items.length > 0) {
          setMenuData(items.map((item: any) => ({
            id: item.id, name: item.name,
            price: parseFloat(item.price), category: item.category,
            available: item.isAvailable, image: item.imageUrl ?? undefined,
          })));
          setMenuCategories(['All', ...categories.map((c: any) => c.name).filter(Boolean)]);
          setMenuFilter('All');
        }
      } else {
        console.error('[menu] menu error:', menuRes.reason);
      }

      if (combosRes.status === 'fulfilled') {
        const data = (combosRes.value as any)?.data ?? [];
        setCombos(data.filter((c: any) => c.isActive));
      }

      if (highlightRes.status === 'fulfilled') {
        setHighlightedSection((highlightRes.value as any)?.data ?? null);
      }
    } catch (e) {
      console.error('[menu] loadMenuFromApi error:', e);
    } finally {
      setIsLoadingMenu(false);
    }
  };

  const loadPickupOrders = async () => {
    try {
      const res = await crewOrders.getActive();
      const allOrders = res.orders ?? [];
      setLiveOrders(allOrders);

      // Simplified flow: show any order that has unserved items, regardless of
      // order status. Serving is always open — no kitchen pipeline gate.
      const serveableOrders = allOrders.filter(o =>
        o.items.some(i => !i.served)
      );

      // Notify staff the moment a brand-new order lands on the floor — they
      // no longer need to wait for kitchen to flip status to READY.
      const prevOrderIds = new Set(pickupOrders.map(o => o.id));
      const newOrders = serveableOrders.filter(o => !prevOrderIds.has(o.order_id));
      if (newOrders.length > 0) {
        void playSound(require('../../assets/audio/notifications/waiter notification.mp3'));
        Notifications.scheduleNotificationAsync({
          content: {
            title: '🔔 New Order',
            body: newOrders.map(o => `T${o.table_number}`).join(', ') + ' — ready to serve',
            sound: true,
          },
          trigger: null,
        }).catch(() => { });
      }

      const refreshedActive = serveableOrders.map(order => ({
        id: order.order_id,
        tableNo: `T${order.table_number}`,
        items: order.items.map(item => ({
          id: item.item_id,
          name: `${item.qty}× ${item.name}`,
          qty: item.qty,
          orderedAt: (() => {
            const d = new Date(order.placed_at);
            return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
          })(),
          isServed: item.served,
          // In the simplified flow kitchen does not mark items — all unserved
          // items are immediately available for staff to serve.
          isReady: !item.served,
        })),
      }));

      // Backend /orders/active drops orders once they flip to SERVED, but the
      // staff Completed tab still needs to surface "just-served" tickets so
      // the waiter can see what they finished and undo if needed. Carry any
      // locally-completed orders forward across refetches, and auto-prune
      // anything completed >1h ago so the list stays calm.
      const refreshedIds = new Set(refreshedActive.map(o => o.id));
      const oneHourAgo = Date.now() - 60 * 60 * 1000;
      setPickupOrders(prev => {
        const survivingCompleted = prev.filter(o => {
          if (!o.completedAt || refreshedIds.has(o.id)) return false;
          const ts = Date.parse(o.completedAt);
          // Unparseable (legacy 'now' / HH:MM) → keep for this session
          if (isNaN(ts)) return true;
          return ts >= oneHourAgo;
        });
        return [...refreshedActive, ...survivingCompleted];
      });
    } catch (e) { console.error('[pickup] loadPickupOrders error:', e); }
  };

  // Re-hydrate the Completed tab with today's served orders so history
  // survives an app reload. Runs once on mount; only seeds orders that are
  // not already in the pickupOrders list (i.e. carried from this session).
  const loadServedToday = async () => {
    try {
      const res = await crewOrders.getServedToday();
      const served = res.orders ?? [];
      if (served.length === 0) return;
      setPickupOrders(prev => {
        const existingIds = new Set(prev.map(o => o.id));
        const toAdd = served
          .filter(o => !existingIds.has(o.order_id))
          .map(order => ({
            id: order.order_id,
            tableNo: `T${order.table_number}`,
            completedAt: order.served_at ?? order.placed_at,
            items: order.items.map(item => ({
              id: item.item_id,
              name: `${item.qty}× ${item.name}`,
              qty: item.qty,
              orderedAt: (() => {
                const d = new Date(order.placed_at);
                return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
              })(),
              isServed: true,
              isReady: true,
            })),
          }));
        if (toAdd.length === 0) return prev;
        // Put seeded completed orders behind any live active orders
        return [...prev, ...toAdd];
      });
    } catch (e) { console.error('[pickup] loadServedToday error:', e); }
  };

  // Load once on mount — Ably drives all subsequent updates
  useEffect(() => {
    loadTables();
    loadMenuFromApi();
    loadPickupOrders();
    loadServedToday();
    loadPendingCashCount();
    // Load KOT auto-print toggle from server
    printerApi.getStatus().then(res => {
      if (typeof res?.data?.kotAutoPrint === 'boolean') {
        setKotAutoPrintSync(res.data.kotAutoPrint);
      }
    }).catch(() => { /* non-fatal */ });
  }, [staffInfo?.restaurantId]);

  const loadPendingCashCount = async () => {
    try {
      const data = await crewPayments.getCashRequests();
      setPendingCashCount(data.pending.length);
    } catch { /* non-fatal — Ably will keep the count fresh */ }
  };

  // Immediately refresh pickup orders when switching to Orders tab
  useEffect(() => {
    if (activeTab === 'orders') void loadPickupOrders();
  }, [activeTab]);

  // Ably: waiter:{restaurantId} — pure push, no polling
  useEffect(() => {
    const restaurantId = staffInfo?.restaurantId;
    if (!restaurantId) return;

    let lastReadyId: string | null = null;

    const off1 = subscribeChannel(`waiter:${restaurantId}`, 'order_ready', (data: any) => {
      const orderId = data?.orderId as string | undefined;
      if (!orderId || orderId === lastReadyId) return;
      lastReadyId = orderId;
      void playSound(require('../../assets/audio/notifications/waiter notification.mp3'));
      void loadPickupOrders();
      void loadTables();
    });

    const off2 = subscribeChannel(`waiter:${restaurantId}`, 'order_served', () => {
      void loadPickupOrders();
      void loadTables();
    });

    const off3 = subscribeChannel(`waiter:${restaurantId}`, 'new_order', (data: any) => {
      void loadPickupOrders();
      void loadTables();
      // Auto-print KOT on whichever crew device has a printer connected,
      // but only when the auto-print toggle is enabled.
      if (kotAutoPrintRef.current && getPrinterStatus() === 'connected' && data?.orderId) {
        const kotItems = (data.items ?? []).map((i: any) => ({
          name: i.menuItemName ?? i.name ?? '',
          quantity: Number(i.quantity ?? 1),
          notes: i.notes ?? null,
          modifiersSummary: i.modifiersSummary ?? null,
          category: i.category,
        }));
        void printKot({
          id: data.orderId,
          orderNumber: data.orderNumber,
          tableNumber: data.tableNumber,
          restaurantName: staffInfo?.restaurantName ?? '',
          createdAt: data.createdAt ?? new Date().toISOString(),
          items: kotItems,
          isAddOn: false,
        });
      }
    });

    // Sync auto-print toggle from any device (crew app or partner dashboard)
    const offAutoPrint = subscribeChannel(`partner:${restaurantId}`, 'kot_autoprint_changed', (data: any) => {
      if (typeof data?.enabled === 'boolean') setKotAutoPrintSync(data.enabled);
    });

    const off4 = subscribeChannel(`waiter:${restaurantId}`, 'session_ended', () => {
      void loadPickupOrders();
      void loadTables();
    });

    const off5 = subscribeChannel(`waiter:${restaurantId}`, 'session_started', () => {
      void loadTables();
    });

    const off6 = subscribeChannel(`waiter:${restaurantId}`, 'payment_confirmed', () => {
      void loadTables();
    });

    // Table status flipped (offline/online/reserved/available) from another
    // device — refresh the grid so this device matches.
    const off6a = subscribeChannel(`waiter:${restaurantId}`, 'table_offline', () => {
      void loadTables();
    });
    const off6b = subscribeChannel(`waiter:${restaurantId}`, 'table_online', () => {
      void loadTables();
    });
    // Session swap from another device — both source + target need re-render.
    const off6c = subscribeChannel(`waiter:${restaurantId}`, 'session_moved', () => {
      void loadTables();
    });

    const off7 = subscribeChannel(`waiter:${restaurantId}`, 'item_bumped', () => {
      void loadPickupOrders();
    });

    // Per-item ready: drives a refetch the moment the cook flips a single item.
    // The sound + notification are emitted by loadPickupOrders' own diff so
    // the same UX fires whether the realtime event or a manual refresh
    // surfaces a newly-ready item.
    const off7b = subscribeChannel(`waiter:${restaurantId}`, 'item_ready', () => {
      void loadPickupOrders();
    });

    const off8 = subscribeChannel(`waiter:${restaurantId}`, 'cash_collection_requested', (data: any) => {
      const tableNumber = data?.tableNumber as number | undefined;
      const amount = data?.amount as number | undefined;
      setPendingCashCount(c => c + 1);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      void playSound(require('../../assets/audio/notifications/waiter notification.mp3'));
      Notifications.scheduleNotificationAsync({
        content: {
          title: `💵 Collect cash${tableNumber ? ` — Table ${tableNumber}` : ''}`,
          body: amount ? `₹${amount} due at the table` : 'Customer is paying by cash',
          sound: true,
        },
        trigger: null,
      }).catch(() => { });
      void loadTables();
    });

    // When any waiter (this one or another) marks an order collected,
    // decrement the badge so it stays accurate across multiple devices.
    const off9 = subscribeChannel(`waiter:${restaurantId}`, 'cash_payment_collected', () => {
      setPendingCashCount(c => Math.max(0, c - 1));
    });

    // Reprint request — fires on any device with printer connected
    const offReprint = subscribeChannel(`partner:${restaurantId}`, 'reprint_request', (data: any) => {
      if (getPrinterStatus() === 'connected' && data?.order) {
        const items = (data.order.items ?? []).map((i: any) => ({
          name: i.name ?? i.menuItemName ?? '',
          quantity: i.quantity,
          notes: i.notes,
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

    return () => { off1(); off2(); off3(); off4(); off5(); off6(); off6a(); off6b(); off6c(); off7(); off7b(); off8(); off9(); offReprint(); offAutoPrint(); };
  }, [staffInfo?.restaurantId]);

  // C1: Track Ably connection health — show a warning when the waiter channel drops.
  useEffect(() => {
    const restaurantId = staffInfo?.restaurantId;
    if (!restaurantId) return;
    return watchConnection(`waiter:${restaurantId}`, (connected) => setRealtimeOk(connected));
  }, [staffInfo?.restaurantId]);

  const updateTableStatus = async (tableNum: number, nextStatus: TableStatus) => {
    // Optimistic local update
    setTables(prev => prev.map(t => (t.number === tableNum ? { ...t, status: nextStatus } : t)));

    if (nextStatus === 'available') {
      const table = tables.find(t => t.number === tableNum);
      if (table) {
        try {
          await crewTables.updateStatus(table.id, nextStatus);
          await loadTables();
        } catch {
          // Keep optimistic update on error
        }
      }
    }
  };

  const handleTablePress = (tableNum: number, currentStatus: TableStatus) => {
    if (currentStatus === 'offline') {
      showDialog(
        'Table Offline',
        `Make Table T${String(tableNum).padStart(2, '0')} available again?`,
        [
          { label: 'Cancel', onPress: () => { } },
          { label: 'Make Available', variant: 'primary', onPress: () => { void updateTableStatus(tableNum, 'available'); } },
        ],
      );
      return;
    }

    if (currentStatus === 'available') {
      showDialog(`New Session`, `Start a new session for Table T${String(tableNum).padStart(2, '0')}?`, [
        { label: 'Cancel', onPress: () => { } },
        {
          label: 'Start Session',
          variant: 'primary',
          onPress: async () => {
            const table = tables.find(t => t.number === tableNum);
            if (!table) return;
            try {
              const res = await crewSessions.start(table.id);
              void loadTables();
              router.push({ pathname: '/(staff)/[tableId]', params: { tableId: String(tableNum), sessionId: res.session_id, tableDbId: table.id } });
            } catch {
              // Fallback: navigate without session
              router.push({ pathname: '/(staff)/[tableId]', params: { tableId: String(tableNum), tableDbId: table.id } });
            }
          },
        },
      ]);
    } else {
      const table = tables.find(t => t.number === tableNum);
      router.push({ pathname: '/(staff)/[tableId]', params: { tableId: String(tableNum), sessionId: table?.sessionId ?? '', tableDbId: table?.id ?? '' } });
    }
  };

  const handleLongPress = (tableId: string, status: TableStatus) => {
    const table = tables.find((t) => t.id === tableId);
    if (!table) return;
    const tableNum = table.number;
    if (status === 'available') {
      showDialog(
        'Manage Table',
        `Mark Table T${String(tableNum).padStart(2, '0')} as offline? It will be hidden from new guest assignments.`,
        [
          { label: 'Cancel', onPress: () => { } },
          { label: 'Mark Offline', variant: 'danger', onPress: () => { void updateTableStatus(tableNum, 'offline'); } },
        ],
      );
    } else if (status === 'offline') {
      showDialog(
        'Manage Table',
        `Make Table T${String(tableNum).padStart(2, '0')} available for guests?`,
        [
          { label: 'Cancel', onPress: () => { } },
          { label: 'Make Available', variant: 'primary', onPress: () => { void updateTableStatus(tableNum, 'available'); } },
        ],
      );
    }
  };

  const FILTER_CHIPS = [
    { key: 'all', label: 'All', count: counts.all },
    { key: 'available', label: 'Available', count: counts.available },
    { key: 'occupied', label: 'Occupied', count: counts.occupied },
  ] as const;

  return (
    <View style={[styles.container, { paddingTop: insets.top + Spacing.sm }]}>
      {/* Subtle graph-paper grid texture at top */}
      <GridTexture height={120} />
      <View style={styles.topBar}>
        <View style={styles.brandGroup}>
          <Text style={styles.brandTitle}>{staffInfo?.restaurantName ?? 'The Grill Room'}</Text>
          <View style={styles.badgeRow}>
            <View style={styles.roleBadge}>
              <Text style={styles.roleBadgeText}>Staff</Text>
            </View>
            {!realtimeOk && (
              <View style={styles.statusRow}>
                <View style={[styles.statusDot, { backgroundColor: QuinckleColors.warning }]} />
                <Text style={[styles.statusText, { color: QuinckleColors.warning }]}>No live updates</Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.headerActions}>
          {/* Manual refresh — Ably push usually keeps things live, but
              the partner asked for a fallback so staff can force a pull
              without restarting the app. */}
          <TouchableOpacity
            style={styles.refreshBtn}
            onPress={() => { void loadTables(); }}
            activeOpacity={0.7}
            disabled={isLoadingTables}
          >
            <Ionicons
              name="refresh"
              size={16}
              color={isLoadingTables ? QuinckleColors.textTertiary : QuinckleColors.textPrimary}
            />
          </TouchableOpacity>

          {/* Cash-collection icon: tap to see pending requests + today's history.
                Red dot appears when there's at least one unresolved request. */}
          <TouchableOpacity
            style={styles.cashIconBtn}
            onPress={() => router.push('/(staff)/cash-collection')}
            activeOpacity={0.7}
          >
            <Image
              source={require('../../assets/images/icons/staff/orders/cash collection icon.webp')}
              style={styles.cashIconImage}
              resizeMode="contain"
            />
            {pendingCashCount > 0 && (
              <View style={styles.cashBadge}>
                <Text style={styles.cashBadgeText}>
                  {pendingCashCount > 9 ? '9+' : String(pendingCashCount)}
                </Text>
              </View>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.avatarBtn}
            onPress={() => router.push('/(staff)/profile')}
            activeOpacity={0.7}
          >
            {staffInfo?.photoUrl ? (
              <Image source={{ uri: staffInfo.photoUrl }} style={styles.avatarImage} />
            ) : (
              <View style={[styles.avatarImage, { backgroundColor: '#F35D3B', alignItems: 'center', justifyContent: 'center' }]}>
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>
                  {(staffInfo?.name ?? 'S').split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {activeTab === 'tables' ? (
        <>
          <View style={styles.controlsRow}>
            <View style={styles.searchBox}>
              <Ionicons name="search" size={15} color={QuinckleColors.textTertiary} />
              <TextInput
                value={searchText}
                onChangeText={setSearchText}
                placeholder="Search tables…"
                placeholderTextColor={QuinckleColors.textTertiary}
                style={styles.searchInput}
              />
            </View>

            <TouchableOpacity
              style={styles.filterDropdown}
              onPress={() => setFilterVisible(true)}
              activeOpacity={0.7}
            >
              <Ionicons name="filter" size={14} color={QuinckleColors.textPrimary} />
              <Text style={styles.filterValueText}>
                {FILTER_CHIPS.find((c) => c.key === activeFilter)?.label}
              </Text>
              <Ionicons name="chevron-down" size={13} color={QuinckleColors.textTertiary} />
            </TouchableOpacity>
          </View>

          <Modal visible={filterVisible} transparent animationType="fade" onRequestClose={() => setFilterVisible(false)}>
            <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setFilterVisible(false)}>
              <View style={styles.dropdownMenu}>
                <Text style={styles.menuLabel}>Filter Tables</Text>
                {FILTER_CHIPS.map((chip) => (
                  <TouchableOpacity
                    key={chip.key}
                    style={[styles.menuItem, activeFilter === chip.key && styles.menuItemActive]}
                    onPress={() => {
                      setActiveFilter(chip.key as 'all' | TableStatus);
                      setFilterVisible(false);
                    }}
                  >
                    <Text style={[styles.menuItemText, activeFilter === chip.key && styles.menuItemTextActive]}>
                      {chip.label}
                    </Text>
                    <Text style={styles.menuItemCount}>{chip.count}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </TouchableOpacity>
          </Modal>

          {isLoadingTables && tables.length === 0 ? (
            <TableSkeleton />
          ) : (
            <FlatList
              data={filteredTables}
              keyExtractor={(item) => item.id}
              numColumns={2}
              columnWrapperStyle={styles.columnWrapper}
              contentContainerStyle={styles.listContent}
              refreshing={isLoadingTables}
              onRefresh={() => { void loadTables(); }}
              renderItem={({ item }) => {
                const meta = STATUS_META[item.status] || STATUS_META.available;
                return (
                  <TouchableOpacity
                    style={[
                      styles.tableCard,
                      { borderColor: `${meta.color}99` },
                      item.status === 'offline' && styles.offlineCard,
                    ]}
                    onPress={() => handleTablePress(item.number, item.status)}
                    onLongPress={() => handleLongPress(item.id, item.status)}
                    activeOpacity={0.85}
                    delayLongPress={500}
                  >
                    <LinearGradient
                      colors={[`${meta.color}B3`, `${meta.color}4D`, `${meta.color}1A`]}
                      locations={[0, 0.55, 1]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={StyleSheet.absoluteFillObject}
                    />
                    <View style={styles.cardHeader}>
                      <View>
                        <Text style={styles.tableTitle}>T{String(item.number).padStart(2, '0')}</Text>
                        <View style={styles.seatsRow}>
                          <Ionicons name="people-outline" size={11} color={QuinckleColors.textTertiary} />
                          <Text style={styles.seatsText}>{item.seats} seats</Text>
                        </View>
                      </View>
                    </View>

                    <View style={styles.cardBottom}>
                      {item.status === 'occupied' ? (
                        <View>
                          <Text style={styles.billAmount}>₹{(item.billAmount ?? 0).toLocaleString()}</Text>
                          <Text style={styles.billSubtitle}>{item.since ? `since ${item.since}` : 'active session'}</Text>
                        </View>
                      ) : item.status === 'available' ? (
                        <View style={styles.actionPrompt}>
                          <Ionicons name="add" size={13} color={QuinckleColors.textTertiary} />
                          <Text style={styles.actionPromptText}>Start session</Text>
                        </View>
                      ) : (
                        <Text style={styles.actionPromptText}>Marked offline</Text>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <Ionicons name="grid-outline" size={28} color={QuinckleColors.textTertiary} />
                  <Text style={styles.emptyText}>No tables match this filter.</Text>
                </View>
              }
            />
          )}
        </>
      ) : activeTab === 'menu' ? (
        <>
          {/* Main menu view */}
          {isLoadingMenu ? (
            <MenuSkeleton />
          ) : (
            <ScrollView style={styles.tabContent} showsVerticalScrollIndicator={false}>
              {/* Two shortcut tiles */}
              <View style={styles.menuTileRow}>
                <TouchableOpacity
                  style={[styles.menuTile, { opacity: combos.length === 0 ? 0.45 : 1 }]}
                  onPress={() => combos.length > 0 && router.push('/(staff)/combos')}
                  activeOpacity={0.75}
                >
                  <LinearGradient
                    colors={['rgba(245, 158, 11, 0.18)', 'rgba(255, 255, 255, 0.03)', 'transparent']}
                    style={StyleSheet.absoluteFillObject}
                    start={{ x: 0.5, y: 0 }}
                    end={{ x: 0.5, y: 1 }}
                  />
                  <Image
                    source={require('../../assets/images/icons/staff/menu/combo icon.webp')}
                    style={styles.menuTileImg}
                  />
                  <View style={styles.menuTileTextCol}>
                    <Text style={styles.menuTileLabel}>Combos</Text>
                    <Text style={styles.menuTileCount}>{combos.length} deal{combos.length !== 1 ? 's' : ''}</Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.menuTile, { opacity: !highlightedSection ? 0.45 : 1 }]}
                  onPress={() => highlightedSection && router.push('/(staff)/featured')}
                  activeOpacity={0.75}
                >
                  <LinearGradient
                    colors={['rgba(0, 112, 244, 0.18)', 'rgba(255, 255, 255, 0.03)', 'transparent']}
                    style={StyleSheet.absoluteFillObject}
                    start={{ x: 0.5, y: 0 }}
                    end={{ x: 0.5, y: 1 }}
                  />
                  <Image
                    source={require('../../assets/images/icons/staff/menu/featured icon.webp')}
                    style={styles.menuTileImg}
                  />
                  <View style={styles.menuTileTextCol}>
                    <Text style={styles.menuTileLabel}>Featured</Text>
                    <Text style={styles.menuTileCount}>
                      {highlightedSection ? `${highlightedSection.itemIds?.length ?? 0} item${highlightedSection.itemIds?.length !== 1 ? 's' : ''}` : 'Not set'}
                    </Text>
                  </View>
                </TouchableOpacity>
              </View>

              {/* Search + Category chips */}
              <View style={[styles.searchBoxFull, { marginBottom: 8 }]}>
                <Ionicons name="search" size={15} color={QuinckleColors.textTertiary} />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search menu items…"
                  placeholderTextColor={QuinckleColors.textTertiary}
                  value={searchText}
                  onChangeText={setSearchText}
                />
              </View>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipScroll} style={styles.chipRow}>
                {menuCategories.map(cat => (
                  <TouchableOpacity key={cat} style={[styles.chip, menuFilter === cat && styles.chipActive]} onPress={() => setMenuFilter(cat)}>
                    <Text style={[styles.chipText, menuFilter === cat && styles.chipTextActive]}>{cat}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Menu Items */}
              {menuData
                .filter(item => (menuFilter === 'All' || item.category === menuFilter) && item.name.toLowerCase().includes(searchText.toLowerCase()))
                .map(item => (
                  <View key={item.id} style={styles.menuItemRow}>
                    <View style={styles.menuItemLeft}>
                      {item.image
                        ? <Image source={{ uri: item.image }} style={[styles.menuItemImage, !item.available && styles.dimmed]} />
                        : <View style={[styles.menuItemImagePlaceholder, !item.available && styles.dimmed]}><Ionicons name="fast-food-outline" size={20} color={QuinckleColors.textTertiary} /></View>}
                      <View style={styles.menuItemInfo}>
                        <Text style={[styles.menuItemName, !item.available && styles.dimmedText]}>{item.name}</Text>
                        <Text style={styles.menuItemPrice}>₹{item.price}</Text>
                      </View>
                    </View>
                    <TouchableOpacity
                      onPress={() => setMenuData(prev => prev.map(m => m.id === item.id ? { ...m, available: !m.available } : m))}
                      style={[styles.toggleBase, item.available ? styles.toggleOn : styles.toggleOff]}
                    >
                      <View style={[styles.toggleCircle, item.available ? styles.toggleCircleOn : styles.toggleCircleOff]} />
                    </TouchableOpacity>
                  </View>
                ))}
              <View style={{ height: 120 }} />
            </ScrollView>
          )}
        </>

      ) : activeTab === 'orders' ? (
        <View style={styles.tabContent}>

          <View style={styles.segmentWrap}>
            <PickupSegmented
              items={[
                { key: 'active', label: 'Active', count: activePickupOrders.length },
                { key: 'completed', label: 'Completed', count: completedPickupOrders.length },
              ]}
              active={ordersSubTab}
              onChange={(key) => setOrdersSubTab(key as 'active' | 'completed')}
            />
          </View>

          <FlatList
            data={ordersSubTab === 'active' ? activePickupOrders : completedPickupOrders}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.orderListContent}
            renderItem={({ item }) => (
              <PickupCard
                order={item}
                isCompleting={completingIds.includes(item.id)}
                onToggleItem={(itemId) => togglePickupItem(item.id, itemId)}
                onCompletionFinished={() => handleCompletionFinished(item.id)}
                onReopen={item.completedAt ? () => reopenOrder(item.id) : undefined}
              />
            )}
            ListEmptyComponent={
              <View style={styles.emptyOrders}>
                <Ionicons
                  name={ordersSubTab === 'active' ? 'checkmark-circle-outline' : 'time-outline'}
                  size={36}
                  color={QuinckleColors.textTertiary}
                  style={styles.emptyOrdersIcon}
                />
                <Text style={styles.emptyOrdersText}>
                  {ordersSubTab === 'active'
                    ? 'All caught up.\nThe kitchen has nothing pending.'
                    : 'Served orders appear here for an hour.'}
                </Text>
              </View>
            }
          />
        </View>
      ) : null}

      <BottomNavbar activeTab={activeTab as any} onTabChange={setActiveTab as any} />

      <ThemedDialog
        visible={dialog.visible}
        title={dialog.title}
        message={dialog.message}
        actions={dialog.actions}
        onClose={closeDialog}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    backgroundColor: QuinckleColors.background,
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
    color: QuinckleColors.success,
    fontSize: 12,
    fontWeight: '500',
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
    flexWrap: 'wrap',
  },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(129, 140, 248, 0.4)',
  },
  roleBadgeText: {
    color: '#A5B4FC',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  avatarBtn: {
    width: 45,
    height: 45,
    borderRadius: 10,
    borderWidth: 1.5,
    padding: 1.5,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 10,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  refreshBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: QuinckleColors.surfaceMuted,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cashIconBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'visible',
    top: 5
  },
  cashIconImage: {
    width: 108,
    height: 108,
    marginTop: 2,
  },
  cashBadge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: '#ef4444',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: QuinckleColors.background,
  },
  cashBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
    lineHeight: 12,
  },

  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: QuinckleColors.surfaceMuted,
    borderColor: QuinckleColors.border,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    height: 40,
    gap: Spacing.sm,
  },
  searchBoxFull: {
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
  filterDropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: QuinckleColors.surfaceMuted,
    borderColor: QuinckleColors.border,
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    height: 40,
    gap: 6,
  },
  filterValueText: {
    color: QuinckleColors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.xl,
  },
  dropdownMenu: {
    width: '85%',
    backgroundColor: QuinckleColors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.sm,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
  },
  menuLabel: {
    color: QuinckleColors.textTertiary,
    fontSize: 11,
    fontWeight: '600',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderRadius: Radius.sm,
  },
  menuItemActive: {
    backgroundColor: QuinckleColors.primarySoft,
  },
  menuItemText: {
    color: QuinckleColors.textPrimary,
    fontSize: 15,
    fontWeight: '500',
  },
  menuItemTextActive: {
    color: QuinckleColors.primary,
    fontWeight: '600',
  },
  menuItemCount: {
    color: QuinckleColors.textTertiary,
    fontSize: 13,
    fontWeight: '500',
  },

  listContent: {
    paddingBottom: 100,
    gap: Spacing.md,
  },
  columnWrapper: {
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  tableCard: {
    flex: 1,
    backgroundColor: QuinckleColors.surface,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    minHeight: 130,
    justifyContent: 'space-between',
    maxWidth: '49%',
    overflow: 'hidden',
  },
  offlineCard: {
    opacity: 0.55,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  tableTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: QuinckleColors.textPrimary,
    letterSpacing: -0.4,
  },
  seatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  seatsText: {
    color: QuinckleColors.textTertiary,
    fontSize: 11,
    fontWeight: '500',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
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
  },
  cardBottom: {
    marginTop: Spacing.md,
  },
  billAmount: {
    color: QuinckleColors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  billSubtitle: {
    color: QuinckleColors.textTertiary,
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
  },
  actionPrompt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  actionPromptText: {
    color: QuinckleColors.textTertiary,
    fontSize: 12,
    fontWeight: '500',
  },

  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.huge,
    gap: Spacing.md,
  },
  emptyText: {
    color: QuinckleColors.textTertiary,
    fontSize: 14,
  },
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.huge,
  },
  loadingText: {
    color: QuinckleColors.textTertiary,
    fontSize: 14,
  },

  tabContent: {
    flex: 1,
  },

  chipRow: {
    marginBottom: Spacing.md,
    flexGrow: 0,
  },
  chipScroll: {
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  chip: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: 10,
    borderRadius: Radius.pill,
    backgroundColor: QuinckleColors.surfaceMuted,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
  },
  chipActive: {
    backgroundColor: QuinckleColors.primarySoft,
    borderColor: QuinckleColors.primarySoftBorder,
  },
  chipText: {
    color: QuinckleColors.textSecondary,
    fontSize: 13,
    fontWeight: '500',
  },
  chipTextActive: {
    color: QuinckleColors.primary,
    fontWeight: '600',
  },

  menuListContent: {
    paddingBottom: 100,
  },
  menuSection: { marginBottom: 20 },
  menuSectionHeader: { paddingHorizontal: 16, marginBottom: 10 },
  menuSectionEyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 1.2, color: QuinckleColors.primary, marginBottom: 2 },
  menuSectionTitle: { fontSize: 18, fontWeight: '700', color: QuinckleColors.textPrimary, letterSpacing: -0.4 },
  menuSectionSub: { fontSize: 12, color: QuinckleColors.textSecondary, marginTop: 2 },
  featuredCardImgPlaceholder: { alignItems: 'center' as const, justifyContent: 'center' as const },

  // Two shortcut tiles
  menuTileRow: {
    flexDirection: 'row' as const,
    gap: 12,
    marginBottom: 16,
    marginTop: 4,
  },
  menuTile: {
    flex: 1,
    backgroundColor: 'rgba(20,20,22,0.6)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 16,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    overflow: 'hidden',
  },
  menuTileTextCol: {
    alignItems: 'center',
    gap: 2,
  },
  menuTileImg: {
    width: 140,
    height: 140,
    resizeMode: 'contain',
    marginTop: -25,
    marginBottom: -35,
  },
  menuTileLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: QuinckleColors.textPrimary,
    letterSpacing: -0.3,
  },
  menuTileCount: {
    fontSize: 11,
    color: QuinckleColors.textTertiary,
    fontWeight: '500',
  },

  // Sub-screen header
  subScreenHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  breadcrumbBack: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 2,
  },
  breadcrumbParent: {
    fontSize: 14,
    color: QuinckleColors.textTertiary,
    fontWeight: '500',
  },
  breadcrumbCurrent: {
    fontSize: 14,
    color: QuinckleColors.textPrimary,
    fontWeight: '700',
    letterSpacing: -0.2,
  },

  // Combo list card (in sub-screen)
  comboListCard: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    overflow: 'hidden' as const,
  },
  comboListImg: { width: '100%' as any, height: 180, backgroundColor: 'rgba(255,255,255,0.06)' },
  comboListBody: { paddingHorizontal: 16, paddingVertical: 14 },
  featuredSectionHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    backgroundColor: 'rgba(243,93,59,0.06)',
  },
  featuredSectionEyebrow: {
    fontSize: 10,
    fontWeight: '800',
    color: QuinckleColors.primary,
    letterSpacing: 1,
  },
  featuredItemsDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginVertical: 12,
  },
  featuredItemsLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: QuinckleColors.textTertiary,
    letterSpacing: 0.8,
    textTransform: 'uppercase' as const,
    marginBottom: 8,
  },
  featuredItemRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.04)',
  },
  featuredItemThumb: {
    width: 44,
    height: 44,
    borderRadius: 8,
    overflow: 'hidden' as const,
  },
  featuredItemName: {
    fontSize: 13,
    fontWeight: '600',
    color: QuinckleColors.textPrimary,
  },
  featuredItemPrice: {
    fontSize: 12,
    color: QuinckleColors.primary,
    fontWeight: '700',
    marginTop: 2,
  },
  featuredUnavailableBadge: {
    position: 'absolute' as const,
    top: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  featuredUnavailableText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const,
  },
  comboListName: { fontSize: 15, fontWeight: '700', color: QuinckleColors.textPrimary, letterSpacing: -0.2 },
  comboListDesc: { fontSize: 12, color: QuinckleColors.textSecondary, marginTop: 4, lineHeight: 17 },
  comboItemList: { fontSize: 12, color: QuinckleColors.textSecondary, flex: 1 },
  comboItemsBlock: { marginTop: 10, gap: 6 },
  comboItemsLabel: {
    fontSize: 10, fontWeight: '700', color: QuinckleColors.textTertiary,
    letterSpacing: 0.8, textTransform: 'uppercase' as const, marginBottom: 4,
  },
  comboItemEntry: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8,
  },
  comboItemDot: {
    width: 4, height: 4, borderRadius: 2,
    backgroundColor: QuinckleColors.primary, flexShrink: 0,
  },
  comboItemPrice: {
    fontSize: 12, fontWeight: '600', color: QuinckleColors.textTertiary,
  },

  comboBadge: {
    backgroundColor: QuinckleColors.primary,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  comboBadgeText: { fontSize: 9, fontWeight: '800', color: '#fff', letterSpacing: 0.4 },
  comboCardPrice: { fontSize: 15, fontWeight: '800', color: QuinckleColors.primary },
  comboCardOrig: { fontSize: 12, color: QuinckleColors.textTertiary, textDecorationLine: 'line-through' as const },
  menuItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: QuinckleColors.borderSubtle,
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: Spacing.md,
  },
  menuItemImage: {
    width: 58,
    height: 58,
    borderRadius: Radius.sm,
    backgroundColor: QuinckleColors.surfaceMuted,
  },
  menuItemImagePlaceholder: {
    width: 58,
    height: 58,
    borderRadius: Radius.sm,
    backgroundColor: QuinckleColors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuItemInfo: {
    flex: 1,
    gap: 2,
  },
  menuItemName: {
    color: QuinckleColors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  menuItemPrice: {
    color: QuinckleColors.textSecondary,
    fontSize: 13,
    fontWeight: '500',
  },
  dimmed: {
    opacity: 0.4,
  },
  dimmedText: {
    color: QuinckleColors.textTertiary,
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

  sectionHeading: {
    paddingVertical: Spacing.md,
    marginBottom: Spacing.sm,
  },
  sectionTitle: {
    color: QuinckleColors.textPrimary,
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  sectionSubtitle: {
    color: QuinckleColors.textTertiary,
    fontSize: 13,
    marginTop: 2,
  },

  orderListContent: {
    paddingBottom: 100,
  },
  segmentWrap: {
    marginBottom: Spacing.md,
  },
  emptyOrders: {
    paddingVertical: Spacing.huge,
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
    gap: Spacing.md,
  },
  emptyOrdersIcon: {
    opacity: 0.6,
  },
  emptyOrdersText: {
    color: QuinckleColors.textTertiary,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 20,
  },

  activityListContent: {
    paddingBottom: 100,
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
  stickyHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    overflow: 'hidden',
  },
  stickyHeaderBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#141416',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: QuinckleColors.border,
  },
  stickyHeaderContent: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
  },
  headerActionBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  stickyHeaderTitleText: {
    color: QuinckleColors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  heroContainer: {
    height: 220,
    width: '100%',
    position: 'relative',
    overflow: 'hidden',
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroTextSection: {
    position: 'absolute',
    bottom: Spacing.md,
    left: Spacing.lg,
    gap: Spacing.xs,
    maxWidth: '65%',
  },
  heroTitle: {
    color: QuinckleColors.textPrimary,
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  statPill: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  statPillText: {
    color: QuinckleColors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },

});
