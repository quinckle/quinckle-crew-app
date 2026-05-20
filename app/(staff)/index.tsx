import React, { useMemo, useState, useEffect } from 'react';
import {
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
import { useAuth } from '../../context/AuthContext';
import { crewTables, crewSessions, crewOrders, restaurantApi } from '../../services/api';
import type { ActiveOrder, MenuItem } from '../../services/api';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { Audio } from 'expo-av';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';
import { ThemedDialog } from '../../components/ui/themed-dialog';
import { BottomNavbar } from '../../components/ui/BottomNavbar';
import { PICKUP_LAYOUT_PRESET, PickupCard, PickupSegmented } from '../../components/ui/pickup';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

type NavItem = 'tables' | 'menu' | 'orders' | 'activity' | 'profile' | 'cash_ledger';
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

type PickupItem = { id: string; name: string; qty: number; orderedAt: string; isServed: boolean };
type PickupOrder = { id: string; tableNo: string; items: PickupItem[]; completedAt?: string };

const READY_ORDERS_INITIAL: PickupOrder[] = [
  { id: 'o1', tableNo: 'T02', items: [{ id: 'i1', name: 'Chicken Biryani', qty: 2, orderedAt: '14:05', isServed: false }] },
  { id: 'o2', tableNo: 'T05', items: [
    { id: 'i2', name: 'Cold Coffee', qty: 1, orderedAt: '14:15', isServed: false },
    { id: 'i3', name: 'Lemon Soda', qty: 1, orderedAt: '14:16', isServed: false },
  ]},
  { id: 'o3', tableNo: 'T01', items: [{ id: 'i4', name: 'Paneer Tikka', qty: 1, orderedAt: '14:20', isServed: false }] },
  { id: 'o4', tableNo: 'T04', items: [
    { id: 'i5', name: 'Butter Chicken', qty: 1, orderedAt: '13:30', isServed: true },
    { id: 'i6', name: 'Garlic Naan', qty: 2, orderedAt: '13:31', isServed: true },
  ], completedAt: '13:55' },
];

const ACTIVITY_DATA = [
  { id: '1', message: 'Collected ₹2,050 cash from Table T01', date: '10 May', time: '14:20' },
  { id: '2', message: 'Marked Table T03 as free', date: '10 May', time: '14:15' },
  { id: '3', message: 'Started new session at Table T02', date: '10 May', time: '14:05' },
  { id: '4', message: 'Marked “Chocolate Brownie” as out of stock', date: '09 May', time: '13:50' },
  { id: '5', message: 'Collected ₹1,280 cash from Table T05', date: '09 May', time: '13:30' },
  { id: '6', message: 'Marked Table T11 as offline', date: '09 May', time: '13:10' },
];

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
  const { logout, staffInfo } = useAuth();
  const [activeTab, setActiveTab] = useState<NavItem>('tables');
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [filterVisible, setFilterVisible] = useState(false);
  const [tables, setTables] = useState<Table[]>(INITIAL_TABLES);
  const [isLoadingTables, setIsLoadingTables] = useState(true);
  const [menuData, setMenuData] = useState(MENU_DATA_INITIAL);
  const [menuCategories, setMenuCategories] = useState<string[]>(['All', 'Appetizers', 'Mains', 'Beverages', 'Desserts']);
  const [activeFilter, setActiveFilter] = useState<'all' | TableStatus | string>('all');
  const [menuFilter, setMenuFilter] = useState('All');
  const [searchText, setSearchText] = useState('');
  const [isOnline, setIsOnline] = useState(true);
  const [pickupOrders, setPickupOrders] = useState<PickupOrder[]>(READY_ORDERS_INITIAL);
  const [liveOrders, setLiveOrders] = useState<ActiveOrder[]>([]);
  const [ordersSubTab, setOrdersSubTab] = useState<'active' | 'completed'>('active');
  const [completingIds, setCompletingIds] = useState<string[]>([]);
  const [shiftStart, setShiftStart] = useState<Date | null>(new Date(Date.now() - 4.5 * 60 * 60 * 1000)); // Mock: Started 4.5h ago
  const [activeDuration, setActiveDuration] = useState("04h 30m");
  const [shiftPeriod, setShiftPeriod] = useState<'today' | 'week'>('today');
  const [shiftLogs, setShiftLogs] = useState([
    { d: 'Mon', t: '09:30 - 18:30', h: 9.0 },
    { d: 'Tue', t: '10:00 - 18:00', h: 8.0 },
    { d: 'Wed', t: '09:00 - 17:00', h: 8.0 },
  ]);

  // Timer to update active duration
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
      interval = setInterval(updateDuration, 60000); // Update every minute
    } else {
      setActiveDuration("--");
    }
    return () => clearInterval(interval);
  }, [isOnline, shiftStart]);

  const handleToggleOnline = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (isOnline) {
      // Clocking out: Add current session to logs if it's significant
      if (shiftStart) {
        const diff = Date.now() - shiftStart.getTime();
        const hours = diff / (1000 * 60 * 60);
        if (hours > 0.05) { // Only log if > 3 mins
          const startTimeStr = `${String(shiftStart.getHours()).padStart(2, '0')}:${String(shiftStart.getMinutes()).padStart(2, '0')}`;
          const endTimeStr = formatNow();
          const dayStr = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date().getDay()];
          setShiftLogs(prev => [...prev, { d: dayStr, t: `${startTimeStr} - ${endTimeStr}`, h: parseFloat(hours.toFixed(1)) }]);
        }
      }
      setShiftStart(null);
    } else {
      // Clocking in
      setShiftStart(new Date());
    }
    setIsOnline(!isOnline);
  };

  const chartData = useMemo(() => {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const currentDayIndex = (new Date().getDay() + 6) % 7; // 0=Mon, 6=Sun
    
    return days.map((day, i) => {
      let hours = 0;
      if (i === currentDayIndex) {
        // Today
        const sessionHours = (isOnline && shiftStart) ? (Date.now() - shiftStart.getTime()) / (1000 * 60 * 60) : 0;
        hours = sessionHours;
      } else {
        // From logs
        const log = shiftLogs.find(l => l.d === day);
        hours = log ? log.h : 0;
      }
      // Scale: 12 hours is 100% height
      const percentage = Math.min((hours / 12) * 100, 100);
      return { day, percentage, isToday: i === currentDayIndex, label: day[0] };
    });
  }, [shiftLogs, shiftStart, isOnline]);

  const totalTodayHours = useMemo(() => {
    const dayStr = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date().getDay()];
    const logsToday = shiftLogs.filter(l => l.d === dayStr || (l.d === 'Today' && dayStr === dayStr)); // Handle 'Today' label
    const completedHours = logsToday.reduce((acc, curr) => acc + curr.h, 0);
    const activeHours = (isOnline && shiftStart) ? (Date.now() - shiftStart.getTime()) / (1000 * 60 * 60) : 0;
    const total = completedHours + activeHours;
    const h = Math.floor(total);
    const m = Math.floor((total - h) * 60);
    return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m`;
  }, [shiftLogs, isOnline, shiftStart]);

  useEffect(() => {
    (async () => {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;
      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }
      if (finalStatus !== 'granted') {
        console.warn('Failed to get push token for push notification!');
      }
    })();
  }, []);

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

  const formatNow = () => {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  };

  const togglePickupItem = (orderId: string, itemId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    let didCompleteAll = false;
    let didReopen = false;

    setPickupOrders((prev) =>
      prev.map((order) => {
        if (order.id !== orderId) return order;
        const items = order.items.map((it) =>
          it.id === itemId ? { ...it, isServed: !it.isServed } : it,
        );
        const allServed = items.every((it) => it.isServed);
        const wasComplete = !!order.completedAt;
        const next: PickupOrder = { ...order, items };

        if (!allServed && wasComplete) {
          next.completedAt = undefined;
          didReopen = true;
        }
        if (allServed && !wasComplete) {
          didCompleteAll = true;
        }
        return next;
      }),
    );

    if (didCompleteAll) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCompletingIds((prev) => (prev.includes(orderId) ? prev : [...prev, orderId]));
    }

    if (didReopen) {
      setCompletingIds((prev) => prev.filter((id) => id !== orderId));
    }
  };

  const handleCompletionFinished = (orderId: string) => {
    LayoutAnimation.configureNext(PICKUP_LAYOUT_PRESET);
    setPickupOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, completedAt: formatNow() } : o)),
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
      const apiTables: Table[] = (res?.tables ?? []).map((t: any) => ({
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
      }));
      if (apiTables.length > 0) setTables(apiTables);
    } catch {
      // Keep mock data if API fails
    } finally {
      setIsLoadingTables(false);
    }
  };

  const loadMenuFromApi = async () => {
    if (!staffInfo?.restaurantId) return;
    try {
      const res = await restaurantApi.get(staffInfo.restaurantId);
      const items = res.data?.menuItems ?? [];
      if (items.length > 0) {
        setMenuData(items.map((item: any) => ({
          id: item.id,
          name: item.name,
          price: parseFloat(item.price),
          category: item.category,
          available: item.isAvailable,
          image: item.imageUrl ?? undefined,
        })));
        const cats = ['All', ...Array.from(new Set(items.map((i: any) => i.category as string)))];
        setMenuCategories(cats as string[]);
        setMenuFilter('All');
      }
    } catch { /* keep mock */ }
  };

  const loadPickupOrders = async () => {
    try {
      const res = await crewOrders.getActive();
      setLiveOrders(res.orders ?? []);
      // Map READY orders to the pickup format
      const readyOrders = (res.orders ?? []).filter(o => o.status === 'ready');
      if (readyOrders.length > 0 || liveOrders.length > 0) {
        setPickupOrders(
          readyOrders.map(order => ({
            id: order.order_id,
            tableNo: `T${String(order.table_number).padStart(2, '0')}`,
            items: order.items.map(item => ({
              id: item.item_id,
              name: `${item.qty}× ${item.name}`,
              qty: item.qty,
              orderedAt: (() => { const d = new Date(order.placed_at); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; })(),
              isServed: item.served,
            })),
          }))
        );
      }
    } catch { /* keep current */ }
  };

  useEffect(() => {
    loadTables();
    loadMenuFromApi();
    loadPickupOrders();
    const interval = setInterval(() => { void loadPickupOrders(); void loadTables(); }, 15000);
    return () => clearInterval(interval);
  }, [staffInfo?.restaurantId]);

  const updateTableStatus = async (tableNum: number, nextStatus: TableStatus) => {
    // Optimistic local update
    setTables(prev => prev.map(t => (t.number === tableNum ? { ...t, status: nextStatus } : t)));

    // Only 'available' and 'reserved' are supported by the API
    if (nextStatus === 'available' || nextStatus === 'reserved') {
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
          { label: 'Cancel', onPress: () => {} },
          { label: 'Make Available', variant: 'primary', onPress: () => { void updateTableStatus(tableNum, 'available'); } },
        ],
      );
      return;
    }

    if (currentStatus === 'available') {
      showDialog(`New Session`, `Start a new session for Table T${String(tableNum).padStart(2, '0')}?`, [
        { label: 'Cancel', onPress: () => {} },
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
          { label: 'Cancel', onPress: () => {} },
          { label: 'Mark Offline', variant: 'danger', onPress: () => { void updateTableStatus(tableNum, 'offline'); } },
        ],
      );
    } else if (status === 'offline') {
      showDialog(
        'Manage Table',
        `Make Table T${String(tableNum).padStart(2, '0')} available for guests?`,
        [
          { label: 'Cancel', onPress: () => {} },
          { label: 'Make Available', variant: 'primary', onPress: () => { void updateTableStatus(tableNum, 'available'); } },
        ],
      );
    }
  };

  const handleLogout = () => {
    // Automated clock-out on logout
    if (isOnline && shiftStart) {
      const diff = Date.now() - shiftStart.getTime();
      const hours = diff / (1000 * 60 * 60);
      const startTimeStr = `${String(shiftStart.getHours()).padStart(2, '0')}:${String(shiftStart.getMinutes()).padStart(2, '0')}`;
      const endTimeStr = formatNow();
      console.log(`Auto clock-out: ${startTimeStr} - ${endTimeStr} (${hours.toFixed(1)}h)`);
    }
    
    logout();
    router.replace('/login');
  };

  const FILTER_CHIPS = [
    { key: 'all', label: 'All', count: counts.all },
    { key: 'available', label: 'Available', count: counts.available },
    { key: 'occupied', label: 'Occupied', count: counts.occupied },
  ] as const;

  const showHeader = activeTab !== 'profile' && activeTab !== 'cash_ledger' && activeTab !== 'activity';

  return (
    <View style={[styles.container, { paddingTop: insets.top + Spacing.sm }]}>
      {showHeader && (
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
            onPress={() => setActiveTab('profile')}
            activeOpacity={0.7}
          >
            <Image
              source={{ uri: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?q=80&w=200&h=200&auto=format&fit=crop' }}
              style={styles.avatarImage}
            />
          </TouchableOpacity>
        </View>
      )}

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

          <FlatList
            data={filteredTables}
            keyExtractor={(item) => item.id}
            numColumns={2}
            columnWrapperStyle={styles.columnWrapper}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => {
              const meta = STATUS_META[item.status] || STATUS_META.available;
              return (
                <TouchableOpacity
                  style={[styles.tableCard, item.status === 'offline' && styles.offlineCard]}
                  onPress={() => handleTablePress(item.number, item.status)}
                  onLongPress={() => handleLongPress(item.id, item.status)}
                  activeOpacity={0.85}
                  delayLongPress={500}
                >
                  <View style={styles.cardHeader}>
                    <View>
                      <Text style={styles.tableTitle}>T{String(item.number).padStart(2, '0')}</Text>
                      <View style={styles.seatsRow}>
                        <Ionicons name="people-outline" size={11} color={QuinckleColors.textTertiary} />
                        <Text style={styles.seatsText}>{item.seats} seats</Text>
                      </View>
                    </View>
                    <View style={[styles.statusPill, { backgroundColor: `${meta.color}1F`, borderColor: `${meta.color}40` }]}>
                      <View style={[styles.statusPillDot, { backgroundColor: meta.color }]} />
                      <Text style={[styles.statusPillText, { color: meta.color }]}>{meta.label}</Text>
                    </View>
                  </View>

                  <View style={styles.cardBottom}>
                    {item.status === 'occupied' ? (
                      <View>
                        <Text style={styles.billAmount}>₹{item.billAmount?.toLocaleString() || '—'}</Text>
                        <Text style={styles.billSubtitle}>since {item.since}</Text>
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
        </>
      ) : activeTab === 'menu' ? (
        <View style={styles.tabContent}>
          <View style={styles.searchBoxFull}>
            <Ionicons name="search" size={15} color={QuinckleColors.textTertiary} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search menu items…"
              placeholderTextColor={QuinckleColors.textTertiary}
              value={searchText}
              onChangeText={setSearchText}
            />
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipScroll}
            style={styles.chipRow}
          >
            {menuCategories.map((cat) => (
              <TouchableOpacity
                key={cat}
                style={[styles.chip, menuFilter === cat && styles.chipActive]}
                onPress={() => setMenuFilter(cat)}
              >
                <Text style={[styles.chipText, menuFilter === cat && styles.chipTextActive]}>{cat}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <FlatList
            data={menuData.filter((item) =>
              (menuFilter === 'All' || item.category === menuFilter) &&
              item.name.toLowerCase().includes(searchText.toLowerCase()),
            )}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.menuListContent}
            renderItem={({ item }) => (
              <View style={styles.menuItemRow}>
                <View style={styles.menuItemLeft}>
                  {item.image ? (
                    <Image source={{ uri: item.image }} style={[styles.menuItemImage, !item.available && styles.dimmed]} />
                  ) : (
                    <View style={[styles.menuItemImagePlaceholder, !item.available && styles.dimmed]}>
                      <Ionicons name="fast-food-outline" size={20} color={QuinckleColors.textTertiary} />
                    </View>
                  )}
                  <View style={styles.menuItemInfo}>
                    <Text style={[styles.menuItemName, !item.available && styles.dimmedText]}>{item.name}</Text>
                    <Text style={styles.menuItemPrice}>₹{item.price}</Text>
                  </View>
                </View>
                <TouchableOpacity
                  onPress={() => setMenuData((prev) => prev.map((m) => (m.id === item.id ? { ...m, available: !m.available } : m)))}
                  style={[styles.toggleBase, item.available ? styles.toggleOn : styles.toggleOff]}
                >
                  <View style={[styles.toggleCircle, item.available ? styles.toggleCircleOn : styles.toggleCircleOff]} />
                </TouchableOpacity>
              </View>
            )}
          />
        </View>
      ) : activeTab === 'orders' ? (
        <View style={styles.tabContent}>
          <View style={[styles.sectionHeading, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
            <View>
              <Text style={styles.sectionTitle}>Kitchen Pickup</Text>
              <Text style={styles.sectionSubtitle}>Tap a tick to mark items served</Text>
            </View>
            <TouchableOpacity onPress={simulateNewOrder} style={{ padding: 8, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 8 }}>
              <Ionicons name="notifications-outline" size={20} color={QuinckleColors.primary} />
            </TouchableOpacity>
          </View>

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
                <Text style={styles.emptyOrdersText}>
                  {ordersSubTab === 'active'
                    ? 'All caught up — kitchen has nothing pending.'
                    : 'Completed orders show up here.'}
                </Text>
              </View>
            }
          />
        </View>
      ) : activeTab === 'profile' ? (
        <ScrollView style={styles.tabContent} contentContainerStyle={styles.profileContent}>
          <View style={styles.profileHeaderRow}>
            <TouchableOpacity style={styles.iconBtn} onPress={() => setActiveTab('tables')}>
              <Ionicons name="chevron-back" size={20} color={QuinckleColors.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.screenTitle}>Profile</Text>
            <View style={styles.iconBtnPlaceholder} />
          </View>

          <View style={styles.profileHero}>
            <View style={styles.profileImageContainer}>
              <Image
                source={{ uri: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?q=80&w=200&h=200&auto=format&fit=crop' }}
                style={styles.profileImage}
              />
              <View style={styles.uploadBadge}>
                <Ionicons name="camera" size={12} color="#fff" />
              </View>
            </View>
            <Text style={styles.profileName}>{staffInfo?.name ?? 'Staff Member'}</Text>
            <Text style={styles.profilePhone}>{staffInfo?.restaurantName ?? 'The Grill Room'}</Text>
          </View>

          <View style={styles.card}>
            <View style={styles.dutyRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>Duty Status</Text>
                <Text style={styles.cardSubtitle}>
                  {isOnline ? 'Receiving live orders' : 'Currently off-duty'}
                </Text>
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
                <Text style={[styles.shiftStatValue, isOnline && { color: QuinckleColors.success }]}>
                  {activeDuration}
                </Text>
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

          <TouchableOpacity style={styles.card} onPress={() => setActiveTab('cash_ledger')} activeOpacity={0.7}>
            <View style={styles.cashRow}>
              <View style={styles.cashIcon}>
                <Ionicons name="wallet-outline" size={20} color={QuinckleColors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>Cash Collected</Text>
                <Text style={styles.cashValue}>₹48,250</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={QuinckleColors.textTertiary} />
            </View>
          </TouchableOpacity>

          <View style={styles.card}>
            <View style={styles.cardHeaderRow}>
              <View>
                <Text style={styles.cardTitle}>Shift Insights</Text>
                <Text style={styles.cardSubtitle}>
                  {shiftPeriod === 'today' ? "Today's session details" : "Performance this week"}
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
              {chartData.map((data, i) => {
                return (
                  <View key={i} style={styles.dayColumn}>
                    <View style={styles.dayBarTrack}>
                      <View style={[
                        styles.dayBar, 
                        { height: `${data.percentage}%` },
                        data.isToday ? { backgroundColor: QuinckleColors.primary } : { backgroundColor: QuinckleColors.primarySoftBorder }
                      ]} />
                    </View>
                    <Text style={[styles.dayLabel, data.isToday && { color: QuinckleColors.primary, fontWeight: '700' }]}>
                      {data.label}
                    </Text>
                  </View>
                );
              })}
            </View>
            
            <View style={styles.timingDetails}>
              {shiftPeriod === 'today' ? (
                <View style={styles.todayTiming}>
                  <View style={styles.timingRow}>
                    <Ionicons name="time-outline" size={14} color={QuinckleColors.textTertiary} />
                    <Text style={styles.timingText}>Shift Started: <Text style={styles.timingVal}>
                      {shiftStart ? `${String(shiftStart.getHours()).padStart(2, '0')}:${String(shiftStart.getMinutes()).padStart(2, '0')} ${shiftStart.getHours() >= 12 ? 'PM' : 'AM'}` : '--:--'}
                    </Text></Text>
                  </View>
                  <View style={styles.timingRow}>
                    <Ionicons name="log-out-outline" size={14} color={QuinckleColors.textTertiary} />
                    <Text style={styles.timingText}>Current Session: <Text style={styles.timingVal}>{activeDuration}</Text></Text>
                  </View>
                  <View style={styles.timingDivider} />
                  <Text style={styles.timingSummary}>
                    {isOnline 
                      ? `You are currently ${activeDuration} into your shift. Keep it up!` 
                      : "You are currently off-duty. Your timings will appear here once you go online."}
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
                      {(shiftLogs.reduce((acc, curr) => acc + curr.h, 0) + (isOnline && shiftStart ? (Date.now() - shiftStart.getTime()) / (1000 * 60 * 60) : 0)).toFixed(1)} Hours
                    </Text>
                  </View>
                </View>
              )}
            </View>
          </View>

          <TouchableOpacity style={styles.card} onPress={() => setActiveTab('activity')} activeOpacity={0.7}>
            <View style={styles.cashRow}>
              <View style={styles.cashIcon}>
                <Ionicons name="pulse-outline" size={20} color={QuinckleColors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>Recent Activity</Text>
                <Text style={[styles.cardSubtitle, { color: QuinckleColors.textPrimary }]}>Updates from your shift</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={QuinckleColors.textTertiary} />
            </View>
          </TouchableOpacity>

          <Text style={styles.adminText}>
            Contact your restaurant administrator to update profile details.
          </Text>

          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.7}>
            <Ionicons name="log-out-outline" size={18} color={QuinckleColors.danger} />
            <Text style={styles.logoutBtnText}>Log Out</Text>
          </TouchableOpacity>
        </ScrollView>
      ) : activeTab === 'cash_ledger' ? (
        <View style={styles.tabContent}>
          <View style={styles.profileHeaderRow}>
            <TouchableOpacity style={styles.iconBtn} onPress={() => setActiveTab('profile')}>
              <Ionicons name="chevron-back" size={20} color={QuinckleColors.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.screenTitle}>Cash Ledger</Text>
            <View style={styles.iconBtnPlaceholder} />
          </View>

          <FlatList
            data={[
              { date: '10 May', total: 2050, items: [{ id: 'c1', tableNo: 'T01', amount: 2050, time: '14:20' }] },
              { date: '09 May', total: 5590, items: [
                { id: 'c2', tableNo: 'T05', amount: 1280, time: '13:30' },
                { id: 'c3', tableNo: 'T03', amount: 3420, time: '12:45' },
                { id: 'c4', tableNo: 'T11', amount: 890, time: '11:15' },
              ]},
            ]}
            keyExtractor={(item) => item.date}
            contentContainerStyle={styles.ledgerListContent}
            ListHeaderComponent={
              <View style={styles.ledgerSummary}>
                <Text style={styles.ledgerSummaryLabel}>Shift Total</Text>
                <Text style={styles.ledgerSummaryValue}>₹48,250</Text>
              </View>
            }
            renderItem={({ item }) => {
              const isExpanded = expandedDate === item.date;
              return (
                <View style={styles.ledgerCard}>
                  <TouchableOpacity
                    style={styles.ledgerHeader}
                    onPress={() => setExpandedDate(isExpanded ? null : item.date)}
                    activeOpacity={0.6}
                  >
                    <Text style={styles.ledgerDate}>{item.date}</Text>
                    <View style={styles.ledgerHeaderRight}>
                      <Text style={styles.ledgerTotal}>₹{item.total.toLocaleString()}</Text>
                      <Ionicons
                        name={isExpanded ? 'chevron-up' : 'chevron-down'}
                        size={14}
                        color={QuinckleColors.textTertiary}
                      />
                    </View>
                  </TouchableOpacity>

                  {isExpanded && (
                    <View style={styles.ledgerExpanded}>
                      {item.items.map((subItem) => (
                        <View key={subItem.id} style={styles.ledgerSubRow}>
                          <View style={styles.ledgerSubLeft}>
                            <Text style={styles.ledgerSubTable}>{subItem.tableNo}</Text>
                            <Text style={styles.ledgerSubTime}>{subItem.time}</Text>
                          </View>
                          <Text style={styles.ledgerSubAmount}>₹{subItem.amount.toLocaleString()}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              );
            }}
          />
        </View>
      ) : activeTab === 'activity' ? (
        <View style={styles.tabContent}>
          <View style={styles.profileHeaderRow}>
            <TouchableOpacity style={styles.iconBtn} onPress={() => setActiveTab('profile')}>
              <Ionicons name="chevron-back" size={20} color={QuinckleColors.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.screenTitle}>Activity Log</Text>
            <View style={styles.iconBtnPlaceholder} />
          </View>
          <FlatList
            data={ACTIVITY_DATA}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.activityListContent}
            renderItem={({ item }) => (
              <View style={styles.activityItem}>
                <Text style={styles.activityMessage}>{item.message}</Text>
                <View style={styles.activityMeta}>
                  <Text style={styles.activityDate}>{item.date}</Text>
                  <Text style={styles.activityDot}>·</Text>
                  <Text style={styles.activityTime}>{item.time}</Text>
                </View>
              </View>
            )}
          />
        </View>
      ) : null}

      {showHeader && (
        <BottomNavbar activeTab={activeTab as any} onTabChange={setActiveTab as any} />
      )}

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
    color: QuinckleColors.textSecondary,
    fontSize: 12,
    fontWeight: '500',
  },
  avatarBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1.5,
    borderColor: QuinckleColors.primary,
    padding: 1.5,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 18,
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

  tabContent: {
    flex: 1,
  },

  chipRow: {
    marginBottom: Spacing.md,
    flexGrow: 0,
  },
  chipScroll: {
    gap: Spacing.sm,
    paddingRight: Spacing.lg,
  },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
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
    width: 48,
    height: 48,
    borderRadius: Radius.sm,
    backgroundColor: QuinckleColors.surfaceMuted,
  },
  menuItemImagePlaceholder: {
    width: 48,
    height: 48,
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
  },
  emptyOrdersText: {
    color: QuinckleColors.textTertiary,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 21,
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

  cashRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  cashIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.sm,
    backgroundColor: QuinckleColors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cashValue: {
    color: QuinckleColors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    marginTop: 2,
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
  weeklyStats: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.xl,
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: QuinckleColors.borderSubtle,
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
  weeklyStatVal: {
    color: QuinckleColors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  weeklyStatLab: {
    color: QuinckleColors.textTertiary,
    fontSize: 10,
    fontWeight: '500',
    textAlign: 'center',
    marginTop: 2,
  },
  statDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: QuinckleColors.border,
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

  ledgerListContent: {
    paddingBottom: Spacing.huge,
  },
  ledgerSummary: {
    paddingVertical: Spacing.xxl,
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  ledgerSummaryLabel: {
    color: QuinckleColors.textTertiary,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: Spacing.sm,
  },
  ledgerSummaryValue: {
    color: QuinckleColors.textPrimary,
    fontSize: 38,
    fontWeight: '800',
    letterSpacing: -1,
  },
  ledgerCard: {
    backgroundColor: QuinckleColors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    marginBottom: Spacing.sm,
    overflow: 'hidden',
  },
  ledgerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.lg,
  },
  ledgerDate: {
    color: QuinckleColors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  ledgerHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  ledgerTotal: {
    color: QuinckleColors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  ledgerExpanded: {
    borderTopWidth: 1,
    borderTopColor: QuinckleColors.borderSubtle,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  ledgerSubRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: QuinckleColors.borderSubtle,
  },
  ledgerSubLeft: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.sm,
  },
  ledgerSubTable: {
    color: QuinckleColors.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  ledgerSubTime: {
    color: QuinckleColors.textTertiary,
    fontSize: 12,
    fontWeight: '500',
  },
  ledgerSubAmount: {
    color: QuinckleColors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
});
