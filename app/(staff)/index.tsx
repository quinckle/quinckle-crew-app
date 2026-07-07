import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  AppState,
  Dimensions,
  FlatList,
  RefreshControl,
  Image,
  LayoutAnimation,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { LinearGradient } from 'expo-linear-gradient';
import QRCode from 'react-native-qrcode-svg';

const SCREEN_WIDTH = Dimensions.get('window').width;

import { useAuth } from '../../context/AuthContext';
import { Audio } from 'expo-av';
import { crewTables, crewSessions, crewOrders, crewPayments, crewMenu, crewTakeaway, restaurantApi, crewAuth, printerApi } from '../../services/api';
import { subscribeChannel, watchConnection } from '../../services/realtime';
import { printKot, printBill, getStatus as getPrinterStatus, isUpiQrEnabled, setUpiQrMode } from '../../services/printer';
import type { InvoiceBill } from '../../services/invoiceTemplate';
import { setSinkContext, drainPendingPrintJobs, handleSinkSuperseded } from '../../services/printSink';
import { getPrintDeviceId } from '../../services/printDevice';

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
import type { ActiveOrder, MenuItem, TakeawayOrder } from '../../services/api';
import { router } from 'expo-router';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';
import { ThemedDialog } from '../../components/ui/themed-dialog';
import { BottomSheet } from '../../components/ui/BottomSheet';
import { SwapTableSheet } from '../../components/ui/SwapTableSheet';
import { MergeTableSheet } from '../../components/ui/MergeTableSheet';
import { BottomNavbar } from '../../components/ui/BottomNavbar';
import { PICKUP_LAYOUT_PRESET, PickupCard, PickupSegmented } from '../../components/ui/pickup';
import { PrintOptionsSheet } from '../../components/ui/PrintOptionsSheet';
import { TakeawayManageSheet } from '../../components/ui/TakeawayManageSheet';
import { QrChoiceSheet } from '../../components/ui/QrChoiceSheet';
import { TableSkeleton } from '../../components/ui/TableSkeleton';
import { MenuSkeleton } from '../../components/ui/MenuSkeleton';
import { CombosSkeleton } from '../../components/ui/CombosSkeleton';
import { FeaturedSkeleton } from '../../components/ui/FeaturedSkeleton';
import { SideDrawer } from '../../components/ui/SideDrawer';

// Format an Indian phone like "9051138485" → "+91 90511 38485" for display
function formatPhone(raw?: string | null): string {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  const last10 = digits.slice(-10);
  if (last10.length !== 10) return raw;
  return `+91 ${last10.slice(0, 5)} ${last10.slice(5)}`;
}

// Compact session countdown for the table card — time only, no "left" label.
// Returns null when there's no expiry to show. `danger` flags the last 10
// minutes (and an already-expired session) so the card can tint it red.
function formatTimeLeft(expiresAt: string | null | undefined, now: number): { text: string; danger: boolean } | null {
  if (!expiresAt) return null;
  const msLeft = new Date(expiresAt).getTime() - now;
  if (Number.isNaN(msLeft)) return null;
  if (msLeft <= 0) return { text: 'Expired', danger: true };
  const h = Math.floor(msLeft / 3_600_000);
  const m = Math.floor((msLeft % 3_600_000) / 60_000);
  const text = h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m` : '<1m';
  return { text, danger: msLeft < 10 * 60_000 };
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

type NavItem = 'tables' | 'menu' | 'orders' | 'takeaway';
type TableStatus = 'available' | 'occupied' | 'offline';

type Table = {
  id: string;
  number: number;
  status: TableStatus;
  seats: number;
  billAmount?: number;
  since?: string;
  occupiedSince?: string;
  expiresAt?: string | null;
  location?: string;
  sessionId?: string;
  customerName?: string | null;
  customerPhone?: string | null;
  itemsServed?: number;
  itemsTotal?: number;
  paymentSettled?: boolean;
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

type MenuRowOption = { id: string; name: string; priceAdjustment: number; available: boolean };
type MenuRowGroup = { id: string; name: string; options: MenuRowOption[] };
type MenuRow = {
  id: string;
  name: string;
  price: number;
  category: string;
  available: boolean;
  image?: string;
  modifierGroups?: MenuRowGroup[];
};

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
  // New-session bottom sheet (replaces the old confirm dialog). `starting` drives
  // the inline spinner so the tap → navigate gap shows feedback instead of freezing.
  const [newSessionTable, setNewSessionTable] = useState<Table | null>(null);

  // ── Manual takeaway entry (counter / phone orders) ─────────────────────────
  // Guest name/phone are collected later on order-menu's guest CRM row (before
  // placing), not here — asking twice was redundant.
  const [startingTakeaway, setStartingTakeaway] = useState(false);
  const [startingSession, setStartingSession] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  // Manage-table action sheet (occupied long-press) + reused swap sheet.
  const [manageTable, setManageTable] = useState<Table | null>(null);
  const [swapTable, setSwapTable] = useState<{ id: string; number: number } | null>(null);
  const [swapSubmitting, setSwapSubmitting] = useState(false);
  const [mergeTable, setMergeTable] = useState<{ id: string; number: number } | null>(null);
  const [mergeSubmitting, setMergeSubmitting] = useState(false);
  const [tables, setTables] = useState<Table[]>([]);
  const [isLoadingTables, setIsLoadingTables] = useState(true);
  // Single shared clock for every card's session countdown. Minute precision is
  // all the grid needs, so one 30s tick is far cheaper than a per-card 1s timer.
  const [now, setNow] = useState(() => Date.now());
  const [isLoadingMenu, setIsLoadingMenu] = useState(true);
  const [menuData, setMenuData] = useState<MenuRow[]>(MENU_DATA_INITIAL);
  const [expandedMenuItem, setExpandedMenuItem] = useState<string | null>(null);
  const [menuCategories, setMenuCategories] = useState<string[]>(['All', 'Appetizers', 'Mains', 'Beverages', 'Desserts']);
  const [combos, setCombos] = useState<any[]>([]);
  const [highlightedSection, setHighlightedSection] = useState<{ title: string; subtitle?: string; itemIds: string[] } | null>(null);


  const [activeFilter, setActiveFilter] = useState<'all' | TableStatus | string>('all');
  const [menuFilter, setMenuFilter] = useState('All');
  const [searchText, setSearchText] = useState('');
  const [refreshingMenu, setRefreshingMenu] = useState(false);

  const handleRefreshMenu = async () => {
    setRefreshingMenu(true);
    try { await loadMenuFromApi(); } finally { setRefreshingMenu(false); }
  };
  const [realtimeOk, setRealtimeOk] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Pending cash-collection requests across the whole restaurant. Drives the
  // red-dot badge on the cash icon in the header. Updated from:
  //  - initial fetch on mount
  //  - cash_collection_requested Ably event (+1)
  //  - cash_payment_collected   Ably event (−1, floored at 0)
  const [pendingCashCount, setPendingCashCount] = useState(0);
  const [pickupOrders, setPickupOrders] = useState<PickupOrder[]>([]);
  const [completedPickupOrders, setCompletedPickupOrders] = useState<PickupOrder[]>([]);
  const [completedPage, setCompletedPage] = useState(1);
  const [completedHasMore, setCompletedHasMore] = useState(false);
  const [isLoadingMoreCompleted, setIsLoadingMoreCompleted] = useState(false);
  const [liveOrders, setLiveOrders] = useState<ActiveOrder[]>([]);
  const [ordersSubTab, setOrdersSubTab] = useState<'active' | 'completed'>('active');
  const [completingIds, setCompletingIds] = useState<string[]>([]);
  // ── Takeaway state ──
  const [takeawayOrders, setTakeawayOrders] = useState<TakeawayOrder[]>([]);
  const [takeawaySubTab, setTakeawaySubTab] = useState<'preparing' | 'handed'>('preparing');
  const [handingOverIds, setHandingOverIds] = useState<string[]>([]);
  // Order whose long-press "manage" sheet (item / whole-order delete) is open.
  const [manageOrder, setManageOrder] = useState<TakeawayOrder | null>(null);
  const [refreshingTakeaway, setRefreshingTakeaway] = useState(false);
  const [takeawaySearchText, setTakeawaySearchText] = useState('');
  const [takeawayQrOpen, setTakeawayQrOpen] = useState(false);
  const takeawayOrderUrl = staffInfo?.restaurantId
    ? `https://quinckle.com/takeaway/${staffInfo.restaurantId}`
    : '';

  // Matches on pickup token, session ref, or customer phone — whichever the
  // staff typed. Case-insensitive substring match, no backend round-trip.
  const matchesTakeawaySearch = (order: TakeawayOrder) => {
    const q = takeawaySearchText.trim().toLowerCase();
    if (!q) return true;
    const token = (order.pickupToken ?? '').toLowerCase();
    const ref = (order.sessionRef ?? '').toLowerCase();
    const phone = (order.customerPhone ?? '').toLowerCase();
    return token.includes(q) || ref.includes(q) || phone.includes(q);
  };

  const loadTakeawayOrders = async () => {
    try {
      const res = await crewOrders.getTakeaway();
      setTakeawayOrders(res?.data ?? []);
    } catch { /* non-fatal */ }
    finally {
      setRefreshingTakeaway(false);
    }
  };

  const handleRefreshTakeaway = () => {
    setRefreshingTakeaway(true);
    void loadTakeawayOrders();
  };

  const isTakeawayPaid = (order: TakeawayOrder) =>
    ['PAID_CASH', 'PAID_UPI_DIRECT', 'PAID_ONLINE', 'PAID_MIXED', 'WAIVED'].includes(String(order.paymentStatus ?? '').toUpperCase());

  const isTakeawayPendingCollection = (order: TakeawayOrder) =>
    ['PENDING_STAFF_COLLECTION', 'PENDING_CASH', 'PENDING_UPI_DIRECT', 'UNPAID'].includes(String(order.paymentStatus ?? '').toUpperCase());

  // Deletable only before money is settled — mirrors the backend guard so we
  // never show a delete that would just 409 (paid, or a diner UPI-direct
  // collection mid-flight).
  const canDeleteTakeaway = (order: TakeawayOrder) =>
    order.status !== 'SERVED' &&
    !isTakeawayPaid(order) &&
    String(order.paymentStatus ?? '').toUpperCase() !== 'PENDING_UPI_DIRECT';

  // ── Takeaway manual print (KOT / invoice) ──
  // Mirrors [tableId].tsx's print flow: same PrintOptionsSheet + printKot/printBill,
  // scoped to whichever takeaway order the print icon was tapped on.
  const [restaurantInvoiceMeta, setRestaurantInvoiceMeta] = useState<{
    address?: string | null;
    phone?: string | null;
    email?: string | null;
    fssaiLicenseNumber?: string | null;
    gstRegistered?: boolean;
    gstin?: string | null;
  } | null>(null);
  const [upiId, setUpiId] = useState<string | null>(null);
  const [upiName, setUpiName] = useState('');
  const [printTakeawayOrder, setPrintTakeawayOrder] = useState<TakeawayOrder | null>(null);
  const [qrSheet, setQrSheet] = useState<{ grandTotal: number } | null>(null);
  const qrRunRef = useRef<((omitAmount: boolean) => void) | null>(null);

  useEffect(() => {
    const restaurantId = staffInfo?.restaurantId;
    if (!restaurantId) return;
    let cancelled = false;
    restaurantApi.getBranding(restaurantId)
      .then((res) => {
        if (cancelled || !res?.success) return;
        setRestaurantInvoiceMeta({
          address: res.data.address ?? null,
          phone: res.data.phone ?? null,
          email: res.data.email ?? null,
          fssaiLicenseNumber: res.data.fssaiLicenseNumber ?? null,
          gstRegistered: res.data.taxConfig?.gstRegistered ?? false,
          gstin: res.data.taxConfig?.gstin ?? null,
        });
        if (res.data.upiId) {
          setUpiId(res.data.upiId);
          setUpiName(res.data.upiDisplayName ?? res.data.name ?? '');
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [staffInfo?.restaurantId]);

  const handlePrintTakeawayKot = async (order: TakeawayOrder) => {
    setPrintTakeawayOrder(null);
    if (getPrinterStatus() !== 'connected') {
      showDialog(
        'No Printer Paired',
        'No Bluetooth printer is connected to this device. Go to Profile → Printer Settings to pair one.',
        [{ label: 'OK', onPress: () => {} }],
      );
      return;
    }
    const result = await printKot({
      id: order.orderId,
      tableNumber: 0,
      channel: 'TAKEAWAY',
      pickupToken: order.pickupToken ?? undefined,
      sessionRef: order.sessionRef ?? undefined,
      restaurantName: staffInfo?.restaurantName ?? '',
      createdAt: order.createdAt,
      items: order.items.map((item) => ({
        name: item.name,
        quantity: item.qty,
        modifiersSummary: item.modifiers ?? undefined,
      })),
      isAddOn: false,
    }, false, { force: true });
    if (result === 'printed') {
      showDialog('Printed', 'KOT sent to printer.', [{ label: 'OK', onPress: () => {} }]);
    } else {
      showDialog('Print Failed', 'Printer connected but print failed. Check paper / Bluetooth and try again.', [{ label: 'OK', onPress: () => {} }]);
    }
  };

  const handlePrintTakeawayInvoice = async (order: TakeawayOrder) => {
    setPrintTakeawayOrder(null);
    if (getPrinterStatus() !== 'connected') {
      showDialog(
        'No Printer Paired',
        'No Bluetooth printer is connected to this device. Go to Profile → Printer Settings to pair one.',
        [{ label: 'OK', onPress: () => {} }],
      );
      return;
    }

    const isPaid = isTakeawayPaid(order);
    const invoiceItems: InvoiceBill['items'] = order.items.map((item) => ({
      name: item.name,
      qty: item.qty,
      unitPrice: item.unitPrice,
      modifiersSummary: item.modifiers,
    }));

    const runPrint = async (upiOmitAmount: boolean) => {
      const result = await printBill({
        restaurantName: staffInfo?.restaurantName ?? '',
        restaurantAddress: restaurantInvoiceMeta?.address ?? null,
        restaurantPhone: restaurantInvoiceMeta?.phone ?? null,
        restaurantEmail: restaurantInvoiceMeta?.email ?? null,
        fssaiLicenseNumber: restaurantInvoiceMeta?.fssaiLicenseNumber ?? null,
        gstRegistered: restaurantInvoiceMeta?.gstRegistered ?? false,
        gstin: restaurantInvoiceMeta?.gstin ?? null,
        tableNumber: 0,
        channel: 'TAKEAWAY',
        pickupToken: order.pickupToken ?? null,
        sessionRef: order.sessionRef ?? undefined,
        items: invoiceItems,
        subtotal: order.subtotal,
        discount: order.discount,
        charges: order.serviceCharge,
        tax: order.tax,
        grandTotal: order.total,
        isPaid,
        paymentMethod: order.paymentMethod ?? undefined,
        upiVpa: upiId,
        upiName: upiName || null,
        upiOmitAmount,
        orderDateTime: order.createdAt,
        generatedAt: new Date().toISOString(),
      });
      if (result === 'failed') {
        showDialog(
          'Print Failed',
          'Could not print the invoice. Check that the printer is nearby and powered on.',
          [{ label: 'OK', onPress: () => {} }],
        );
      }
    };

    const qrWillPrint = !isPaid && !!upiId && isUpiQrEnabled();
    if (!qrWillPrint) {
      await runPrint(false);
      return;
    }
    qrRunRef.current = (omitAmount: boolean) => { void runPrint(omitAmount); };
    setQrSheet({ grandTotal: order.total });
  };

  const handleCollectTakeaway = (order: TakeawayOrder) => {
    router.push({
      pathname: '/(staff)/payment-collect',
      params: {
        orderId: order.orderId,
        sessionId: '',
        orderIds: '',
        tableNumber: '',
        channel: 'TAKEAWAY',
        pickupToken: order.pickupToken ?? '',
        amount: String(order.total ?? 0),
        customerName: order.customerName ?? '',
        customerPhone: order.customerPhone ?? '',
      },
    });
  };

  const handleHandover = async (orderId: string) => {
    setHandingOverIds((prev) => [...prev, orderId]);
    try {
      await crewOrders.handoverTakeaway(orderId);
      setTakeawayOrders((prev) =>
        prev.map((o) => (o.orderId === orderId ? { ...o, status: 'SERVED' } : o)),
      );
    } catch (err: any) {
      const code = String(err?.code ?? err?.message ?? '');
      showDialog(
        'Payment still pending',
        code.includes('PAYMENT_NOT_COLLECTED')
          ? 'Collect the takeaway payment before handing over the order.'
          : 'Could not hand over this takeaway order. Please refresh and try again.',
        [{ label: 'OK', onPress: () => {} }],
      );
      void loadTakeawayOrders();
    }
    setHandingOverIds((prev) => prev.filter((id) => id !== orderId));
  };

  // Map the backend's cancel error codes to a plain crew-facing message. Shared
  // by item-line and whole-order delete (mirrors the table screen's mapping).
  const takeawayCancelMessage = (err: any): string => {
    const code = String(err?.code ?? '');
    if (code === 'COLLECTION_IN_PROGRESS')
      return 'The customer is paying for this online right now. Wait for it to finish, then delete.';
    if (code === 'ORDER_ALREADY_PAID')
      return 'This order is already paid and can no longer be changed.';
    if (code === 'ITEM_ALREADY_CANCELLED' || code === 'ORDER_CANCELLED')
      return 'This has already been removed.';
    return (typeof err?.message === 'string' && err.message) || 'Something went wrong. Please try again.';
  };

  // Long-press a takeaway card to open the manage sheet (item / whole-order
  // delete). Only offered on orders that are still deletable.
  const openTakeawayManage = (order: TakeawayOrder) => {
    if (!canDeleteTakeaway(order)) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setManageOrder(order);
  };

  // Thin persistence callbacks handed to the sheet. They talk to the API and
  // reconcile local state; the sheet owns the delete animation + error display,
  // so these just resolve on success and re-throw on failure.
  const deleteTakeawayItem = async (orderId: string, itemId: string) => {
    await crewOrders.cancelItem(orderId, itemId);
    void loadTakeawayOrders();
  };

  // Whole-order delete mirrors the table sheet's "Free table": close the sheet,
  // then confirm via the standard ThemedDialog before hitting the API.
  const requestDeleteWholeTakeaway = () => {
    const o = manageOrder;
    setManageOrder(null);
    if (!o) return;
    setTimeout(() => {
      showDialog(
        'Delete order?',
        `Delete this entire takeaway order${o.pickupToken ? ` (${o.pickupToken})` : ''}? This cannot be undone.`,
        [
          { label: 'Cancel', onPress: () => {} },
          {
            label: 'Delete',
            variant: 'danger',
            onPress: () => {
              void (async () => {
                try {
                  await crewOrders.cancelOrder(o.orderId);
                  setTakeawayOrders((prev) => prev.filter((x) => x.orderId !== o.orderId));
                } catch (err: any) {
                  showDialog('Could not delete', takeawayCancelMessage(err), [{ label: 'OK', onPress: () => {} }]);
                  void loadTakeawayOrders();
                }
              })();
            },
          },
        ],
      );
    }, 220);
  };

  // KOT auto-print toggle — loaded from server, synced via Ably.
  // Stored in both state (for UI) and a ref (so Ably callbacks always see latest value).
  const [kotAutoPrint, setKotAutoPrint] = useState(true);
  const kotAutoPrintRef = useRef(true);
  const setKotAutoPrintSync = (v: boolean) => {
    kotAutoPrintRef.current = v;
    setKotAutoPrint(v);
    setSinkContext({ autoPrint: v }); // keep the background FGS gate in sync
  };

  // Sync the KOT auto-print toggle from the server. Auto-print itself gates on
  // the *live* local printer connection (getPrinterStatus), never on staff
  // identity — the Bluetooth pairing is the real single-sink guarantee, so any
  // crew member on the paired device drives printing. Default toggle stays true
  // so a transient status-fetch failure never silently disables printing.
  const refreshPrintSinkOwnership = async () => {
    try {
      const res = await printerApi.getStatus();
      if (typeof res?.data?.kotAutoPrint === 'boolean') {
        setKotAutoPrintSync(res.data.kotAutoPrint);
      }
    } catch { /* keep last known toggle value */ }
  };

  // ── KOT print backstop (server pull-queue) ──────────────────────────────────
  // The live Ably `new_order` push is the fast path, but it only fires while the
  // app is foregrounded and the socket is healthy. The SHARED drain in
  // printSink.ts (also used by the cook screen + FGS) is the guarantee: it
  // flushes the ack outbox, pulls the server queue (first prints + durable
  // reprints) with this device's sink identity, and prints anything that
  // slipped through. The auto-print toggle reaches it via setSinkContext.

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
        android: { largeIcon: 'ic_notification_large' },
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

  const activePickupOrders = useMemo(() => pickupOrders, [pickupOrders]);
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
            // Never assume a tax rate as fallback — the partner may have GST
            // off entirely. If tax_total is null, treat it as zero.
            billAmount = typeof bill.total_payable === 'number'
              ? bill.total_payable
              : bill.session_total + (bill.tax_total ?? 0);
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
          occupiedSince: t.occupied_since ?? undefined,
          expiresAt: t.expires_at ?? null,
          location: undefined,
          sessionId: t.session_id ?? undefined,
          customerName: t.customer_name ?? null,
          customerPhone: t.customer_phone ?? null,
          itemsServed: typeof t.items_served === 'number' ? t.items_served : undefined,
          itemsTotal: typeof t.items_total === 'number' ? t.items_total : undefined,
          paymentSettled: t.payment_settled === true,
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
        // Crew endpoint (NOT the diner menu): returns unavailable items + options
        // too, so 86'd items stay in the list and can be re-enabled.
        crewMenu.getMenu(),
        restaurantApi.getCombos(rid),
        restaurantApi.getHighlighted(rid),
      ]);

      if (menuRes.status === 'fulfilled') {
        const categories: any[] = (menuRes.value as any)?.data ?? [];
        const items = categories.flatMap((cat: any) => cat.items ?? []);
        if (items.length > 0) {
          setMenuData(items.map((item: any): MenuRow => ({
            id: item.id, name: item.name,
            price: parseFloat(item.price), category: item.category,
            available: item.isAvailable, image: item.imageUrl ?? undefined,
            modifierGroups: (item.modifierGroups ?? [])
              .map((g: any) => ({
                id: g.id,
                name: g.name,
                options: (g.options ?? []).map((o: any) => ({
                  id: o.id,
                  name: o.name,
                  priceAdjustment: parseFloat(String(o.priceAdjustment ?? '0')) || 0,
                  available: o.isAvailable !== false,
                })),
              }))
              .filter((g: MenuRowGroup) => g.options.length > 0),
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
      // Takeaway has its own dedicated tab — keep this list dine-in only.
      const serveableOrders = allOrders.filter(o =>
        o.channel !== 'TAKEAWAY' && o.items.some(i => !i.served)
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
            body: newOrders.map(o => o.channel === 'TAKEAWAY' ? (o.pickup_token ?? 'TK') : `T${o.table_number}`).join(', ') + ' — ready to serve',
            sound: true,
            android: { largeIcon: 'ic_notification_large' },
          },
          trigger: null,
        }).catch(() => { });
      }

      const refreshedActive = serveableOrders.map(order => ({
        id: order.order_id,
        tableNo: order.channel === 'TAKEAWAY' ? (order.pickup_token ?? 'TK') : `T${order.table_number}`,
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

      setPickupOrders(refreshedActive);
    } catch (e) { console.error('[pickup] loadPickupOrders error:', e); }
  };

  const mapCompletedOrder = (order: any): PickupOrder => ({
    id: order.order_id,
    tableNo: order.channel === 'TAKEAWAY' ? (order.pickup_token ?? 'TK') : `T${order.table_number}`,
    completedAt: order.served_at ?? order.placed_at,
    items: order.items.map((item: any) => ({
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
  });

  // Completed tab source of truth: backend paginated list (last 24h served).
  const loadServedToday = async (page = 1) => {
    try {
      const res = await crewOrders.getServedToday(page, 30);
      // Takeaway has its own dedicated tab — keep this list dine-in only.
      const served = (res.orders ?? []).filter((o: any) => o.channel !== 'TAKEAWAY');
      const mapped = served.map(mapCompletedOrder);
      if (page === 1) {
        setCompletedPickupOrders(mapped);
      } else {
        setCompletedPickupOrders((prev) => {
          const existing = new Set(prev.map((o) => o.id));
          const merged = [...prev];
          for (const row of mapped) if (!existing.has(row.id)) merged.push(row);
          return merged;
        });
      }
      setCompletedPage(page);
      setCompletedHasMore(Boolean(res.hasMore));
    } catch (e) { console.error('[pickup] loadServedToday error:', e); }
  };

  const loadMoreCompletedOrders = async () => {
    if (isLoadingMoreCompleted || !completedHasMore) return;
    setIsLoadingMoreCompleted(true);
    try {
      await loadServedToday(completedPage + 1);
    } finally {
      setIsLoadingMoreCompleted(false);
    }
  };

  // Load once on mount — Ably drives all subsequent updates
  useEffect(() => {
    loadTables();
    loadMenuFromApi();
    loadPickupOrders();
    loadServedToday();
    loadPendingCashCount();
    void refreshPrintSinkOwnership();
  }, [staffInfo?.restaurantId]);

  // Advance the shared clock every 30s so card countdowns stay current — but
  // only while the Tables tab is open and at least one table has an expiry, so
  // an idle floor never wakes the JS runtime.
  const hasExpiringTable = useMemo(
    () => tables.some((t) => t.status === 'occupied' && !!t.expiresAt),
    [tables],
  );
  useEffect(() => {
    if (activeTab !== 'tables' || !hasExpiringTable) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [activeTab, hasExpiringTable]);

  // KOT reconciliation — event-driven, no polling. Drain the server's unprinted
  // queue on mount, on every return to foreground, and whenever the waiter
  // realtime socket (re)connects — that reconnect is precisely when a live push
  // could have been missed (background, socket blip). Combined with the Ably
  // push + de-dup guard this guarantees a KOT prints without pinning the DB
  // awake on a 15s timer. Mirrors the cook screen.
  useEffect(() => {
    const restaurantId = staffInfo?.restaurantId;
    if (!restaurantId) return;
    void drainPendingPrintJobs();
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refreshPrintSinkOwnership();
        void drainPendingPrintJobs();
      }
    });
    const unwatchConn = watchConnection(`waiter:${restaurantId}`, (connected) => {
      if (connected) void drainPendingPrintJobs();
    });
    return () => {
      appStateSub.remove();
      unwatchConn();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staffInfo?.restaurantId]);

  // Keep the screen awake while this device holds the printer, so Android can't
  // suspend the JS runtime and miss prints when the screen would sleep.
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

  const loadPendingCashCount = async () => {
    try {
      const data = await crewPayments.getCashRequests();
      setPendingCashCount(data.pending.length);
    } catch { /* non-fatal — Ably will keep the count fresh */ }
  };

  // Immediately refresh pickup orders when switching to Orders tab
  useEffect(() => {
    if (activeTab === 'orders') void loadPickupOrders();
    if (activeTab === 'takeaway') void loadTakeawayOrders();
  }, [activeTab]);

  // Takeaway list stays fresh via the waiter:{restaurantId} Ably push below
  // (new_order / cash events call loadTakeawayOrders) plus the tab-switch load
  // above — no polling needed.

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

    const off2 = subscribeChannel(`waiter:${restaurantId}`, 'order_served', (data: any) => {
      void loadPickupOrders();
      void loadServedToday(1);
      // Update the table card's serve-progress bar straight from the event —
      // no /api/crew/tables refetch (serving changes nothing else on the grid:
      // the table stays occupied and the bill is unchanged). Fall back to a
      // refetch only if an older backend sends no counts.
      if (data?.tableNumber != null && typeof data?.itemsTotal === 'number') {
        setTables(prev => prev.map(t =>
          t.number === data.tableNumber
            ? { ...t, itemsServed: data.itemsServed ?? t.itemsServed, itemsTotal: data.itemsTotal }
            : t));
      } else {
        void loadTables();
      }
    });

    const off3 = subscribeChannel(`waiter:${restaurantId}`, 'new_order', (data: any) => {
      void loadPickupOrders();
      if (data?.channel === 'TAKEAWAY') void loadTakeawayOrders();
      void loadTables();
      // Auto-print fast path — gate on the live local printer connection + the
      // auto-print toggle. (Live getPrinterStatus() avoids any startup race with
      // the async refreshPrintSinkOwnership ref.) The event-driven reconnect/
      // foreground drain is the backstop; printKot de-dupes so push + drain
      // never double-print.
      if (
        kotAutoPrintRef.current &&
        getPrinterStatus() === 'connected' &&
        data?.orderId
      ) {
        const kotItems = (data.items ?? []).map((i: any) => ({
          name: i.menuItemName ?? i.name ?? '',
          quantity: Number(i.quantity ?? 1),
          notes: i.notes ?? null,
          modifiersSummary: i.modifiersSummary ?? null,
          category: i.category,
        }));
        void printKot({
          id: data.orderId,
          sessionId: data.sessionId ?? undefined,
          orderNumber: data.orderNumber,
          tableNumber: data.tableNumber,
          channel: data.channel,
          pickupToken: data.pickupToken ?? undefined,
          sessionRef: data.sessionRef ?? undefined,
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
    // Two tables merged into one bill from another device — the absorbed table
    // is now free and the survivor's bill grew, so re-render the grid.
    const off6d = subscribeChannel(`waiter:${restaurantId}`, 'session_merged', () => {
      void loadTables();
    });

    const off7 = subscribeChannel(`waiter:${restaurantId}`, 'item_bumped', () => {
      void loadPickupOrders();
      void loadTakeawayOrders(); // takeaway tab: keep status live now that the 10s poll is gone
    });

    // Per-item ready: drives a refetch the moment the cook flips a single item.
    // The sound + notification are emitted by loadPickupOrders' own diff so
    // the same UX fires whether the realtime event or a manual refresh
    // surfaces a newly-ready item.
    const off7b = subscribeChannel(`waiter:${restaurantId}`, 'item_ready', () => {
      void loadPickupOrders();
      void loadTakeawayOrders(); // takeaway tab: keep status live now that the 10s poll is gone
    });

    const off8 = subscribeChannel(`waiter:${restaurantId}`, 'cash_collection_requested', (data: any) => {
      const tableNumber = data?.tableNumber as number | undefined;
      const amount = data?.amount as number | undefined;
      setPendingCashCount(c => c + 1);
      if (data?.channel === 'TAKEAWAY') void loadTakeawayOrders();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      void playSound(require('../../assets/audio/notifications/waiter notification.mp3'));
      Notifications.scheduleNotificationAsync({
        content: {
          title: data?.channel === 'TAKEAWAY'
            ? `💵 Collect payment — ${data?.pickupToken ?? 'Takeaway'}`
            : `💵 Collect cash${tableNumber ? ` — Table ${tableNumber}` : ''}`,
          body: amount
            ? `₹${amount} due ${data?.channel === 'TAKEAWAY' ? 'at the counter' : 'at the table'}`
            : 'Customer is paying by cash',
          sound: true,
          android: { largeIcon: 'ic_notification_large' },
        },
        trigger: null,
      }).catch(() => { });
      void loadTables();
    });

    // When any waiter (this one or another) marks an order collected,
    // decrement the badge so it stays accurate across multiple devices, and
    // refresh the grid so the table card's "paid" icon lights up live.
    const off9 = subscribeChannel(`waiter:${restaurantId}`, 'cash_payment_collected', () => {
      setPendingCashCount(c => Math.max(0, c - 1));
      void loadTakeawayOrders();
      void loadTables();
    });

    // Reprint request — manual, user-initiated. Prints on the connected device
    // regardless of the auto-print toggle. Shares a de-dupe key (keyed by
    // requestedAt) with the durable pull-queue fallback so the same request
    // never prints twice when both paths deliver it; a fresh request (new
    // requestedAt) still prints. Old backends without requestedAt keep the
    // legacy force behaviour.
    const offReprint = subscribeChannel(`partner:${restaurantId}`, 'reprint_request', (data: any) => {
      if (getPrinterStatus() === 'connected' && data?.order) {
        const items = (data.order.items ?? []).map((i: any) => ({
          name: i.name ?? i.menuItemName ?? '',
          quantity: i.quantity,
          notes: i.notes,
          modifiersSummary: i.modifiersSummary ?? undefined,
        }));
        void printKot({
          id: data.order.id,
          sessionId: data.order.sessionId ?? undefined,
          orderNumber: data.order.orderNumber != null ? String(data.order.orderNumber) : undefined,
          tableNumber: String(data.order.tableNumber ?? '?'),
          channel: data.order.channel,
          pickupToken: data.order.pickupToken ?? undefined,
          sessionRef: data.order.sessionRef ?? undefined,
          restaurantName: staffInfo?.restaurantName ?? '',
          createdAt: data.order.createdAt ?? new Date().toISOString(),
          items,
          isAddOn: false,
        }, false, data.requestedAt != null
          ? { dedupeKey: `reprint:${data.order.id}:${data.requestedAt}` }
          : { force: true });
      }
    });

    // Sink handover — another device paired (or the pairing was cleared).
    // Clear the stale local pairing so this device can never dual-print
    // against the new sink (critical for LAN/tcp printers).
    const offPrinterPaired = subscribeChannel(`partner:${restaurantId}`, 'printer_paired', (data: any) => {
      void (async () => {
        if (getPrinterStatus() !== 'connected') return; // we don't hold a pairing
        const myDeviceId = await getPrintDeviceId();
        if (data?.deviceId !== myDeviceId) await handleSinkSuperseded();
      })();
    });
    const offPrinterUnpaired = subscribeChannel(`partner:${restaurantId}`, 'printer_unpaired', () => {
      if (getPrinterStatus() === 'connected') void handleSinkSuperseded();
    });

    return () => { off1(); off2(); off3(); off4(); off5(); off6(); off6a(); off6b(); off6c(); off6d(); off7(); off7b(); off8(); off9(); offReprint(); offAutoPrint(); offPrinterPaired(); offPrinterUnpaired(); };
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

    // Persist to the backend. 'occupied' is never set from here (it comes from a
    // diner session), so we only push the states the crew endpoint accepts —
    // both 'available' AND 'offline' (marking a table unavailable/back online).
    if (nextStatus === 'available' || nextStatus === 'offline') {
      const table = tables.find(t => t.number === tableNum);
      if (table) {
        try {
          await crewTables.updateStatus(table.id, nextStatus);
          await loadTables();
        } catch {
          // Keep optimistic update on error; a later refresh resyncs from server.
        }
      }
    }
  };

  // Free any occupied/reserved table directly from the floor — no conditions.
  // Routes through the session-end path (fans out via Ably + clears caches) when
  // a session exists; falls back to a plain status flip for phantom-occupied.
  const freeTable = async (table: { id: string; number: number; sessionId?: string }) => {
    // Optimistic local update so the grid responds instantly.
    setTables(prev => prev.map(t => (t.id === table.id ? { ...t, status: 'available' as TableStatus, sessionId: undefined } : t)));
    try {
      if (table.sessionId) {
        await crewSessions.end(table.sessionId);
      } else {
        await crewTables.updateStatus(table.id, 'available');
      }
    } catch {
      // ignore — resync from server below regardless
    } finally {
      await loadTables();
    }
  };

  // Toggle a menu item's availability. Persists server-side (same endpoint
  // effect as the partner dashboard) so the item leaves the diner menu.
  const toggleMenuItemAvailability = async (itemId: string, next: boolean) => {
    setMenuData(prev => prev.map(m => m.id === itemId ? { ...m, available: next } : m)); // optimistic
    try {
      await crewMenu.setAvailability(itemId, next);
    } catch {
      // Revert on failure so the UI never lies about the real state.
      setMenuData(prev => prev.map(m => m.id === itemId ? { ...m, available: !next } : m));
    }
  };

  // Toggle a single modifier option / variant (86 one flavor) without taking
  // the whole item offline.
  const setOptionState = (itemId: string, optionId: string, available: boolean) =>
    setMenuData(prev => prev.map(m => m.id === itemId
      ? {
          ...m,
          modifierGroups: m.modifierGroups?.map(g => ({
            ...g,
            options: g.options.map(o => o.id === optionId ? { ...o, available } : o),
          })),
        }
      : m));

  const toggleOptionAvailability = async (itemId: string, optionId: string, next: boolean) => {
    setOptionState(itemId, optionId, next); // optimistic
    try {
      await crewMenu.setOptionAvailability(optionId, next);
    } catch {
      setOptionState(itemId, optionId, !next); // revert
    }
  };

  // Start a session from the new-session sheet. Shows an inline spinner during
  // the create, then navigates — replacing the old blank tap→navigate gap. On
  // failure the sheet stays open with an error so staff can retry.
  const startSessionForTable = async () => {
    const table = newSessionTable;
    if (!table) return;
    setStartingSession(true);
    setStartError(null);
    try {
      const res = await crewSessions.start(table.id);
      void loadTables();
      setNewSessionTable(null);
      router.push({ pathname: '/(staff)/[tableId]', params: { tableId: String(table.number), sessionId: res.session_id, tableDbId: table.id } });
    } catch (e: any) {
      setStartError(e?.message ?? 'Could not start session. Try again.');
    } finally {
      setStartingSession(false);
    }
  };

  // Create a crew takeaway session (tableless) straight from the '+' button —
  // no name/phone prompt here; the order-menu guest CRM row collects that
  // right before placing, so asking twice was redundant.
  const startTakeawayOrder = async () => {
    if (startingTakeaway) return;
    setStartingTakeaway(true);
    try {
      const res = await crewTakeaway.createSession();
      const d = res.data;
      router.push({
        pathname: '/(staff)/order-menu',
        params: {
          sessionId: d.session_id,
          channel: 'TAKEAWAY',
          pickupToken: d.pickup_token ?? '',
        },
      });
    } catch (e: any) {
      showDialog(
        'Could Not Start Order',
        e?.message ?? 'Could not start a new takeaway order. Please try again.',
        [{ label: 'OK', onPress: () => {} }],
      );
    } finally {
      setStartingTakeaway(false);
    }
  };

  // Manage-sheet → Swap: close the action sheet, then open the shared swap sheet.
  const onPressSwapFromManage = () => {
    const t = manageTable;
    setManageTable(null);
    if (t) setTimeout(() => setSwapTable({ id: t.id, number: t.number }), 220);
  };

  // Manage-sheet → Merge: close the action sheet, then open the merge sheet.
  const onPressMergeFromManage = () => {
    const t = manageTable;
    setManageTable(null);
    if (t) setTimeout(() => setMergeTable({ id: t.id, number: t.number }), 220);
  };

  // Manage-sheet → Free: close the action sheet, then show the existing confirm.
  const onPressFreeFromManage = () => {
    const t = manageTable;
    setManageTable(null);
    if (!t) return;
    setTimeout(() => {
      showDialog(
        'Free Table',
        `Free Table T${String(t.number).padStart(2, '0')}? It’s released for new guests. Any uncollected payment moves to Outstanding so you can still collect or waive it.`,
        [
          { label: 'Cancel', onPress: () => { } },
          { label: 'Free Table', variant: 'danger', onPress: () => { void freeTable(t); } },
        ],
      );
    }, 220);
  };

  // Swap from the grid — same API + UX as the detail screen, but refreshes the
  // grid in place instead of navigating.
  const confirmSwapFromGrid = async ({ targetId }: { targetId: string; targetNumber: number }) => {
    const from = swapTable;
    if (!from) return;
    setSwapSubmitting(true);
    try {
      const res = await crewTables.transferSession(from.id, targetId);
      setSwapTable(null);
      void loadTables();
      setTimeout(() => {
        showDialog(
          'Moved',
          `Guest moved to T${String(res.data.toTableNumber).padStart(2, '0')} — ${res.data.ordersMoved} order${res.data.ordersMoved === 1 ? '' : 's'} relocated.`,
          [{ label: 'OK', onPress: () => { } }],
        );
      }, 220);
    } catch (e: any) {
      showDialog('Could not move', e?.message ?? 'Please try again.', [{ label: 'OK', onPress: () => { } }]);
    } finally {
      setSwapSubmitting(false);
    }
  };

  // Merge from the grid — `mergeTable` is the table being absorbed, `targetId`
  // the surviving primary that keeps the unified bill.
  const confirmMergeFromGrid = async ({ targetId, targetNumber }: { targetId: string; targetNumber: number }) => {
    const secondary = mergeTable;
    if (!secondary) return;
    setMergeSubmitting(true);
    try {
      const res = await crewTables.mergeSession(targetId, secondary.id);
      setMergeTable(null);
      void loadTables();
      setTimeout(() => {
        showDialog(
          'Merged',
          `T${String(secondary.number).padStart(2, '0')} merged into T${String(targetNumber).padStart(2, '0')} — ${res.data.ordersMoved} order${res.data.ordersMoved === 1 ? '' : 's'} now bill together on T${String(targetNumber).padStart(2, '0')}.`,
          [{ label: 'OK', onPress: () => { } }],
        );
      }, 220);
    } catch (e: any) {
      showDialog('Could not merge', e?.message ?? 'Please try again.', [{ label: 'OK', onPress: () => { } }]);
    } finally {
      setMergeSubmitting(false);
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
      const table = tables.find(t => t.number === tableNum);
      if (!table) return;
      setStartError(null);
      setNewSessionTable(table);
    } else {
      const table = tables.find(t => t.number === tableNum);
      router.push({ pathname: '/(staff)/[tableId]', params: {
        tableId: String(tableNum),
        sessionId: table?.sessionId ?? '',
        tableDbId: table?.id ?? '',
        occupiedSince: table?.occupiedSince ?? '',
        expiresAt: table?.expiresAt ?? '',
        customerName: table?.customerName ?? '',
        customerPhone: table?.customerPhone ?? '',
      } });
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
    } else {
      // Occupied or reserved → open the manage action sheet (Swap / Free).
      setManageTable(table);
    }
  };

  const FILTER_CHIPS = [
    { key: 'all', label: 'All', count: counts.all },
    { key: 'available', label: 'Available', count: counts.available },
    { key: 'occupied', label: 'Occupied', count: counts.occupied },
  ] as const;

  return (
    <View style={[styles.container, { paddingTop: insets.top + Spacing.sm }]}>
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.burgerBtn}
          onPress={() => setDrawerOpen(true)}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="menu" size={26} color={QuinckleColors.textPrimary} />
        </TouchableOpacity>

        <View style={styles.headerActions}>
          {/* Cash-collection icon: tap to see pending requests + today's history.
                Red dot appears when there's at least one unresolved request. */}
          <TouchableOpacity
            style={styles.cashIconBtn}
            onPress={() => router.push('/(staff)/cash-collection')}
            activeOpacity={0.7}
          >
            <Ionicons name="cash-outline" size={26} color={QuinckleColors.textPrimary} />
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
              style={styles.refreshTableBtn}
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


          {isLoadingTables && tables.length === 0 ? (
            <TableSkeleton />
          ) : (
            <ScrollView
              style={{ flex: 1 }}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.listContent}
              refreshControl={
                <RefreshControl refreshing={isLoadingTables} onRefresh={() => { void loadTables(); }} tintColor={QuinckleColors.textTertiary} />
              }
            >
              {filteredTables.length === 0 ? (
                <View style={styles.emptyState}>
                  <Ionicons name="grid-outline" size={28} color={QuinckleColors.textTertiary} />
                  <Text style={styles.emptyText}>No tables match this filter.</Text>
                </View>
              ) : (
                <View style={styles.tableGrid}>
                  {filteredTables.map((item) => {
                    const meta = STATUS_META[item.status] || STATUS_META.available;
                    const gradColors: [string, string, string, string, string] = [
                      'transparent',
                      `${meta.color}55`,
                      meta.color,
                      `${meta.color}55`,
                      'transparent',
                    ];
                    // Status icons (served + paid) + session countdown for occupied cards.
                    const total = item.itemsTotal ?? 0;
                    const showStatusIcons = item.status === 'occupied';
                    const allServed = showStatusIcons && total > 0 && (item.itemsServed ?? 0) >= total;
                    const paid = showStatusIcons && item.paymentSettled === true;
                    const timeLeft = item.status === 'occupied' ? formatTimeLeft(item.expiresAt, now) : null;
                    return (
                      <TouchableOpacity
                        key={item.id}
                        style={[styles.tableCardOuter, item.status === 'offline' && styles.offlineCard]}
                        onPress={() => handleTablePress(item.number, item.status)}
                        onLongPress={() => handleLongPress(item.id, item.status)}
                        activeOpacity={0.82}
                        delayLongPress={500}
                      >
                        {/* Gradient border */}
                        <LinearGradient
                          colors={gradColors}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                          style={StyleSheet.absoluteFillObject}
                        />
                        {/* Dark inner card */}
                        <View style={styles.tableCard}>
                          <View style={styles.cardHeader}>
                            <Text style={styles.tableTitle}>T{String(item.number).padStart(2, '0')}</Text>
                            <View style={styles.headerRightCol}>
                              <View style={styles.seatsRow}>
                                <Ionicons name="people-outline" size={11} color={QuinckleColors.textTertiary} />
                                <Text style={styles.seatsText}>{item.seats} seats</Text>
                              </View>
                              {showStatusIcons && (
                                <View style={styles.cardStatusRow}>
                                  <Ionicons
                                    name={allServed ? 'restaurant' : 'restaurant-outline'}
                                    size={14}
                                    color={allServed ? QuinckleColors.success : QuinckleColors.textTertiary}
                                  />
                                  <Ionicons
                                    name={paid ? 'card' : 'card-outline'}
                                    size={14}
                                    color={paid ? QuinckleColors.success : QuinckleColors.textTertiary}
                                  />
                                </View>
                              )}
                            </View>
                          </View>
                          <View style={styles.cardBottom}>
                            {item.status === 'occupied' ? (
                              <View style={styles.occupiedBottomRow}>
                                <View style={styles.occupiedBottomLeft}>
                                  <Text style={styles.billAmount}>₹{(item.billAmount ?? 0).toLocaleString()}</Text>
                                  <Text style={styles.billSubtitle}>{item.since ? `since ${item.since}` : 'active session'}</Text>
                                </View>
                                {timeLeft && (
                                  <View style={styles.cardTimer}>
                                    <Ionicons
                                      name="time-outline"
                                      size={12}
                                      color={timeLeft.danger ? QuinckleColors.danger : QuinckleColors.textSecondary}
                                    />
                                    <Text
                                      style={[styles.cardTimerText, timeLeft.danger && { color: QuinckleColors.danger }]}
                                    >
                                      {timeLeft.text}
                                    </Text>
                                  </View>
                                )}
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
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </ScrollView>
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

              {/* Search + Refresh + Category chips */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <View style={[styles.searchBoxFull, { flex: 1, marginBottom: 0 }]}>
                  <Ionicons name="search" size={15} color={QuinckleColors.textTertiary} />
                  <TextInput
                    style={styles.searchInput}
                    placeholder="Search menu items…"
                    placeholderTextColor={QuinckleColors.textTertiary}
                    value={searchText}
                    onChangeText={setSearchText}
                  />
                </View>
                <TouchableOpacity
                  onPress={() => { if (!refreshingMenu) void handleRefreshMenu(); }}
                  style={styles.menuRefreshBtn}
                  activeOpacity={0.7}
                  accessibilityLabel="Refresh menu availability"
                >
                  {refreshingMenu
                    ? <ActivityIndicator size="small" color={QuinckleColors.primary} />
                    : <Ionicons name="refresh" size={18} color={QuinckleColors.primary} />}
                </TouchableOpacity>
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
                .map(item => {
                  const hasMods = !!item.modifierGroups?.length;
                  const expanded = expandedMenuItem === item.id;
                  const offCount = item.modifierGroups?.reduce(
                    (n, g) => n + g.options.filter(o => !o.available).length, 0) ?? 0;
                  return (
                  <View key={item.id} style={styles.menuItemCard}>
                    <View style={styles.menuItemRow}>
                      <TouchableOpacity
                        style={styles.menuItemLeft}
                        activeOpacity={hasMods ? 0.6 : 1}
                        onPress={() => { if (hasMods) setExpandedMenuItem(expanded ? null : item.id); }}
                      >
                        {item.image
                          ? <Image source={{ uri: item.image }} style={[styles.menuItemImage, !item.available && styles.dimmed]} />
                          : <View style={[styles.menuItemImagePlaceholder, !item.available && styles.dimmed]}><Ionicons name="fast-food-outline" size={20} color={QuinckleColors.textTertiary} /></View>}
                        <View style={styles.menuItemInfo}>
                          <Text style={[styles.menuItemName, !item.available && styles.dimmedText]}>{item.name}</Text>
                          <Text style={styles.menuItemPrice}>₹{item.price}</Text>
                        </View>
                        {hasMods && (
                          <View style={styles.modCaret}>
                            {offCount > 0 && !expanded && (
                              <View style={styles.modOffBadge}><Text style={styles.modOffBadgeText}>{offCount} off</Text></View>
                            )}
                            <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={QuinckleColors.textTertiary} />
                          </View>
                        )}
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => void toggleMenuItemAvailability(item.id, !item.available)}
                        style={[styles.toggleBase, item.available ? styles.toggleOn : styles.toggleOff]}
                      >
                        <View style={[styles.toggleCircle, item.available ? styles.toggleCircleOn : styles.toggleCircleOff]} />
                      </TouchableOpacity>
                    </View>

                    {expanded && hasMods && (
                      <View style={styles.modOptionsWrap}>
                        {item.modifierGroups!.map((group, gi) => (
                          <View key={group.id}>
                            {gi > 0 && <View style={styles.modGroupDivider} />}
                            <View style={styles.modGroup}>
                              <Text style={styles.modGroupName}>{group.name}</Text>
                              {group.options.map(opt => (
                                <View key={opt.id} style={styles.modOptionRow}>
                                  <Text style={[styles.modOptionName, !opt.available && styles.dimmedText]} numberOfLines={1}>
                                    {opt.name}{opt.priceAdjustment ? `  +₹${opt.priceAdjustment.toFixed(0)}` : ''}
                                  </Text>
                                  <TouchableOpacity
                                    onPress={() => void toggleOptionAvailability(item.id, opt.id, !opt.available)}
                                    style={[styles.toggleBaseSm, opt.available ? styles.toggleOn : styles.toggleOff]}
                                  >
                                    <View style={[styles.toggleCircleSm, opt.available ? styles.toggleCircleOn : styles.toggleCircleOff]} />
                                  </TouchableOpacity>
                                </View>
                              ))}
                            </View>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                  );
                })}
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
                onReopen={undefined}
              />
            )}
            ListEmptyComponent={
              ordersSubTab === 'active' ? (
                <View style={styles.emptyOrders}>
                  <View style={styles.emptyMedallionActive}>
                    <Ionicons name="checkmark-done" size={30} color={QuinckleColors.success} />
                  </View>
                  <Text style={styles.emptyTitle}>All caught up</Text>
                  <Text style={styles.emptySubtitle}>
                    No active orders right now.{'\n'}New tickets land here the moment they&apos;re placed.
                  </Text>
                </View>
              ) : (
                <View style={styles.emptyOrders}>
                  <View style={styles.emptyMedallion}>
                    <Ionicons name="time-outline" size={28} color={QuinckleColors.textTertiary} />
                  </View>
                  <Text style={styles.emptyTitle}>Nothing served yet</Text>
                  <Text style={styles.emptySubtitle}>
                    Served orders from the last 24 hours will appear here.
                  </Text>
                </View>
              )
            }
            ListFooterComponent={
              ordersSubTab === 'completed' && completedHasMore ? (
                <TouchableOpacity
                  style={styles.loadMoreCompletedBtn}
                  onPress={() => void loadMoreCompletedOrders()}
                  disabled={isLoadingMoreCompleted}
                  activeOpacity={0.8}
                >
                  <Text style={styles.loadMoreCompletedText}>
                    {isLoadingMoreCompleted ? 'Loading…' : 'Load more'}
                  </Text>
                </TouchableOpacity>
              ) : null
            }
          />
        </View>
      ) : activeTab === 'takeaway' ? (
        <View style={styles.tabContent}>
          <View style={styles.segmentWrap}>
            <PickupSegmented
              items={[
                { key: 'preparing', label: 'Preparing', count: takeawayOrders.filter((o) => o.status !== 'SERVED').length },
                { key: 'handed', label: 'Handed', count: takeawayOrders.filter((o) => o.status === 'SERVED').length },
              ]}
              active={takeawaySubTab}
              onChange={(key) => setTakeawaySubTab(key as 'preparing' | 'handed')}
            />
          </View>

          <View style={styles.controlsRow}>
            <View style={styles.searchBox}>
              <Ionicons name="search" size={15} color={QuinckleColors.textTertiary} />
              <TextInput
                value={takeawaySearchText}
                onChangeText={setTakeawaySearchText}
                placeholder="Token, session ref, or phone…"
                placeholderTextColor={QuinckleColors.textTertiary}
                style={styles.searchInput}
              />
            </View>
            <TouchableOpacity
              style={styles.takeawayRefreshBtn}
              onPress={handleRefreshTakeaway}
              disabled={refreshingTakeaway}
              activeOpacity={0.75}
            >
              {refreshingTakeaway
                ? <ActivityIndicator size="small" color={QuinckleColors.primary} />
                : <Ionicons name="refresh" size={18} color={QuinckleColors.primary} />}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.takeawayRefreshBtn}
              onPress={() => setTakeawayQrOpen(true)}
              activeOpacity={0.75}
            >
              <Ionicons name="qr-code-outline" size={18} color={QuinckleColors.primary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.takeawayNewIconBtn}
              onPress={() => { void startTakeawayOrder(); }}
              disabled={startingTakeaway}
              activeOpacity={0.85}
            >
              {startingTakeaway
                ? <ActivityIndicator size="small" color="#fff" />
                : <Ionicons name="add" size={22} color="#fff" />}
            </TouchableOpacity>
          </View>

          <FlatList
            data={
              (takeawaySubTab === 'preparing'
                ? takeawayOrders.filter((o) => o.status !== 'SERVED')
                : takeawayOrders.filter((o) => o.status === 'SERVED')
              ).filter(matchesTakeawaySearch)
            }
            keyExtractor={(item) => item.orderId}
            contentContainerStyle={styles.orderListContent}
            refreshControl={
              <RefreshControl refreshing={refreshingTakeaway} onRefresh={handleRefreshTakeaway} tintColor={QuinckleColors.primary} />
            }
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [
                  styles.takeawayCard,
                  pressed && canDeleteTakeaway(item) && styles.takeawayCardPressed,
                ]}
                onLongPress={() => openTakeawayManage(item)}
                delayLongPress={280}
              >
                <View style={styles.takeawayCardTop}>
                  <View style={styles.takeawayCardLeft}>
                    <Text style={styles.takeawayToken}>
                      {item.pickupToken ?? '—'}
                      <Text style={styles.takeawayTime}>
                        {'  ·  '}{new Date(item.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                      </Text>
                    </Text>
                    {(item.customerName || item.customerPhone) && (
                      <Text style={styles.takeawayCustomer}>
                        {item.customerName ?? ''}{item.customerName && item.customerPhone ? ' · ' : ''}{item.customerPhone ?? ''}
                      </Text>
                    )}
                    {item.sessionRef && (
                      <Text style={styles.takeawayRef}>{item.sessionRef}</Text>
                    )}
                  </View>
                  <View style={styles.takeawayCardRight}>
                    <View style={styles.takeawayAmountRow}>
                      <Text style={[
                        styles.takeawayStatusText,
                        { color: isTakeawayPaid(item) ? QuinckleColors.success : QuinckleColors.warning },
                      ]}>
                        {isTakeawayPaid(item) ? 'Paid' : 'Pending'}
                      </Text>
                      <Text style={styles.takeawayTotal}>₹{item.total}</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.printIconBtn}
                      onPress={() => setPrintTakeawayOrder(item)}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="print-outline" size={18} color={QuinckleColors.textSecondary} />
                    </TouchableOpacity>
                  </View>
                </View>
                <View style={styles.takeawayDivider} />
                {item.items.map((it, j) => (
                  <Text key={j} style={styles.takeawayItemText}>
                    {it.qty}× {it.name}{it.modifiers ? ` (${it.modifiers})` : ''}
                  </Text>
                ))}
                {item.status !== 'SERVED' && (
                  <View style={styles.takeawayActionRow}>
                    {isTakeawayPendingCollection(item) && (
                      <TouchableOpacity
                        style={styles.collectTakeawayBtn}
                        onPress={() => handleCollectTakeaway(item)}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.collectTakeawayBtnText}>Collect Payment</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity
                      style={[
                        styles.handoverBtn,
                        (!isTakeawayPaid(item) || handingOverIds.includes(item.orderId)) && styles.handoverBtnDisabled,
                      ]}
                      onPress={() => handleHandover(item.orderId)}
                      disabled={!isTakeawayPaid(item) || handingOverIds.includes(item.orderId)}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.handoverBtnText}>
                        {handingOverIds.includes(item.orderId) ? 'Handing Over…' : 'Hand Over'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </Pressable>
            )}
            ListEmptyComponent={
              <View style={styles.emptyOrders}>
                <View style={styles.emptyMedallion}>
                  <Ionicons name="bag-handle-outline" size={28} color={QuinckleColors.textTertiary} />
                </View>
                <Text style={styles.emptyTitle}>
                  {takeawaySubTab === 'preparing' ? 'No active takeaway orders' : 'No handed orders yet'}
                </Text>
                <Text style={styles.emptySubtitle}>
                  {takeawaySubTab === 'preparing'
                    ? 'Takeaway orders will appear here when customers order.'
                    : 'Orders you hand over move here.'}
                </Text>
              </View>
            }
          />
        </View>
      ) : null}

      <BottomNavbar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        tabs={[
          { key: 'orders' as NavItem, label: 'Orders', icon: 'receipt-outline', iconActive: 'receipt' },
          { key: 'tables' as NavItem, label: 'Tables', icon: 'grid-outline', iconActive: 'grid' },
          { key: 'takeaway' as NavItem, label: 'Takeaway', icon: 'bag-handle-outline', iconActive: 'bag-handle' },
          { key: 'menu' as NavItem, label: 'Menu', icon: 'restaurant-outline', iconActive: 'restaurant' },
        ]}
      />

      {/* Filter tables — bottom sheet */}
      <BottomSheet visible={filterVisible} onClose={() => setFilterVisible(false)} title="Filter tables">
        <View style={styles.sheetBody}>
          {FILTER_CHIPS.map((chip) => {
            const active = activeFilter === chip.key;
            return (
              <TouchableOpacity
                key={chip.key}
                style={[styles.sheetOptionRow, active && styles.sheetOptionRowActive]}
                onPress={() => { setActiveFilter(chip.key as 'all' | TableStatus); setFilterVisible(false); }}
                activeOpacity={0.7}
              >
                <Text style={[styles.sheetOptionText, active && styles.sheetOptionTextActive]}>{chip.label}</Text>
                <View style={styles.sheetOptionRight}>
                  <Text style={styles.sheetOptionCount}>{chip.count}</Text>
                  {active && <Ionicons name="checkmark" size={16} color={QuinckleColors.primary} />}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </BottomSheet>

      {/* Start session — bottom sheet with inline spinner (replaces the freeze) */}
      <BottomSheet
        visible={!!newSessionTable}
        onClose={() => { if (!startingSession) { setNewSessionTable(null); setStartError(null); } }}
        title="Start session"
      >
        <View style={styles.sheetBody}>
          <Text style={styles.sheetMessage}>
            Start a new session for Table T{String(newSessionTable?.number ?? 0).padStart(2, '0')}?
          </Text>
          {startError ? <Text style={styles.sheetErrorText}>{startError}</Text> : null}
          <TouchableOpacity
            style={[styles.sheetPrimaryBtn, startingSession && { opacity: 0.85 }]}
            onPress={() => { void startSessionForTable(); }}
            disabled={startingSession}
            activeOpacity={0.85}
          >
            {startingSession
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={styles.sheetPrimaryText}>Start session</Text>}
          </TouchableOpacity>
        </View>
      </BottomSheet>

      {/* Manage occupied table — bottom sheet (Swap / Free) */}
      <BottomSheet
        visible={!!manageTable}
        onClose={() => setManageTable(null)}
        title={`Manage Table T${String(manageTable?.number ?? 0).padStart(2, '0')}`}
      >
        <View style={styles.sheetBody}>
          <TouchableOpacity style={styles.manageRow} onPress={onPressSwapFromManage} activeOpacity={0.7}>
            <View style={styles.manageIcon}>
              <Ionicons name="swap-horizontal" size={19} color={QuinckleColors.textPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.manageRowTitle}>Swap table</Text>
              <Text style={styles.manageRowSub}>Move this guest to another table</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={QuinckleColors.textTertiary} />
          </TouchableOpacity>
          <View style={styles.manageDivider} />
          <TouchableOpacity style={styles.manageRow} onPress={onPressMergeFromManage} activeOpacity={0.7}>
            <View style={styles.manageIcon}>
              <Ionicons name="git-merge-outline" size={19} color={QuinckleColors.textPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.manageRowTitle}>Merge bill</Text>
              <Text style={styles.manageRowSub}>Combine with another table into one bill</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={QuinckleColors.textTertiary} />
          </TouchableOpacity>
          <View style={styles.manageDivider} />
          <TouchableOpacity style={styles.manageRow} onPress={onPressFreeFromManage} activeOpacity={0.7}>
            <View style={[styles.manageIcon, styles.manageIconDanger]}>
              <Ionicons name="exit-outline" size={19} color={QuinckleColors.danger} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.manageRowTitle, { color: QuinckleColors.danger }]}>Free table</Text>
              <Text style={styles.manageRowSub}>Release for new guests · payment moves to Outstanding</Text>
            </View>
          </TouchableOpacity>
        </View>
      </BottomSheet>

      {/* Swap table — reuses the detail screen's sheet + flow */}
      <SwapTableSheet
        visible={!!swapTable}
        currentTableDbId={swapTable?.id ?? ''}
        currentTableNum={String(swapTable?.number ?? 0).padStart(2, '0')}
        onClose={() => { if (!swapSubmitting) setSwapTable(null); }}
        onSwap={confirmSwapFromGrid}
        submitting={swapSubmitting}
      />

      {/* Merge bill — absorb this table's session into another occupied table */}
      <MergeTableSheet
        visible={!!mergeTable}
        currentTableDbId={mergeTable?.id ?? ''}
        currentTableNum={String(mergeTable?.number ?? 0).padStart(2, '0')}
        onClose={() => { if (!mergeSubmitting) setMergeTable(null); }}
        onMerge={confirmMergeFromGrid}
        submitting={mergeSubmitting}
      />

      <ThemedDialog
        visible={dialog.visible}
        title={dialog.title}
        message={dialog.message}
        actions={dialog.actions}
        onClose={closeDialog}
      />

      {/* Takeaway manual print — same sheet/flow as the table-detail screen */}
      <PrintOptionsSheet
        visible={!!printTakeawayOrder}
        onPrintKot={() => { if (printTakeawayOrder) void handlePrintTakeawayKot(printTakeawayOrder); }}
        onPrintInvoice={() => { if (printTakeawayOrder) void handlePrintTakeawayInvoice(printTakeawayOrder); }}
        onClose={() => setPrintTakeawayOrder(null)}
      />

      <TakeawayManageSheet
        order={manageOrder}
        onClose={() => setManageOrder(null)}
        onDeleteItem={(itemId) => deleteTakeawayItem(manageOrder!.orderId, itemId)}
        onDeleteWholeOrder={requestDeleteWholeTakeaway}
        errorMessageFor={takeawayCancelMessage}
      />

      <QrChoiceSheet
        visible={!!qrSheet}
        amount={qrSheet?.grandTotal ?? 0}
        onPick={(mode) => {
          void setUpiQrMode(mode);
          const run = qrRunRef.current;
          setQrSheet(null);
          if (run) run(mode === 'static');
        }}
        onClose={() => setQrSheet(null)}
      />

      <SideDrawer
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        venueName={staffInfo?.restaurantName}
        realtimeOk={realtimeOk}
      />

      {/* Takeaway self-order QR — show to a customer who wants to order themselves */}
      <BottomSheet visible={takeawayQrOpen} onClose={() => setTakeawayQrOpen(false)} title="Takeaway QR">
        <View style={styles.takeawayQrBody}>
          <View style={styles.takeawayQrBox}>
            {takeawayOrderUrl ? <QRCode value={takeawayOrderUrl} size={200} /> : null}
          </View>
          <Text style={styles.takeawayQrHint}>Ask the customer to scan this to order takeaway themselves</Text>
        </View>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    backgroundColor: QuinckleColors.background,
  },

  // ── Bottom-sheet content (filter / start session / manage) ──
  sheetBody: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.md, gap: 2 },
  sheetOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
  },
  sheetOptionRowActive: { backgroundColor: QuinckleColors.surfaceMutedHover },
  sheetOptionText: { color: QuinckleColors.textSecondary, fontSize: 15, fontWeight: '500' },
  sheetOptionTextActive: { color: QuinckleColors.textPrimary, fontWeight: '700' },
  sheetOptionRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sheetOptionCount: { color: QuinckleColors.textTertiary, fontSize: 13, fontWeight: '600' },
  sheetMessage: {
    color: QuinckleColors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: Spacing.md,
    paddingHorizontal: 2,
  },
  sheetErrorText: { color: QuinckleColors.danger, fontSize: 13, marginBottom: Spacing.sm, paddingHorizontal: 2 },
  sheetPrimaryBtn: {
    height: 50,
    borderRadius: Radius.md,
    backgroundColor: QuinckleColors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  sheetPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  manageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  manageIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    backgroundColor: QuinckleColors.surfaceMutedHover,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manageIconDanger: { backgroundColor: QuinckleColors.dangerSoft },
  manageRowTitle: { color: QuinckleColors.textPrimary, fontSize: 15, fontWeight: '600' },
  manageRowSub: { color: QuinckleColors.textTertiary, fontSize: 12, marginTop: 2 },
  manageDivider: { height: 1, backgroundColor: QuinckleColors.surfaceMuted, marginVertical: 2 },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  burgerBtn: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
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
  menuRefreshBtn: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    backgroundColor: QuinckleColors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchInput: {
    flex: 1,
    color: QuinckleColors.textPrimary,
    fontSize: 14,
  },
  refreshTableBtn: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    backgroundColor: QuinckleColors.surfaceMuted,
    borderColor: QuinckleColors.border,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
  },
  tableGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  tableCardOuter: {
    width: '48.5%',
    minHeight: 130,
    borderRadius: Radius.lg + 1.5,
    padding: 1.5,
    overflow: 'hidden',
    marginBottom: Spacing.md,
  },
  tableCard: {
    flex: 1,
    backgroundColor: QuinckleColors.background,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    minHeight: 130 - 3,
    justifyContent: 'space-between',
  },
  offlineCard: {
    opacity: 0.45,
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
  headerRightCol: {
    alignItems: 'flex-end',
    gap: 5,
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
  // Two status icons under the seat count: all-served + payment-settled.
  // Dim grey = pending, green = done.
  cardStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  occupiedBottomRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  occupiedBottomLeft: {
    flex: 1,
  },
  cardTimer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginLeft: Spacing.sm,
  },
  cardTimerText: {
    color: QuinckleColors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
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
  menuItemCard: {
    borderBottomWidth: 1,
    borderBottomColor: QuinckleColors.borderSubtle,
  },
  menuItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.md,
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
  // ── Modifier (variant) availability sub-rows ──
  modCaret: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 4,
  },
  modOffBadge: {
    backgroundColor: QuinckleColors.warningSoft,
    borderRadius: Radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  modOffBadgeText: {
    color: QuinckleColors.warning,
    fontSize: 10,
    fontWeight: '700',
  },
  modOptionsWrap: {
    backgroundColor: QuinckleColors.surfaceMuted,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: QuinckleColors.borderSubtle,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.md,
  },
  modGroup: {
    paddingVertical: Spacing.sm,
  },
  modGroupName: {
    color: QuinckleColors.textTertiary,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  modOptionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 7,
  },
  modGroupDivider: {
    height: 1,
    backgroundColor: QuinckleColors.borderSubtle,
  },
  modOptionName: {
    flex: 1,
    color: QuinckleColors.textPrimary,
    fontSize: 14,
    fontWeight: '500',
    paddingRight: Spacing.md,
  },
  toggleBaseSm: {
    width: 38,
    height: 22,
    borderRadius: 11,
    padding: 3,
    justifyContent: 'center',
  },
  toggleCircleSm: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#fff',
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
    flexGrow: 1,
    paddingBottom: 100,
  },
  segmentWrap: {
    marginBottom: Spacing.md,
  },
  emptyOrders: {
    flex: 1,
    paddingVertical: Spacing.huge,
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  emptyMedallion: {
    width: 72, height: 72, borderRadius: 36,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: QuinckleColors.surfaceElevated,
    borderWidth: 1, borderColor: QuinckleColors.border,
    marginBottom: Spacing.xs,
  },
  emptyMedallionActive: {
    width: 72, height: 72, borderRadius: 36,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: QuinckleColors.successSoft,
    borderWidth: 1, borderColor: QuinckleColors.successBorder,
    marginBottom: Spacing.xs,
    shadowColor: QuinckleColors.success,
    shadowOpacity: 0.25, shadowRadius: 16, shadowOffset: { width: 0, height: 0 },
  },
  emptyTitle: {
    color: QuinckleColors.textPrimary,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  emptySubtitle: {
    color: QuinckleColors.textTertiary,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
    maxWidth: 280,
  },
  loadMoreCompletedBtn: {
    marginTop: Spacing.md,
    alignSelf: 'center',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: QuinckleColors.borderStrong,
    backgroundColor: QuinckleColors.surfaceMuted,
  },
  loadMoreCompletedText: {
    color: QuinckleColors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
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

  // ── Takeaway ──
  takeawayCard: {
    backgroundColor: QuinckleColors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  takeawayCardPressed: {
    backgroundColor: QuinckleColors.surfaceElevated,
    borderColor: QuinckleColors.borderStrong,
  },
  takeawayCardTop: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: Spacing.sm,
  },
  takeawayCardLeft: {
    flex: 1,
  },
  takeawayCardRight: {
    alignItems: 'stretch',
    minWidth: 68,
    gap: Spacing.xs,
  },
  takeawayAmountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: Spacing.sm,
  },
  takeawayStatusText: {
    fontSize: 12,
    fontWeight: '700',
  },
  takeawayToken: {
    fontSize: 18,
    fontWeight: '800',
    color: QuinckleColors.primary,
  },
  takeawayTotal: {
    fontSize: 14,
    fontWeight: '600',
    color: QuinckleColors.textPrimary,
  },
  takeawayTime: {
    fontSize: 12,
    color: QuinckleColors.textTertiary,
    fontWeight: '400',
  },
  takeawayCustomer: {
    fontSize: 13,
    color: QuinckleColors.textSecondary,
    marginTop: 4,
  },
  takeawayRef: {
    fontSize: 11,
    color: QuinckleColors.textTertiary,
    marginTop: 2,
    fontFamily: 'monospace',
  },
  takeawayNewIconBtn: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    backgroundColor: QuinckleColors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  takeawayQrBody: {
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xl,
    gap: Spacing.md,
  },
  takeawayQrBox: {
    padding: 16,
    backgroundColor: '#fff',
    borderRadius: Radius.lg,
  },
  takeawayQrHint: {
    color: QuinckleColors.textMuted,
    fontSize: 12,
    textAlign: 'center',
  },
  takeawayRefreshBtn: {
    width: 40,
    height: 40,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: QuinckleColors.surface,
  },
  takeawayDivider: {
    height: 1,
    backgroundColor: QuinckleColors.border,
    marginVertical: Spacing.sm,
  },
  takeawayItemText: {
    fontSize: 13,
    color: QuinckleColors.textPrimary,
    lineHeight: 20,
  },
  handoverBtn: {
    flex: 1,
    backgroundColor: QuinckleColors.primary,
    borderRadius: Radius.sm,
    paddingVertical: 10,
    alignItems: 'center',
  },
  printIconBtn: {
    flex: 1,
    minHeight: 32,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    borderRadius: Radius.sm,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  takeawayActionRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  collectTakeawayBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: QuinckleColors.primary,
    borderRadius: Radius.sm,
    paddingVertical: 10,
    alignItems: 'center',
  },
  collectTakeawayBtnText: {
    color: QuinckleColors.primary,
    fontSize: 14,
    fontWeight: '700',
  },
  handoverBtnDisabled: {
    opacity: 0.5,
  },
  handoverBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
});
