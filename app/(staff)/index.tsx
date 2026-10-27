import React, { useCallback, useMemo, useState, useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  AppState,
  Easing,
  FlatList,
  RefreshControl,
  Image,
  LayoutAnimation,
  Linking,
  Modal,
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

import { useAuth } from '../../context/AuthContext';
import { Audio } from 'expo-av';
import { crewTables, crewSessions, crewOrders, crewPayments, crewMenu, crewDelivery, restaurantApi, printerApi, loyaltyApi, type ClosedSessionInfo } from '../../services/api';
import { subscribeChannel, watchConnection } from '../../services/realtime';
import { invalidateCache, writeCache, cacheKeys } from '../../services/dataCache';
import { startTableSession, isTableSessionStarting } from '../../services/tableSessionStart';
import { startTakeawaySession } from '../../services/takeawaySessionStart';
import {
  printKot, getStatus as getPrinterStatus, isUpiQrEnabled, setUpiQrMode,
  getPrinters,
} from '../../services/printer';
import { printBillFromHere } from '../../services/billPrint';
import type { InvoiceBill } from '../../services/invoiceTemplate';
import { setSinkContext, drainPendingPrintJobs, handleSinkSuperseded, watchPrintDispatch } from '../../services/printSink';
import { getPrintDeviceId } from '../../services/printDevice';
import type { TakeawayOrder } from '../../services/api';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { QuinckleColors, Radius, Spacing, Typography } from '../../constants/Colors';
import { ThemedDialog } from '../../components/ui/themed-dialog';
import { BottomSheet } from '../../components/ui/BottomSheet';
import { CenteredModal } from '../../components/ui/CenteredModal';
import { SlideDrawer } from '../../components/ui/SlideDrawer';
import { MenuPanel } from '../../components/menu/MenuPanel';
import { TableAvailableIcon, NoTableSelectedIcon } from '../../components/ui/TableIcons';
import { OrderPlacedCurtain } from '../../components/ui/OrderPlacedCurtain';
import { takeOrderPlacedSignal } from '../../services/orderPlacedSignal';
import { isDesktop } from '../../services/platform';
import { StartSessionOverlay, type StartSessionJob } from '../../components/ui/StartSessionOverlay';
import { SwapTableSheet } from '../../components/ui/SwapTableSheet';
import { MergeTableSheet } from '../../components/ui/MergeTableSheet';
import { GroupPickerSheet } from '../../components/ui/GroupPickerSheet';
import { UndoSnackbar } from '../../components/ui/UndoSnackbar';
import { CollectPaymentPanel } from '../../components/ui/CollectPaymentPanel';
import { useManagerApproval, type MintGrant } from '../../components/ui/ManagerPinSheet';
// FreeTableOverlay (center "table cleared" modal) removed — every free now uses
// the bottom UndoSnackbar so it never blocks the floor during a rush.
import { addReady, pruneToActive, type ReadyNav } from '../../stores/itemReadyToast';
import { ClearFlash } from '../../components/ui/ClearFlash';
import { BottomNavbar } from '../../components/ui/BottomNavbar';
import { PICKUP_LAYOUT_PRESET, PickupCard, PickupSegmented } from '../../components/ui/pickup';
import { PrintOptionsSheet, PrintCard, type InvoiceBuyer } from '../../components/ui/PrintOptionsSheet';
import { AdjustBillForm } from './adjust-bill';
import { BillExplainSheet, type ExplainedBill } from '../../components/ui/BillExplainSheet';
import { PrintProgressOverlay, type PrintJob } from '../../components/ui/PrintProgressOverlay';
import { TakeawayManageSheet } from '../../components/ui/TakeawayManageSheet';
import { ReasonSheet } from '../../components/ui/ReasonSheet';
import type { CancelReason } from '../../constants/adjustmentReasons';
import { QrChoiceSheet } from '../../components/ui/QrChoiceSheet';
import { TableSkeleton } from '../../components/ui/TableSkeleton';
import { MenuSkeleton } from '../../components/ui/MenuSkeleton';
import { TakeawaySkeleton } from '../../components/ui/TakeawaySkeleton';
import { SuccessToast } from '../../components/ui/SuccessToast';
import { GiveDiscountModal } from '../../components/ui/GiveDiscountModal';
import { DeliveryBoard } from '../../components/delivery/DeliveryBoard';
import { RiderRuns } from '../../components/delivery/RiderRuns';
import { CAP, deliveryViewFor, hasCapability, type Capability } from '../../constants/capabilities';
import { useResponsive } from '../../hooks/useResponsive';
import { TableDetailScreen } from './[tableId]';
import { expiryLevel, expiryColor, expiryChipStyle, type ExpiryLevel } from '../../constants/sessionExpiry';
import { isOffPremise, channelLabel, locationLabel as channelLocationLabel } from '../../constants/channel';

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

// Compact session countdown for the table card — time only, no "left" label.
// Returns null when there's no expiry to show. `danger` flags the last 10
// minutes (and an already-expired session) so the card can tint it red.
/**
 * Remaining-time chip for a floor-grid card. `occupiedSince` lets the urgency
 * scale to the venue's own turn time — see constants/sessionExpiry. It shares
 * that helper with the table detail screen on purpose: the threshold used to be
 * a 10-minute constant copy-pasted into both, and they had already drifted
 * (this one treated an expired table as danger, the detail screen did not).
 */
function formatTimeLeft(
  expiresAt: string | null | undefined,
  now: number,
  occupiedSince?: string | null,
): { text: string; level: ExpiryLevel } | null {
  if (!expiresAt) return null;
  const msLeft = new Date(expiresAt).getTime() - now;
  if (Number.isNaN(msLeft)) return null;
  const level = expiryLevel(msLeft, expiresAt, occupiedSince);
  if (msLeft <= 0) return { text: 'Expired', level };
  const h = Math.floor(msLeft / 3_600_000);
  const m = Math.floor((msLeft % 3_600_000) / 60_000);
  const text = h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m` : '<1m';
  return { text, level };
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

type NavItem = 'tables' | 'menu' | 'orders' | 'takeaway' | 'delivery';
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
  /** Some party's bill is printed and not yet paid — cutting it needs a manager. */
  billPrintedUnpaid?: boolean;
  // Shared seating: one entry per live party (slot order). >1 → the tap
  // opens a group picker and the card shows a groups badge + combined total.
  groups?: TableGroup[];
  // Party cap (maxActiveSessionsPerTable). >1 lets crew seat another group
  // on an occupied table.
  maxParties?: number;
  // Seating zone ("Rooftop", "Jalsaghar") — a grouping label only, so the
  // table number, its QR and any live session are unaffected. Null means
  // unassigned, and the grid drops those into a trailing section.
  zoneId?: string | null;
  zoneName?: string | null;
  zoneSortOrder?: number | null;
};

type TableGroup = {
  session_id: string;
  party_slot: number;
  label: string;
  occupied_since: string | null;
  expires_at?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  bill_total?: number;
  items_served?: number;
  items_total?: number;
  payment_settled?: boolean;
  bill_printed?: boolean;
  // Items the diner has put in their cart but not ordered yet.
  cart_item_count?: number;
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
  /** ISO instant a temporary 86 expires; null = off until someone turns it on. */
  unavailableUntil?: string | null;
};

/**
 * "Back at" presets for a temporary 86 (availability slotting). Deliberately
 * three fixed choices and no custom time picker: a datetime picker would mean a
 * new native dependency, which cannot ship over the air, and a busy floor wants
 * one tap rather than a spinner. All instants are computed in IST, which is the
 * only timezone the product runs in.
 */
const IST_OFFSET_MIN = 330;

// Orders (serve queue) grid, desktop only — fixed tiles, always 3 across, no
// responsive column count and nothing stretches to fill leftover space. A
// KOT with more items than fits scrolls internally (see PickupCard's
// fixedWidth/fixedHeight props) instead of growing the tile.
const KOT_CARD_WIDTH = 420;
const KOT_CARD_HEIGHT = 300;

/** The UTC instant of `hour`:00 IST, `dayOffset` days from now. */
function istInstantFromNow(dayOffset: number, hour: number): string {
  const shifted = new Date(Date.now() + IST_OFFSET_MIN * 60_000);
  shifted.setUTCHours(0, 0, 0, 0);
  const istMidnightUtcMs = shifted.getTime() - IST_OFFSET_MIN * 60_000;
  return new Date(istMidnightUtcMs + ((dayOffset * 24 + hour) * 60) * 60_000).toISOString();
}

const EIGHTY_SIX_PRESETS: { key: string; label: string; hint: string; until: () => string | null }[] = [
  { key: 'tomorrow', label: 'Back tomorrow morning', hint: 'Returns at 6:00 AM', until: () => istInstantFromNow(1, 6) },
  { key: 'tonight',  label: 'Rest of today',          hint: 'Returns at midnight',  until: () => istInstantFromNow(1, 0) },
  { key: 'manual',   label: "Until I turn it back on", hint: 'No automatic return',  until: () => null },
];

/** "6:00 AM" / "12:00 AM" for a stored expiry, read on the IST clock. */
function formatBackAt(iso: string): string {
  const shifted = new Date(new Date(iso).getTime() + IST_OFFSET_MIN * 60_000);
  const h24 = shifted.getUTCHours();
  const m = shifted.getUTCMinutes();
  const suffix = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return m === 0 ? `${h12} ${suffix}` : `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

type PickupItem = { id: string; name: string; qty: number; servedQty: number; orderedAt: string; isServed: boolean; isReady: boolean };
type PickupOrder = { id: string; tableNo: string; items: PickupItem[]; completedAt?: string };

function mapCompletedOrder(order: any): PickupOrder {
  return {
    id: order.order_id,
    tableNo: channelLocationLabel(order.channel, { token: order.pickup_token ?? 'TK', tableNumber: order.table_number }),
    completedAt: order.served_at ?? order.placed_at,
    items: order.items.map((item: any) => ({
      id: item.item_id,
      // Bare name — PickupItemRow renders the quantity in its own column, so
      // prefixing it here printed every line twice ("4× 4× Coffee").
      name: item.name,
      qty: item.qty,
      servedQty: item.qty,
      orderedAt: (() => {
        const d = new Date(order.placed_at);
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      })(),
      isServed: true,
      isReady: true,
    })),
  };
}

const STATUS_META: Record<TableStatus, { label: string; color: string }> = {
  available: { label: 'Available', color: QuinckleColors.success },
  occupied: { label: 'Occupied', color: QuinckleColors.primary },
  offline: { label: 'Offline', color: QuinckleColors.textTertiary },
};

// ── Takeaway: one card per customer ──────────────────────────────────────────
// Every round a takeaway customer orders is its own Order (its own KOT), all on
// the same session. The board shows ONE card per session — items merged into
// rows, one total, one "collect what is still due" — the way a table works.
// Actions still go to the real orders underneath (`orders`, `lines`).

const TAKEAWAY_PAID = ['PAID_CASH', 'PAID_UPI_DIRECT', 'PAID_ONLINE', 'PAID_MIXED', 'WAIVED'];
const TAKEAWAY_COLLECTIBLE = ['PENDING_STAFF_COLLECTION', 'PENDING_CASH', 'PENDING_UPI_DIRECT', 'UNPAID'];
const TAKEAWAY_STATUS_RANK: Record<string, number> = { RECEIVED: 0, PREPARING: 1, READY: 2, SERVED: 3 };
const payStatus = (o: TakeawayOrder) => String(o.paymentStatus ?? '').toUpperCase();
const r2 = (n: number) => Math.round(n * 100) / 100;

/** One real order line behind a merged takeaway row. */
type TakeawayLine = { orderId: string; itemId: string; qty: number; paid: boolean; at: string };
type TakeawayRowItem = TakeawayOrder['items'][number] & { lines: TakeawayLine[] };
/** A takeaway customer's whole visit. Still a TakeawayOrder in shape, so every
 *  card and sheet that took one keeps working; `orderId` is the first round's. */
type TakeawayGroup = Omit<TakeawayOrder, 'items'> & {
  items: TakeawayRowItem[];
  orders: TakeawayOrder[];
  /** Rounds still owing money — what Collect charges for. */
  unpaidOrders: TakeawayOrder[];
  dueTotal: number;
  paidTotal: number;
};

/** Same dish + options + unit price — the bill's merge rule (services/mergeBillLines.ts). */
const takeawayRowKey = (it: { menuItemId?: string; name: string; unitPrice: number; modifiers: string | null }) =>
  [it.menuItemId || it.name, Number(it.unitPrice).toFixed(2), it.modifiers ?? ''].join('\u0000');

function mergeTakeaway(list: TakeawayOrder[]): TakeawayGroup {
  const orders = [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const first = orders[0]!;
  const isPaid = (o: TakeawayOrder) => TAKEAWAY_PAID.includes(payStatus(o));
  const unpaidOrders = orders.filter((o) => TAKEAWAY_COLLECTIBLE.includes(payStatus(o)));
  const lineOf = (o: TakeawayOrder, it: TakeawayOrder['items'][number]): TakeawayLine =>
    ({ orderId: o.orderId, itemId: it.itemId, qty: it.qty, paid: isPaid(o), at: o.createdAt });

  // A single round keeps its lines exactly as they are (the long-press manage
  // sheet deletes by line); only several rounds get merged into rows.
  let items: TakeawayRowItem[];
  if (orders.length === 1) {
    items = first.items.map((it) => ({ ...it, lines: [lineOf(first, it)] }));
  } else {
    const rows = new Map<string, TakeawayRowItem>();
    for (const o of orders) for (const it of o.items) {
      const k = takeawayRowKey(it);
      const row = rows.get(k);
      if (row) { row.qty += it.qty; row.lines.push(lineOf(o, it)); }
      else rows.set(k, { ...it, lines: [lineOf(o, it)] });
    }
    items = [...rows.values()];
  }

  const sum = (f: (o: TakeawayOrder) => number | undefined | null) => r2(orders.reduce((n, o) => n + (Number(f(o)) || 0), 0));
  const charges = new Map<string, { id: string; name: string; amount: number }>();
  const taxes = new Map<number, { rate: number; taxableValue: number; cgst: number; sgst: number; amount: number }>();
  for (const o of orders) {
    for (const c of o.chargeLines ?? []) {
      const cur = charges.get(c.id);
      if (cur) cur.amount = r2(cur.amount + c.amount); else charges.set(c.id, { ...c });
    }
    for (const t of o.taxLines ?? []) {
      const cur = taxes.get(t.rate);
      if (cur) {
        cur.taxableValue = r2(cur.taxableValue + t.taxableValue);
        cur.cgst = r2(cur.cgst + t.cgst); cur.sgst = r2(cur.sgst + t.sgst); cur.amount = r2(cur.amount + t.amount);
      } else taxes.set(t.rate, { ...t });
    }
  }

  const live = orders.filter((o) => o.status !== 'SERVED');
  const status = live.length === 0 ? 'SERVED'
    : live.reduce((a, o) => ((TAKEAWAY_STATUS_RANK[o.status] ?? 0) < (TAKEAWAY_STATUS_RANK[a] ?? 0) ? o.status : a), live[0]!.status);
  const paymentStatus = unpaidOrders.length > 0 ? unpaidOrders[0]!.paymentStatus
    : orders.every(isPaid) ? (new Set(orders.map(payStatus)).size === 1 ? first.paymentStatus : 'PAID_MIXED')
    : orders.find((o) => !isPaid(o))!.paymentStatus; // e.g. DUE (on khata)
  const total = sum((o) => o.total);
  const dueTotal = r2(unpaidOrders.reduce((n, o) => n + (Number(o.total) || 0), 0));

  return {
    ...first,
    customerName: orders.find((o) => o.customerName)?.customerName ?? null,
    customerPhone: orders.find((o) => o.customerPhone)?.customerPhone ?? null,
    items,
    status,
    subtotal: sum((o) => o.subtotal),
    discount: sum((o) => o.discount),
    manualDiscount: sum((o) => o.manualDiscount),
    manualDiscountNote: orders.find((o) => o.manualDiscountNote)?.manualDiscountNote ?? null,
    tax: sum((o) => o.tax),
    serviceCharge: sum((o) => o.serviceCharge),
    chargeLines: [...charges.values()],
    taxLines: [...taxes.values()],
    roundOff: sum((o) => o.roundOff),
    total,
    paymentStatus,
    paymentMethod: new Set(orders.map((o) => o.paymentMethod)).size === 1 ? first.paymentMethod : null,
    orders,
    unpaidOrders,
    dueTotal,
    paidTotal: r2(total - dueTotal),
  };
}

/** The board's list, newest-first order kept by each group's first appearance. */
function groupTakeawayOrders(orders: TakeawayOrder[]): TakeawayGroup[] {
  const bySession = new Map<string, TakeawayOrder[]>();
  for (const o of orders) {
    const k = o.sessionId || o.orderId;
    const list = bySession.get(k);
    if (list) list.push(o); else bySession.set(k, [o]);
  }
  return [...bySession.values()].map(mergeTakeaway);
}

export default function StaffDashboard() {
  const insets = useSafeAreaInsets();
  const { staffInfo, capabilities } = useAuth();
  const { width: winWidth, isTablet, isWide } = useResponsive();

  // A takeaway order placed with Split or Due pre-chosen on order-menu's
  // payment pill collects right there and lands back here — payment-collect
  // is never opened for those two (see order-menu.tsx's confirmAndPlace) — so
  // this is the only screen left to show the "placed" confirmation.
  const placedParams = useLocalSearchParams<{ placedAmount?: string; placedCount?: string; collectedLabel?: string; tab?: string; selectOrderId?: string }>();
  const [placedMessage, setPlacedMessage] = useState<string | null>(null);
  // Takeaway twin of the table panel's order-placed curtain: order-menu lands
  // here with the new order selected, and the green beat plays over the
  // takeaway panel before revealing it. Only drawn on wide layouts — the
  // takeaway panel does not exist on phones.
  const [takeawayPlacedCurtainId, setTakeawayPlacedCurtainId] = useState<string | null>(null);
  useEffect(() => {
    if (!placedParams.placedAmount) return;
    const n = Number(placedParams.placedCount) || 0;
    const label = placedParams.collectedLabel ? ` · ${placedParams.collectedLabel}` : '';
    setPlacedMessage(`${n} item${n !== 1 ? 's' : ''} placed · ₹${placedParams.placedAmount}${label}`);
    // order-menu's `replace` back to this route mounts a fresh instance
    // (see its own comment), so activeTab has already reset to 'tables' by
    // the time this runs — land on the tab the order actually belongs to,
    // with its panel already open on the order just placed (selection is
    // safe to set before the list has loaded — the panel just resolves it
    // once loadTakeawayOrders' fetch lands).
    if (placedParams.tab === 'takeaway') {
      setActiveTab('takeaway');
      if (placedParams.selectOrderId) {
        setSelectedTakeawayId(placedParams.selectOrderId);
        setTakeawayPlacedCurtainId(placedParams.selectOrderId);
      }
    }
    router.setParams({ placedAmount: undefined, placedCount: undefined, collectedLabel: undefined, tab: undefined, selectOrderId: undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placedParams.placedAmount]);
  // Table grid columns: phones stay 2-up; tablets scale with width (target
  // ~240dp per card) so landscape fills the screen instead of leaving 2 wide
  // columns. space-between + a ~2% gutter keeps the existing look. Wide
  // layouts permanently give 40% of the width to the table side panel (see
  // tablePanel below) — the column count is worked out against the 60% the
  // grid actually gets, not the full window, or cards would be sized for
  // space the panel is sitting on.
  const tableGridWidth = isWide ? winWidth * 0.6 : winWidth;
  // Same target width and column clamp as the takeaway grid's
  // takeawayGridColumns, so the two grids' cards read as the same size.
  const tableColumns = isTablet ? Math.max(3, Math.min(5, Math.floor(tableGridWidth / 230))) : 2;
  const tableCellWidth = `${(100 - 2 * (tableColumns - 1)) / tableColumns}%` as `${number}%`;
  // Takeaway grid: same 60%-of-window basis as the table grid (see `split`
  // below). ~230dp per card — a token, a status word and a total fit that
  // comfortably, so more (narrower) columns read better than a few wide ones.
  const takeawayGridColumns = isWide ? Math.max(3, Math.min(5, Math.floor((winWidth * 0.6) / 230))) : 1;
  // Orders (serve queue): always exactly 3 fixed-size tiles across on
  // desktop — no responsive 1/2/3 column count based on window width, the
  // tiles just sit at their fixed size (see KOT_CARD_WIDTH/HEIGHT). Phone
  // keeps its natural single, full-width, height-to-content card.
  const ordersGridColumns = isWide ? 3 : 1;
  const [activeTab, setActiveTab] = useState<NavItem>('tables');
  // Desktop opens the menu as a left-hand drawer over this screen; phones and
  // tablets keep pushing the full-screen /more sheet.
  const [menuOpen, setMenuOpen] = useState(false);
  // Delivery is a channel on the navbar, not a row in the burger menu — but
  // only at venues where it is actually switched on. `can` answers yes when the
  // capability list is unknown (older backend / restored session), so the
  // capability alone would put a dead tab on every venue's navbar; one cheap
  // probe settles it, since every delivery route 404s where it is off.
  //
  // WHICH board they get follows from the capability too (§3/§4): the counter
  // runs the whole panel, a rider sees only their own runs. One tab, two
  // views — a separate rider stack would duplicate every lifecycle action for
  // no behavioural difference.
  const deliveryView = deliveryViewFor(capabilities);
  const canDelivery = deliveryView !== null;
  const [deliveryOn, setDeliveryOn] = useState(false);
  useEffect(() => {
    if (!canDelivery) { setDeliveryOn(false); return; }
    let alive = true;
    crewDelivery.meta()
      .then(() => { if (alive) setDeliveryOn(true); })
      .catch(() => { if (alive) setDeliveryOn(false); });
    return () => { alive = false; };
  }, [canDelivery]);
  // Don't strand the staffer on a tab that just disappeared from the navbar.
  useEffect(() => {
    if (!deliveryOn) setActiveTab((t) => (t === 'delivery' ? 'tables' : t));
  }, [deliveryOn]);

  /**
   * The navbar is built from capabilities, not fixed (§3).
   *
   * It used to be four hard-coded tabs, which was harmless while everyone who
   * could log in could work the floor. A rider-only staffer breaks that: they
   * would land on a table grid they cannot use, with their actual job one tab
   * across. Same rule as the burger menu — show what they hold.
   *
   * `can` answers YES when capabilities are unknown (older backend, restored
   * session), so this degrades to exactly the old four-tab bar rather than to
   * an empty one.
   */
  const navTabs = useMemo(() => {
    // Keyed off `capabilities` rather than `can`, which AuthContext rebuilds
    // on every render — depending on it would recompute the bar (and re-run
    // the effect below) on every single render.
    const holds = (c: Capability) => hasCapability(capabilities, c);
    const tabs: { key: NavItem; label: string; icon: any; iconActive: any }[] = [];
    if (holds(CAP.ORDERS)) {
      tabs.push({ key: 'orders', label: 'Orders', icon: 'receipt-outline', iconActive: 'receipt' });
    }
    if (holds(CAP.TABLES)) {
      tabs.push({ key: 'tables', label: 'Tables', icon: 'grid-outline', iconActive: 'grid' });
    }
    // Takeaway is a channel of ORDERS, not a capability of its own.
    if (holds(CAP.ORDERS)) {
      tabs.push({ key: 'takeaway', label: 'Takeaway', icon: 'bag-handle-outline', iconActive: 'bag-handle' });
    }
    // Delivery sits beside the other two off-premise channels, not five taps
    // away behind the burger menu — and only where the venue has it switched on.
    if (deliveryOn) {
      tabs.push({ key: 'delivery', label: 'Delivery', icon: 'bicycle-outline', iconActive: 'bicycle' });
    }
    if (holds(CAP.MENU_EDIT)) {
      tabs.push({ key: 'menu', label: 'Menu', icon: 'restaurant-outline', iconActive: 'restaurant' });
    }
    return tabs;
  }, [capabilities, deliveryOn]);

  // A staffer whose only tab is Delivery must OPEN on it. The default is
  // 'tables', which for a rider is a grid they hold no capability for.
  useEffect(() => {
    if (navTabs.length === 0) return;
    setActiveTab((t) => (navTabs.some((tab) => tab.key === t) ? t : navTabs[0].key));
  }, [navTabs]);
  const [filterVisible, setFilterVisible] = useState(false);
  // Tapping a free table starts the session immediately — no confirm modal.
  // Long-press is already "mark offline" (see handleLongPress), so a single
  // tap unambiguously means "open this table". StartSessionOverlay is the
  // only feedback while the create-session call is in flight.
  const [startSessionJob, setStartSessionJob] = useState<StartSessionJob | null>(null);
  const pendingSessionNav = useRef<Parameters<typeof router.push>[0] | null>(null);
  // Shared seating: which occupied table's group picker sheet is open.
  const [groupPicker, setGroupPicker] = useState<{ table: Table; groups: TableGroup[]; canAddParty: boolean } | null>(null);
  const [seatingParty, setSeatingParty] = useState(false);

  // Manage-table action sheet (occupied long-press) + reused swap sheet.
  const [manageTable, setManageTable] = useState<Table | null>(null);
  const [swapTable, setSwapTable] = useState<{ id: string; number: number } | null>(null);
  const [swapSubmitting, setSwapSubmitting] = useState(false);
  const [mergeTable, setMergeTable] = useState<{ id: string; number: number } | null>(null);
  const [mergeSubmitting, setMergeSubmitting] = useState(false);
  const [tables, setTables] = useState<Table[]>([]);
  // Mirror of `tables` for use inside stable callbacks (loadPickupOrders) that
  // must resolve a table's DB id without re-subscribing to every table change.
  const tablesRef = useRef<Table[]>([]);

  // Wide layout: the table a crew member has selected shows in a fixed side
  // panel instead of pushing a separate table-details screen (see
  // TableDetailScreen's panelMode). A snapshot at selection time, same shape
  // as the params [tableId] used to be pushed with — the panel fetches its
  // own live bill/order data off `sessionId` from there, same as that route
  // always did, so this never needs to be kept in sync with `tables` itself.
  const [tablePanel, setTablePanel] = useState<
    | null
    | { status: 'available'; table: Table }
    | {
        status: 'occupied'; tableId: string; sessionId: string; tableDbId: string;
        occupiedSince: string; expiresAt: string; customerName: string; customerPhone: string;
        groupLabel: string; zoneName: string;
        /** Grid card's quick-print icon selected this table — see [tableId].tsx's autoOpenPrint prop. */
        autoOpenPrint?: boolean;
      }
  >(null);
  // Quick-print (the grid card's own print icon) shouldn't leave the panel
  // pointed at a different table than whatever the crew actually had open —
  // it's a "print this and get back to what I was doing" action, not a
  // selection. Snapshot whatever was selected right before switching, and
  // TableDetailScreen's onQuickPrintFinished restores it once the flow ends.
  const quickPrintPrevPanelRef = useRef<typeof tablePanel>(null);
  // If the selected table gets freed by someone else while its panel is open,
  // fall back to the available placeholder instead of showing a stale bill;
  // if the table itself vanishes (re-seated floor plan), just close it.
  // Also the other direction: order-menu's isWide path pops straight back to
  // this screen after placing a fresh table's first order, leaving the panel
  // still pointed at the stale "available" placeholder until `tables`
  // refetches — this is where it picks up the now-occupied table and swaps
  // the panel over (single-party only; a table that came back with more than
  // one live party needs the group picker, which this isn't).
  useEffect(() => {
    if (!tablePanel) return;
    const dbId = tablePanel.status === 'available' ? tablePanel.table.id : tablePanel.tableDbId;
    const live = tables.find(t => t.id === dbId);
    if (!live) { setTablePanel(null); return; }
    if (tablePanel.status === 'occupied' && live.status !== 'occupied') {
      setTablePanel({ status: 'available', table: live });
      return;
    }
    if (tablePanel.status === 'available' && live.status === 'occupied' && (live.groups?.length ?? 0) <= 1) {
      setTablePanel({
        status: 'occupied',
        tableId: String(live.number),
        sessionId: live.sessionId ?? '',
        tableDbId: live.id,
        occupiedSince: live.occupiedSince ?? '',
        expiresAt: live.expiresAt ?? '',
        customerName: live.customerName ?? '',
        customerPhone: live.customerPhone ?? '',
        groupLabel: '',
        zoneName: live.zoneName ?? '',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables]);
  tablesRef.current = tables;
  // The order-placed curtain plays over the panel above exactly once per
  // placed order — takeOrderPlacedSignal self-clears, so it only ever fires
  // for the table order-menu actually just marked.
  //
  // A FOCUS effect, not a plain one: after "Add items" on a table already in
  // the panel, order-menu pops back to this screen with the panel unchanged,
  // so an effect keyed on `tablePanel` never re-ran and the curtain never
  // played. Returning to the screen is the moment to check; a panel change
  // while focused still re-runs it (the callback's deps change).
  const [curtainSessionId, setCurtainSessionId] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (tablePanel?.status === 'occupied' && takeOrderPlacedSignal(tablePanel.tableDbId)) {
        setCurtainSessionId(tablePanel.sessionId);
      }
    }, [tablePanel]),
  );
  const [isLoadingTables, setIsLoadingTables] = useState(true);
  // Freeing UX: every free path (single, group, batch) raises the same bottom
  // Undo snackbar, which holds the closed sessions to reopen and a busy flag
  // while the reopen request is inflight.
  const [undo, setUndo] = useState<{ message: string; sessions: ClosedSessionInfo[] } | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);
  // Ids of cards that just cleared in a batch — drives a brief in-card sweep.
  const [recentlyFreedIds, setRecentlyFreedIds] = useState<Set<string>>(new Set());
  // End-of-service multi-select clear: toggle + the set of picked table ids.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Single shared clock for every card's session countdown. Minute precision is
  // all the grid needs, so one 30s tick is far cheaper than a per-card 1s timer.
  const [now, setNow] = useState(() => Date.now());
  const [isLoadingMenu, setIsLoadingMenu] = useState(true);
  const [menuData, setMenuData] = useState<MenuRow[]>(MENU_DATA_INITIAL);
  const [expandedMenuItem, setExpandedMenuItem] = useState<string | null>(null);
  // Item awaiting a "when does it come back?" answer before being 86'd.
  const [eightySixTarget, setEightySixTarget] = useState<MenuRow | null>(null);
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
  // Pending cash-collection requests across the whole restaurant. Drives the
  // red-dot badge on the cash icon in the header. Updated from:
  //  - initial fetch on mount
  //  - cash_collection_requested Ably event (+1)
  //  - cash_payment_collected   Ably event (−1, floored at 0)
  const [pendingCashCount, setPendingCashCount] = useState(0);
  const [pickupOrders, setPickupOrders] = useState<PickupOrder[]>([]);
  const pickupOrderIdsRef = useRef<Set<string>>(new Set());

  // DUAL_CHANNEL "item ready" toast cards. In DUAL_CHANNEL the kitchen marks
  // items done; loadPickupOrders diffs item_status transitions (pending → done)
  // and pushes a coalesced-per-table card + distinct chime into the global
  // itemReadyToast store, which the staff LAYOUT renders above the whole Stack
  // so the card stays visible even after the steward taps into a table screen.
  const dualChannelRef = useRef(false);
  const prevItemStatusRef = useRef<Map<string, 'pending' | 'done'>>(new Map());
  const pickupSeededRef = useRef(false);
  const [completedPickupOrders, setCompletedPickupOrders] = useState<PickupOrder[]>([]);
  const [completedPage, setCompletedPage] = useState(1);
  const [completedHasMore, setCompletedHasMore] = useState(false);
  const [isLoadingMoreCompleted, setIsLoadingMoreCompleted] = useState(false);
  const [ordersSubTab, setOrdersSubTab] = useState<'active' | 'completed'>('active');
  const [completingIds, setCompletingIds] = useState<string[]>([]);
  // ── Takeaway state ──
  const [takeawayOrders, setTakeawayOrders] = useState<TakeawayOrder[]>([]);
  // One card per customer (see groupTakeawayOrders). Everything the board and
  // panel draw reads these; `takeawayOrders` stays the raw per-round list.
  const takeawayGroups = useMemo(() => groupTakeawayOrders(takeawayOrders), [takeawayOrders]);
  const groupOfTakeaway = (order: TakeawayOrder): TakeawayGroup =>
    takeawayGroups.find((g) => g.orders.some((o) => o.orderId === order.orderId)) ?? mergeTakeaway([order]);
  const [takeawaySubTab, setTakeawaySubTab] = useState<'preparing' | 'handed'>('preparing');
  // Wide toolbar's Preparing/Handed switcher — a dropdown instead of two
  // tabs. Position is measured off the trigger button (measureInWindow) and
  // the menu itself renders in a transparent Modal so it floats above
  // everything regardless of where this sits in the tree, with a full-screen
  // backdrop Pressable behind it for click-outside-to-close.
  const takeawayTabBtnRef = useRef<View>(null);
  const [takeawayTabMenuOpen, setTakeawayTabMenuOpen] = useState(false);
  const [takeawayTabMenuPos, setTakeawayTabMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const openTakeawayTabMenu = () => {
    takeawayTabBtnRef.current?.measureInWindow((x, y, width, height) => {
      setTakeawayTabMenuPos({ top: y + height + 4, left: x, width });
      setTakeawayTabMenuOpen(true);
    });
  };
  const [handingOverIds, setHandingOverIds] = useState<string[]>([]);
  // Set to the order's id right after ITS OWN panel hands it over, so the
  // panel plays a brief "handed over" curtain (same component the table
  // panel uses for "order placed") before falling back to the idle
  // placeholder — instead of just sitting on a settled order forever.
  const [handoverCurtainId, setHandoverCurtainId] = useState<string | null>(null);
  // Set by the collect sheet's own "Hand over" toggle (see
  // takeawayCollectTarget below) so onCollected knows whether its handover
  // actually ran, without CollectPaymentPanel needing to report it back.
  const handedOverViaCollectRef = useRef(false);
  // Order whose long-press "manage" sheet (item / whole-order delete) is open.
  const [manageOrder, setManageOrder] = useState<TakeawayOrder | null>(null);
  const [refreshingTakeaway, setRefreshingTakeaway] = useState(false);
  // First-load flag drives the shimmer skeleton; refreshes reuse the pull spinner.
  const [isLoadingTakeaway, setIsLoadingTakeaway] = useState(true);
  const [takeawaySearchText, setTakeawaySearchText] = useState('');
  const [takeawayQrOpen, setTakeawayQrOpen] = useState(false);
  // Wide layout: which order sits in the fixed 40% side panel — same idea as
  // `tablePanel` for the table grid, but simpler, since a takeaway order needs
  // no snapshot: it's just an id, resolved against the live `takeawayOrders`
  // array on every render, so the panel updates itself as that list refreshes.
  const [selectedTakeawayId, setSelectedTakeawayId] = useState<string | null>(null);
  // The placed curtain belongs to the order it was raised for; once the crew
  // moves the selection away, it must not replay on coming back later.
  useEffect(() => {
    if (takeawayPlacedCurtainId && selectedTakeawayId !== takeawayPlacedCurtainId) setTakeawayPlacedCurtainId(null);
  }, [selectedTakeawayId, takeawayPlacedCurtainId]);
  // ── Takeaway panel: Edit quantities (− qty + ×) and Add ──
  // Same rules as the table screen: a DRAFT of target quantities until Save,
  // one reason for every removal, one new order (its own KOT) for every "+".
  // A takeaway line that is already PAID cannot be cut (that is a refund), so
  // "−" stops at the paid units.
  const [twEditing, setTwEditing] = useState(false);
  const [twDraft, setTwDraft] = useState<Record<string, number>>({});
  const [twReasonOpen, setTwReasonOpen] = useState(false);
  const [twSaving, setTwSaving] = useState(false);
  const { sheet: managerPinSheet, runWithApproval } = useManagerApproval();
  useEffect(() => { setTwEditing(false); setTwDraft({}); }, [selectedTakeawayId]);

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

  const loadTakeawayOrders = useCallback(async () => {
    try {
      const res = await crewOrders.getTakeaway();
      setTakeawayOrders(res?.data ?? []);
    } catch { /* non-fatal */ }
    finally {
      setRefreshingTakeaway(false);
      setIsLoadingTakeaway(false);
    }
  }, []);

  const handleRefreshTakeaway = () => {
    setRefreshingTakeaway(true);
    void loadTakeawayOrders();
  };

  // Crew discount on a takeaway order. Session-scoped like the table screen's,
  // so it needs the order's sessionId — absent when the app is running ahead of
  // the backend that started sending it, in which case the action stays hidden.
  const [discountOrder, setDiscountOrder] = useState<TakeawayOrder | null>(null);
  // Container charges exist mostly FOR takeaway, so the board needs the sheet
  // the table screen has.

  const isTakeawayPaid = (order: TakeawayOrder) =>
    ['PAID_CASH', 'PAID_UPI_DIRECT', 'PAID_ONLINE', 'PAID_MIXED', 'WAIVED'].includes(String(order.paymentStatus ?? '').toUpperCase());

  // "Paid", "Pending", or — once a customer added to a paid order —
  // "Paid ₹398 · Due ₹120".
  const takeawayPayLabel = (order: TakeawayOrder): string => {
    const g = groupOfTakeaway(order);
    if (isTakeawayPaid(g)) return 'Paid';
    return g.paidTotal > 0.005 && g.dueTotal > 0.005
      ? `Paid ₹${Math.round(g.paidTotal)} · Due ₹${Math.round(g.dueTotal)}`
      : 'Pending';
  };

  const isTakeawayPendingCollection = (order: TakeawayOrder) =>
    ['PENDING_STAFF_COLLECTION', 'PENDING_CASH', 'PENDING_UPI_DIRECT', 'UNPAID'].includes(String(order.paymentStatus ?? '').toUpperCase());

  // Discountable while the money is still collectible — the same states the
  // backend's session-discount service treats as COLLECTIBLE.
  const canDiscountTakeaway = (order: TakeawayOrder) =>
    !!order.sessionId && order.status !== 'SERVED' && isTakeawayPendingCollection(order);

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
    taxRate?: number | null;
    displayMode?: 'combined' | 'split';
    pricesIncludeTax?: boolean;
  } | null>(null);
  const [upiId, setUpiId] = useState<string | null>(null);
  const [upiName, setUpiName] = useState('');
  const [printTakeawayOrder, setPrintTakeawayOrder] = useState<TakeawayOrder | null>(null);
  // The grid card's own quick-print icon — a bare KOT/Invoice choice in a
  // CenteredModal, no GSTIN capture, so it stays a one-tap action from the
  // tile instead of pulling up the panel's full print sheet.
  const [quickPrintOrder, setQuickPrintOrder] = useState<TakeawayOrder | null>(null);
  // Tap-to-paper progress overlay for the manual takeaway prints; null = hidden.
  const [printJob, setPrintJob] = useState<PrintJob | null>(null);
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
          taxRate: res.data.taxConfig?.taxRate ?? null,
          displayMode: (res.data.taxConfig?.displayMode as 'combined' | 'split') ?? 'combined',
          pricesIncludeTax: res.data.taxConfig?.pricesIncludeTax ?? false,
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
    setPrintJob({ phase: 'printing', label: 'KOT' });
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
      setPrintJob({ phase: 'done', label: 'KOT' });
    } else {
      setPrintJob({
        phase: 'failed',
        label: 'KOT',
        message: 'Printer connected but print failed. Check paper / Bluetooth and try again.',
        onRetry: () => { void handlePrintTakeawayKot(order); },
      });
    }
  };

  const handlePrintTakeawayInvoice = async (order: TakeawayOrder, buyer?: InvoiceBuyer) => {
    setPrintTakeawayOrder(null);
    // No local-printer gate: a bill no longer needs one. When this device
    // drives no bill printer the request goes to the venue's, and the failure
    // path below reports the real reason (no bill printer configured, host
    // offline) instead of this device guessing from its own pairing.

    const isPaid = isTakeawayPaid(order);
    const invoiceItems: InvoiceBill['items'] = order.items.map((item) => ({
      name: item.name,
      qty: item.qty,
      unitPrice: item.unitPrice,
      modifiersSummary: item.modifiers,
    }));

    // ALWAYS refresh the branding/tax config at print time — settings changed
    // mid-shift on the dashboard must apply to the very next print, not after
    // an app restart. Offline/failure falls back to the mount-time snapshot.
    // Not awaited here: when the QR-choice sheet is shown, the refresh runs
    // behind it so choosing a QR overlaps the round-trip.
    // The takeaway's stamp card, printed as "pay to collect" before payment.
    const ladderPrep = order.sessionId
      ? loyaltyApi.balance(order.sessionId).then((r) => r?.data?.ladder ?? null).catch(() => null)
      : Promise.resolve(null);

    const prep = (async () => {
      let meta = restaurantInvoiceMeta;
      if (staffInfo?.restaurantId) {
        try {
          const res = await restaurantApi.getBranding(staffInfo.restaurantId);
          if (res?.success) {
            meta = {
              address: res.data.address ?? null,
              phone: res.data.phone ?? null,
              email: res.data.email ?? null,
              fssaiLicenseNumber: res.data.fssaiLicenseNumber ?? null,
              gstRegistered: res.data.taxConfig?.gstRegistered ?? false,
              gstin: res.data.taxConfig?.gstin ?? null,
              taxRate: res.data.taxConfig?.taxRate ?? null,
              displayMode: (res.data.taxConfig?.displayMode as 'combined' | 'split') ?? 'combined',
              pricesIncludeTax: res.data.taxConfig?.pricesIncludeTax ?? false,
            };
            setRestaurantInvoiceMeta(meta);
            if (res.data.upiId) {
              setUpiId(res.data.upiId);
              setUpiName(res.data.upiDisplayName ?? res.data.name ?? '');
            }
          }
        } catch {}
      }
      return meta;
    })();

    const runPrint = async (upiOmitAmount: boolean) => {
      // Usually resolved already (prep ran while the QR sheet was up), so the
      // preparing phase is a flash at most.
      setPrintJob({ phase: 'preparing', label: 'Invoice' });
      const [meta, liveLadder] = await Promise.all([prep, ladderPrep]);
      setPrintJob({ phase: 'printing', label: 'Invoice' });
      // Local when this device drives a bill printer, otherwise dispatched to
      // the one that does — see services/billPrint.ts.
      const outcome = await printBillFromHere({
        restaurantId: staffInfo?.restaurantId ?? '',
        sessionId: order.sessionId ?? '',
        upiOmitAmount,
        onDispatched: (printerName) => setPrintJob({ phase: 'printing', label: `Invoice → ${printerName}` }),
        bill: {
        restaurantName: staffInfo?.restaurantName ?? '',
        restaurantAddress: meta?.address ?? null,
        restaurantPhone: meta?.phone ?? null,
        restaurantEmail: meta?.email ?? null,
        fssaiLicenseNumber: meta?.fssaiLicenseNumber ?? null,
        gstRegistered: meta?.gstRegistered ?? false,
        gstin: meta?.gstin ?? null,
        buyerGstin: buyer?.gstin ?? null,
        buyerName: buyer?.name ?? null,
        tableNumber: 0,
        channel: 'TAKEAWAY',
        pickupToken: order.pickupToken ?? null,
        sessionRef: order.sessionRef ?? undefined,
        items: invoiceItems,
        subtotal: order.subtotal,
        discount: order.discount,
        charges: order.serviceCharge,
        chargeLines: order.chargeLines,
        tax: order.tax,
        taxRate: meta?.taxRate ?? undefined,
        taxDisplayMode: meta?.displayMode,
        pricesIncludeTax: meta?.pricesIncludeTax,
        // Without this the template re-derives the split from the flat `tax` at
        // 0dp, so an 18.50 GST prints as CGST 9 / SGST 10. Dine-in has always
        // passed it; takeaway did not.
        taxLines: order.taxLines,
        roundOff: order.roundOff ?? 0,
        grandTotal: order.total,
        isPaid,
        paymentMethod: order.paymentMethod ?? undefined,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        billerName: staffInfo?.name ?? null,
        liveLadder,
        upiVpa: upiId,
        upiName: upiName || null,
        upiOmitAmount,
        orderDateTime: order.createdAt,
        generatedAt: new Date().toISOString(),
        },
      });
      if (outcome.status === 'printed') {
        setPrintJob({ phase: 'done', label: 'Invoice' });
      } else {
        setPrintJob({
          phase: 'failed',
          label: 'Invoice',
          message: outcome.message
            ?? 'Could not print the invoice. Check that the printer is nearby and powered on.',
          onRetry: () => { void runPrint(upiOmitAmount); },
        });
      }
    };

    const qrWillPrint = !isPaid && !!upiId && isUpiQrEnabled();
    if (!qrWillPrint) {
      await runPrint(false);
      return;
    }
    // QR-choice sheet shown IMMEDIATELY (prep runs behind it). The chosen
    // option runs the print; dismissing the sheet cancels.
    qrRunRef.current = (omitAmount: boolean) => { void runPrint(omitAmount); };
    setQrSheet({ grandTotal: order.total });
  };

  // On the Electron desktop shell this order already has its own right-hand
  // panel (like the table's), so collecting opens the same kind of embedded
  // sheet the table panel uses — see takeawayCollectTarget below — instead of
  // pushing the phone's full-screen payment-collect.tsx.
  const [takeawayCollectTarget, setTakeawayCollectTarget] = useState<TakeawayGroup | null>(null);
  // Collects what the customer still owes: one unpaid round goes through the
  // single-order collect, several through the session collect with their ids
  // (the same path dine-in uses for a table's rounds).
  const handleCollectTakeaway = (order: TakeawayOrder) => {
    const g = groupOfTakeaway(order);
    if (g.unpaidOrders.length === 0) return;
    if (isDesktop()) {
      setTakeawayCollectTarget(g);
      return;
    }
    const single = g.unpaidOrders.length === 1 ? g.unpaidOrders[0]! : null;
    router.push({
      pathname: '/(staff)/payment-collect',
      params: {
        orderId: (single ?? g.unpaidOrders[0]!).orderId,
        sessionId: single ? '' : (g.sessionId ?? ''),
        orderIds: single ? '' : JSON.stringify(g.unpaidOrders.map((o) => o.orderId)),
        tableNumber: '',
        channel: 'TAKEAWAY',
        pickupToken: g.pickupToken ?? '',
        amount: String(g.dueTotal),
        customerName: g.customerName ?? '',
        customerPhone: g.customerPhone ?? '',
      },
    });
  };

  // Hands over EVERY round of the customer's visit, together: the server
  // closes the session on the first handover, so a round left behind could
  // never be handed over — or added to — again.
  const handleHandover = async (orderId: string) => {
    const g = takeawayGroups.find((x) => x.orders.some((o) => o.orderId === orderId));
    const ids = g ? g.orders.filter((o) => o.status !== 'SERVED').map((o) => o.orderId) : [orderId];
    setHandingOverIds((prev) => [...prev, orderId]);
    try {
      for (const id of ids) await crewOrders.handoverTakeaway(id);
      setTakeawayOrders((prev) =>
        prev.map((o) => (ids.includes(o.orderId) ? { ...o, status: 'SERVED' } : o)),
      );
      if (selectedTakeawayId && (selectedTakeawayId === orderId || ids.includes(selectedTakeawayId))) setHandoverCurtainId(orderId);
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
    if (code === 'AUTHORIZATION_REQUIRED')
      return 'The bill for this order is already printed. Ask a manager to remove it.';
    return (typeof err?.message === 'string' && err.message) || 'Something went wrong. Please try again.';
  };

  // Long-press a takeaway card to open the manage sheet (item / whole-order
  // delete). Only offered on orders that are still deletable.
  const openTakeawayManage = (order: TakeawayOrder) => {
    // Several rounds: the panel's Edit handles them (it knows which lines are
    // already paid). The sheet below deletes one order's lines by id.
    if (groupOfTakeaway(order).orders.length > 1) { setSelectedTakeawayId(order.orderId); return; }
    if (!canDeleteTakeaway(order)) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setManageOrder(order);
  };

  // Thin persistence callbacks handed to the sheet. They talk to the API and
  // reconcile local state; the sheet owns the delete animation + error display,
  // so these just resolve on success and re-throw on failure.
  const deleteTakeawayItem = async (orderId: string, itemId: string, reason: CancelReason) => {
    await crewOrders.cancelItem(orderId, itemId, reason);
    void loadTakeawayOrders();
  };

  // Whole-order delete mirrors the table sheet's "Free table": close the manage
  // sheet, then confirm — and capture why — in the reason sheet. This used to be
  // a plain ThemedDialog; it needs the reason now that whole-order deletes land
  // on the adjustments ledger alongside item cancels.
  const [deleteWholeTarget, setDeleteWholeTarget] = useState<TakeawayOrder | null>(null);
  const [deletingWhole, setDeletingWhole] = useState(false);

  const requestDeleteWholeTakeaway = () => {
    const o = manageOrder;
    setManageOrder(null);
    if (!o) return;
    // Let the manage sheet finish closing first, or the two backdrops overlap.
    setTimeout(() => setDeleteWholeTarget(o), 220);
  };

  const confirmDeleteWholeTakeaway = async (reason: CancelReason) => {
    const o = deleteWholeTarget;
    if (!o || deletingWhole) return;
    setDeletingWhole(true);
    try {
      await crewOrders.cancelOrder(o.orderId, reason);
      setTakeawayOrders((prev) => prev.filter((x) => x.orderId !== o.orderId));
      setDeleteWholeTarget(null);
    } catch (err: any) {
      setDeleteWholeTarget(null);
      showDialog('Could not delete', takeawayCancelMessage(err), [{ label: 'OK', onPress: () => {} }]);
      void loadTakeawayOrders();
    } finally {
      setDeletingWhole(false);
    }
  };

  // KOT auto-print toggle — loaded from server and retained in a ref so
  // realtime callbacks always see the current value without forcing renders.
  const kotAutoPrintRef = useRef(true);
  const setKotAutoPrintSync = useCallback((v: boolean) => {
    kotAutoPrintRef.current = v;
    setSinkContext({ autoPrint: v }); // keep the background FGS gate in sync
  }, []);

  // Sync the KOT auto-print toggle from the server. Auto-print itself gates on
  // the *live* local printer connection (getPrinterStatus), never on staff
  // identity — the Bluetooth pairing is the real single-sink guarantee, so any
  // crew member on the paired device drives printing. Default toggle stays true
  // so a transient status-fetch failure never silently disables printing.
  const refreshPrintSinkOwnership = useCallback(async () => {
    try {
      const res = await printerApi.getStatus();
      if (typeof res?.data?.kotAutoPrint === 'boolean') {
        setKotAutoPrintSync(res.data.kotAutoPrint);
      }
    } catch { /* keep last known toggle value */ }
  }, [setKotAutoPrintSync]);

  // ── KOT print backstop (server pull-queue) ──────────────────────────────────
  // The live Ably `new_order` push is the fast path, but it only fires while the
  // app is foregrounded and the socket is healthy. The SHARED drain in
  // printSink.ts (also used by the cook screen + FGS) is the guarantee: it
  // flushes the ack outbox, pulls the server queue (first prints + durable
  // reprints) with this device's sink identity, and prints anything that
  // slipped through. The auto-print toggle reaches it via setSinkContext.

  // `nextQty` is the ABSOLUTE served count the line should stand at — one tap
  // sends servedQty + 1, a hold sends the full qty. The card only celebrates
  // once every unit of every line is out.
  const togglePickupItem = (orderId: string, itemId: string, nextQty: number) => {
    Haptics.selectionAsync().catch(() => {});

    // Optimistic update — advance the line immediately. If that finished the
    // last outstanding unit, flag the card as "completing" so PickupCard runs
    // its calm in-place celebration. completedAt stays unset during the
    // celebration; handleCompletionFinished sets it (as ISO) when the
    // animation finishes, which is what moves the card to the Completed list.
    let triggersCompletion = false;
    let previousQty = 0;
    setPickupOrders((prev) =>
      prev.map((order) => {
        if (order.id !== orderId) return order;
        const items = order.items.map((it) => {
          if (it.id !== itemId) return it;
          previousQty = it.servedQty;
          const servedQty = Math.max(0, Math.min(it.qty, nextQty));
          return { ...it, servedQty, isServed: servedQty >= it.qty };
        });
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
      .serveItem(orderId, itemId, nextQty)
      .catch(() => {
        // Revert on failure
        setPickupOrders((prev) =>
          prev.map((o) =>
            o.id !== orderId ? o : {
              ...o,
              items: o.items.map((it) =>
                it.id === itemId
                  ? { ...it, servedQty: previousQty, isServed: previousQty >= it.qty }
                  : it,
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

  /**
   * The floor split into seating-zone sections, in the order the partner set
   * on the dashboard, with unassigned tables last.
   *
   * A restaurant that hasn't created any zones gets a single unnamed section
   * holding every table — i.e. the grid a steward sees today, unchanged. The
   * headers only appear once there is a real zone to name, so this can't
   * disturb the four pilots who don't use zones.
   *
   * Empty sections are dropped so filtering to "occupied" doesn't leave a
   * column of bare headers behind.
   */
  const zoneSections = useMemo(() => {
    const hasZones = filteredTables.some((t) => !!t.zoneId);
    if (!hasZones) return [{ key: 'all', name: null as string | null, tables: filteredTables }];

    const byZone = new Map<string, { name: string; sortOrder: number; tables: Table[] }>();
    const unassigned: Table[] = [];

    for (const t of filteredTables) {
      if (!t.zoneId) { unassigned.push(t); continue; }
      const existing = byZone.get(t.zoneId);
      if (existing) existing.tables.push(t);
      else byZone.set(t.zoneId, {
        name: t.zoneName ?? 'Zone',
        sortOrder: t.zoneSortOrder ?? 0,
        tables: [t],
      });
    }

    const sections = [...byZone.entries()]
      // sortOrder is the partner's chosen order; name breaks ties so the
      // grid never reshuffles between refreshes.
      .sort((a, b) => a[1].sortOrder - b[1].sortOrder || a[1].name.localeCompare(b[1].name))
      .map(([id, z]) => ({ key: id, name: z.name as string | null, tables: z.tables }));

    if (unassigned.length > 0) {
      sections.push({ key: '__unassigned__', name: 'Unassigned', tables: unassigned });
    }
    return sections;
  }, [filteredTables]);

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

  const loadTables = useCallback(async () => {
    try {
      const res = await crewTables.list() as any;
      // bill_total ships on /crew/tables itself now — no per-table /bill
      // fallback (that was an N+1: a 12-table floor cost 13 queries per load).
      const apiTables: Table[] = (res?.tables ?? []).map((t: any) => {
        const groups: TableGroup[] | undefined = Array.isArray(t.groups) && t.groups.length > 0 ? t.groups : undefined;
        // Multi-group tables show the combined floor total on the card;
        // per-group totals live in the picker.
        const billAmount = groups && groups.length > 1
          ? groups.reduce((sum: number, g: any) => sum + (Number(g.bill_total) || 0), 0)
          : typeof t.bill_total === 'number' ? t.bill_total : undefined;

        return {
          groups,
          maxParties: typeof t.max_parties === 'number' ? t.max_parties : 1,
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
          zoneId: t.zone_id ?? null,
          zoneName: t.zone_name ?? null,
          zoneSortOrder: typeof t.zone_sort_order === 'number' ? t.zone_sort_order : null,
          // `location` is what the search box already matches on, so pointing
          // it at the zone name makes "rooftop" a working search term for free.
          location: t.zone_name ?? undefined,
          sessionId: t.session_id ?? undefined,
          customerName: t.customer_name ?? null,
          customerPhone: t.customer_phone ?? null,
          itemsServed: typeof t.items_served === 'number' ? t.items_served : undefined,
          itemsTotal: typeof t.items_total === 'number' ? t.items_total : undefined,
          paymentSettled: t.payment_settled === true,
          billPrintedUnpaid: (groups ?? [{ bill_printed: t.bill_printed, payment_settled: t.payment_settled }])
            .some((g) => g.bill_printed === true && g.payment_settled !== true),
          billAmount,
        };
      });
      apiTables.sort((a: Table, b: Table) => a.number - b.number);
      setTables(apiTables);
    } catch (e) {
      console.error('[tables] loadTables error:', e);
    } finally {
      setIsLoadingTables(false);
    }
  }, []);

  const loadMenuFromApi = useCallback(async () => {
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
            unavailableUntil: item.unavailableUntil ?? null,
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
          const catNames: string[] = categories.map((c: any) => c.name).filter(Boolean);
          setMenuCategories(['All', ...catNames]);
          // Land on the first category, not "All". A 435-item menu rendered every
          // row into a plain ScrollView (no virtualisation), which is what made
          // this tab crawl. "All" is still one tap away for anyone who wants it.
          setMenuFilter(prev => (prev === 'All' && catNames.length > 0 ? catNames[0]! : prev));
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
  }, [staffInfo?.restaurantId]);

  const loadPickupOrders = useCallback(async () => {
    try {
      const res = await crewOrders.getActive();
      const allOrders = res.orders ?? [];

      // Simplified flow: show any order that has unserved items, regardless of
      // order status. Serving is always open — no kitchen pipeline gate.
      // Takeaway and delivery each have their own surface — keep this list
      // dine-in only. Before this used `!== 'TAKEAWAY'`, which let delivery
      // orders in and rendered them as "Tnull".
      const serveableOrders = allOrders.filter(o =>
        !isOffPremise(o.channel) && o.items.some(i => !i.served)
      );

      // Notify staff the moment a brand-new order lands on the floor — they
      // no longer need to wait for kitchen to flip status to READY.
      const prevOrderIds = pickupOrderIdsRef.current;
      const newOrders = serveableOrders.filter(o => !prevOrderIds.has(o.order_id));
      if (newOrders.length > 0) {
        void playSound(require('../../assets/audio/notifications/waiter notification.mp3'));
        Notifications.scheduleNotificationAsync({
          content: {
            title: '🔔 New Order',
            body: newOrders.map(o => channelLocationLabel(o.channel, { token: o.pickup_token ?? 'TK', tableNumber: o.table_number })).join(', ') + ' — ready to serve',
            sound: true,
          },
          trigger: null,
        }).catch(() => { });
      }

      // DUAL_CHANNEL only: detect items the kitchen just flipped done (and not
      // yet served) by diffing item_status against the previous snapshot, then
      // drop a coalesced-per-table "ready" card + distinct chime + haptic. The
      // first load only seeds the snapshot (no burst of chimes on app open).
      if (dualChannelRef.current) {
        const prevStatus = prevItemStatusRef.current;
        const readyByTable = new Map<number, number>();
        // Nav params to open each table on tap — captured now (session_id off the
        // order, table DB id off the tables mirror) so the card, rendered up at
        // the layout, can navigate without the floor screen's local state.
        const navByTable = new Map<number, ReadyNav>();
        for (const o of serveableOrders) {
          if (isOffPremise(o.channel) || o.table_number == null) continue;
          for (const it of o.items) {
            if (it.item_status === 'done' && !it.served && prevStatus.get(it.item_id) === 'pending') {
              readyByTable.set(o.table_number, (readyByTable.get(o.table_number) ?? 0) + 1);
              navByTable.set(o.table_number, {
                sessionId: o.session_id ?? null,
                tableDbId: tablesRef.current.find(tb => tb.number === o.table_number)?.id ?? null,
              });
            }
          }
        }

        // Snapshot every item's status (across all orders) for the next diff.
        const nextStatus = new Map<string, 'pending' | 'done'>();
        for (const o of allOrders) for (const it of o.items) nextStatus.set(it.item_id, it.item_status);
        prevItemStatusRef.current = nextStatus;

        // Tables that still have something to serve — used to prune stale cards
        // once a table has been fully served or its session closed elsewhere.
        const activeTables = new Set(serveableOrders.map(o => o.table_number));

        if (pickupSeededRef.current && readyByTable.size > 0) {
          void playSound(require('../../assets/audio/notifications/item-ready.wav'));
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          addReady(readyByTable, navByTable, activeTables);
        } else {
          // No new ready items — drop any card whose table is no longer active.
          pruneToActive(activeTables);
        }
        pickupSeededRef.current = true;
      }

      const refreshedActive = serveableOrders.map(order => ({
        id: order.order_id,
        tableNo: channelLocationLabel(order.channel, { token: order.pickup_token ?? 'TK', tableNumber: order.table_number }),
        items: order.items.map(item => ({
          id: item.item_id,
          // Bare name — PickupItemRow renders the quantity in its own column, so
          // prefixing it here printed every line twice ("4× 4× Coffee").
          name: item.name,
          qty: item.qty,
          // Fall back for a backend that predates partial ticking.
          servedQty: item.served_qty ?? (item.served ? item.qty : 0),
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

      pickupOrderIdsRef.current = new Set(refreshedActive.map(order => order.id));
      setPickupOrders(refreshedActive);
    } catch (e) { console.error('[pickup] loadPickupOrders error:', e); }
  }, []);

  // Completed tab source of truth: backend paginated list (last 24h served).
  const loadServedToday = useCallback(async (page = 1) => {
    try {
      const res = await crewOrders.getServedToday(page, 30);
      // Takeaway has its own dedicated tab — keep this list dine-in only.
      const served = (res.orders ?? []).filter((o: any) => !isOffPremise(o.channel));
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
  }, []);

  const loadMoreCompletedOrders = async () => {
    if (isLoadingMoreCompleted || !completedHasMore) return;
    setIsLoadingMoreCompleted(true);
    try {
      await loadServedToday(completedPage + 1);
    } finally {
      setIsLoadingMoreCompleted(false);
    }
  };

  const loadPendingCashCount = useCallback(async () => {
    try {
      const data = await crewPayments.getCashRequests();
      setPendingCashCount(data.pending.length);
    } catch { /* non-fatal — Ably will keep the count fresh */ }
  }, []);

  // Load once on mount — Ably drives all subsequent updates
  useEffect(() => {
    void loadTables();
    void loadMenuFromApi();
    void loadPickupOrders();
    void loadServedToday();
    void loadPendingCashCount();
    void refreshPrintSinkOwnership();
  }, [
    staffInfo?.restaurantId,
    loadTables,
    loadMenuFromApi,
    loadPickupOrders,
    loadServedToday,
    loadPendingCashCount,
    refreshPrintSinkOwnership,
  ]);

  // Learn whether this venue runs the DUAL_CHANNEL flow (kitchen marks items
  // done → staff serve). Only then do we surface "item ready" toast cards; a
  // SIMPLE venue behaves exactly as before. Held in a ref so loadPickupOrders'
  // stable callback can read it without re-arming.
  useEffect(() => {
    const restaurantId = staffInfo?.restaurantId;
    if (!restaurantId) return;
    let cancelled = false;
    restaurantApi.getBranding(restaurantId)
      .then((res) => {
        if (cancelled || !res?.success) return;
        dualChannelRef.current = (res.data.dinerStatusMode ?? 'SIMPLE') === 'DUAL_CHANNEL';
      })
      .catch(() => { /* non-fatal — stays SIMPLE, no toasts */ });
    return () => { cancelled = true; };
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
  }, [staffInfo?.restaurantId, refreshPrintSinkOwnership]);

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

  // Immediately refresh pickup orders when switching to Orders tab
  useEffect(() => {
    if (activeTab === 'orders') void loadPickupOrders();
    if (activeTab === 'takeaway') void loadTakeawayOrders();
  }, [activeTab, loadPickupOrders, loadTakeawayOrders]);

  // Coming back from the adjust-bill screen: it re-prices server-side and the
  // push events that keep this list fresh don't cover a charge or tip edit, so
  // the takeaway card would still show the old total.
  useFocusEffect(
    useCallback(() => {
      if (activeTab === 'takeaway') void loadTakeawayOrders();
    }, [activeTab, loadTakeawayOrders]),
  );

  // On phone, Adjust bill is a pushed screen: a form of number fields with
  // the keyboard up, popping back into the focus refetch above. On the
  // Electron desktop shell it opens embedded in this order's own panel
  // instead — the same move [tableId].tsx's "Bill" rail button makes with
  // AdjustBillForm (see its doc comment: "the desktop table panel puts it in
  // a BottomSheet beside the ticket").
  const [takeawayAdjustTarget, setTakeawayAdjustTarget] = useState<TakeawayOrder | null>(null);
  const openAdjustBill = (order: TakeawayOrder) => {
    if (!order.sessionId) return;
    if (isDesktop()) {
      setTakeawayAdjustTarget(order);
      return;
    }
    router.push({
      pathname: '/(staff)/adjust-bill',
      params: {
        sessionId: order.sessionId,
        subtitle: order.pickupToken ? `Order ${order.pickupToken}` : 'This order',
        total: String(order.total ?? 0),
      },
    });
  };

  // Takeaway list stays fresh via the waiter:{restaurantId} Ably push below
  // (new_order / cash events call loadTakeawayOrders) plus the tab-switch load
  // above — no polling needed.

  // Ably: waiter:{restaurantId} — pure push, no polling
  useEffect(() => {
    const restaurantId = staffInfo?.restaurantId;
    if (!restaurantId) return;

    // One kitchen/payment action fans out into several events, and every open
    // crew device refetches on each — a trailing debounce collapses each burst
    // into a single request per list. Sounds/haptics/prints stay immediate.
    const timers: Record<string, ReturnType<typeof setTimeout>> = {};
    const debounced = (key: string, fn: () => void, ms = 300) => () => {
      if (timers[key]) clearTimeout(timers[key]);
      timers[key] = setTimeout(() => { delete timers[key]; fn(); }, ms);
    };
    const refetchTables    = debounced('tables',   () => void loadTables());
    const refetchPickup    = debounced('pickup',   () => void loadPickupOrders());
    const refetchTakeaway  = debounced('takeaway', () => void loadTakeawayOrders());
    const refetchServed    = debounced('served',   () => void loadServedToday(1));

    let lastReadyId: string | null = null;

    const off1 = subscribeChannel(`waiter:${restaurantId}`, 'order_ready', (data: any) => {
      const orderId = data?.orderId as string | undefined;
      if (!orderId || orderId === lastReadyId) return;
      lastReadyId = orderId;
      void playSound(require('../../assets/audio/notifications/waiter notification.mp3'));
      refetchPickup();
      refetchTables();
    });

    const off2 = subscribeChannel(`waiter:${restaurantId}`, 'order_served', (data: any) => {
      refetchPickup();
      refetchServed();
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
        refetchTables();
      }
    });

    const off3 = subscribeChannel(`waiter:${restaurantId}`, 'new_order', (data: any) => {
      refetchPickup();
      if (data?.channel === 'TAKEAWAY') refetchTakeaway();
      refetchTables();
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
          tableNumber: `${String(data.tableNumber ?? '?')}${data.partyGroupLabel ? ` · ${data.partyGroupLabel}` : ''}`,
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
      refetchPickup();
      refetchTables();
    });

    const off5 = subscribeChannel(`waiter:${restaurantId}`, 'session_started', () => {
      refetchTables();
    });

    const off6 = subscribeChannel(`waiter:${restaurantId}`, 'payment_confirmed', () => {
      refetchTables();
    });

    // Table status flipped (offline/online/reserved/available) from another
    // device — refresh the grid so this device matches.
    const off6a = subscribeChannel(`waiter:${restaurantId}`, 'table_offline', () => {
      refetchTables();
    });
    const off6b = subscribeChannel(`waiter:${restaurantId}`, 'table_online', () => {
      refetchTables();
    });
    // Session swap from another device — both source + target need re-render.
    const off6c = subscribeChannel(`waiter:${restaurantId}`, 'session_moved', () => {
      refetchTables();
    });
    // Two tables merged into one bill from another device — the absorbed table
    // is now free and the survivor's bill grew, so re-render the grid.
    const off6d = subscribeChannel(`waiter:${restaurantId}`, 'session_merged', () => {
      refetchTables();
    });
    // A bill was printed on some phone (or the dashboard) — the card marks it.
    const off6e = subscribeChannel(`waiter:${restaurantId}`, 'bill_printed', () => {
      refetchTables();
    });

    const off7 = subscribeChannel(`waiter:${restaurantId}`, 'item_bumped', () => {
      refetchPickup();
      refetchTakeaway(); // takeaway tab: keep status live now that the 10s poll is gone
    });

    // Per-item ready: drives a refetch the moment the cook flips a single item.
    // The sound + notification are emitted by loadPickupOrders' own diff so
    // the same UX fires whether the realtime event or a manual refresh
    // surfaces a newly-ready item.
    const off7b = subscribeChannel(`waiter:${restaurantId}`, 'item_ready', () => {
      refetchPickup();
      refetchTakeaway(); // takeaway tab: keep status live now that the 10s poll is gone
    });

    // Every serve tick, partial ones included. order_served only fires once a
    // whole order is out, so without this a second steward's device would sit
    // on a stale "0 of 4" until someone pulled to refresh.
    const off7c = subscribeChannel(`waiter:${restaurantId}`, 'item_served', () => {
      refetchPickup();
    });

    const off8 = subscribeChannel(`waiter:${restaurantId}`, 'cash_collection_requested', (data: any) => {
      const tableNumber = data?.tableNumber as number | undefined;
      const amount = data?.amount as number | undefined;
      setPendingCashCount(c => c + 1);
      if (data?.channel === 'TAKEAWAY') refetchTakeaway();
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
        },
        trigger: null,
      }).catch(() => { });
      refetchTables();
    });

    // When any waiter (this one or another) marks an order collected,
    // decrement the badge so it stays accurate across multiple devices, and
    // refresh the grid so the table card's "paid" icon lights up live.
    const off9 = subscribeChannel(`waiter:${restaurantId}`, 'cash_payment_collected', () => {
      setPendingCashCount(c => Math.max(0, c - 1));
      refetchTakeaway();
      refetchTables();
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
          tableNumber: `${String(data.order.tableNumber ?? '?')}${data.order.partyGroupLabel ? ` · ${data.order.partyGroupLabel}` : ''}`,
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
    //
    // Registry-managed printers are exempt: these two events come from the
    // legacy /print/pair route, where "someone else paired" genuinely meant
    // "you are no longer the sink". Under the registry a device can hold the
    // counter printer while another holds the kitchen one, and standing down on
    // a legacy pairing would silently wipe a correct setup.
    const offPrinterPaired = subscribeChannel(`partner:${restaurantId}`, 'printer_paired', (data: any) => {
      void (async () => {
        if (getPrinterStatus() !== 'connected') return; // we don't hold a pairing
        if (getPrinters().some((p) => p.id)) return;    // registry-managed
        const myDeviceId = await getPrintDeviceId();
        if (data?.deviceId !== myDeviceId) await handleSinkSuperseded();
      })();
    });
    const offPrinterUnpaired = subscribeChannel(`partner:${restaurantId}`, 'printer_unpaired', () => {
      if (getPrinterStatus() !== 'connected') return;
      if (getPrinters().some((p) => p.id)) return;
      void handleSinkSuperseded();
    });

    // Registry changes + bills dispatched to a printer we drive. One shared
    // implementation (see printSink.watchPrintDispatch) so the two dashboards
    // cannot drift apart.
    const offDispatch = watchPrintDispatch(restaurantId);

    return () => {
      Object.values(timers).forEach(clearTimeout);
      off1(); off2(); off3(); off4(); off5(); off6(); off6a(); off6b(); off6c(); off6d(); off6e(); off7(); off7b(); off7c(); off8(); off9(); offReprint(); offAutoPrint(); offPrinterPaired(); offPrinterUnpaired();
      offDispatch();
    };
  }, [
    staffInfo?.restaurantId,
    staffInfo?.restaurantName,
    loadTables,
    loadPickupOrders,
    loadTakeawayOrders,
    loadServedToday,
    setKotAutoPrintSync,
  ]);

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

  // ── Freeing (optimistic + Undo) ─────────────────────────────────────────────
  // Every free path below flips the grid immediately, hits the backend, and
  // raises a single Undo snackbar carrying the closed sessions. Undo replays
  // them to /reopen. Uncollected money always moves to Outstanding server-side.

  // Free EVERY party on a table in one tap. Used by the manage sheet and the
  // group picker's "Free whole table". Every free path — single,
  // group, and batch — raises the same sleek bottom Undo snackbar; a center
  // modal stole the whole screen mid-rush, so it's gone.
  const freeWholeTable = async (table: { id: string; number: number }) => {
    setTables(prev => prev.map(t =>
      t.id === table.id ? { ...t, status: 'available' as TableStatus, sessionId: undefined, groups: undefined } : t));
    try {
      const res = await crewTables.free(table.id);
      const sessions = res.data.closed_sessions ?? [];
      if (sessions.length > 0) {
        setUndo({ message: `Table T${String(table.number).padStart(2, '0')} cleared`, sessions });
      }
    } catch {
      // ignore — resync below regardless
    } finally {
      void loadTables();
    }
  };

  // Free a single party from a shared table. The single-session end route
  // doesn't return a reopen descriptor, so we build one locally from the group.
  const freeOneGroup = async (table: Table, group: TableGroup) => {
    const remaining = (table.groups ?? []).filter(g => g.session_id !== group.session_id);
    setTables(prev => prev.map(t => {
      if (t.id !== table.id) return t;
      if (remaining.length === 0) return { ...t, status: 'available' as TableStatus, sessionId: undefined, groups: undefined };
      return { ...t, groups: remaining, billAmount: remaining.reduce((s, g) => s + (Number(g.bill_total) || 0), 0) };
    }));
    const info: ClosedSessionInfo = {
      session_id: group.session_id,
      session_ref: '',
      party_slot: group.party_slot,
      prior_status: group.payment_settled ? 'PAID' : 'ACTIVE',
      table_id: table.id,
    };
    try {
      await crewSessions.end(group.session_id);
      setUndo({ message: `${group.label} · T${String(table.number).padStart(2, '0')} freed`, sessions: [info] });
    } catch {
      // ignore
    } finally {
      void loadTables();
    }
  };

  // Shared reopen — revive closed sessions and surface any per-table failure
  // (a fresh party took the slot, or the window lapsed). Returns nothing; the
  // callers own their busy flag + which affordance to clear.
  const reopenAndReport = async (sessions: ClosedSessionInfo[]) => {
    const res = await crewTables.reopen(sessions);
    const failed = (res.data.tables ?? []).filter(t => !t.reopened);
    if (failed.length > 0) {
      const reoccupied = failed.some(f => f.error === 'TABLE_REOCCUPIED');
      showDialog(
        'Couldn’t undo',
        reoccupied
          ? 'A new group was already seated there, so that table can’t be restored.'
          : 'The undo window has passed.',
        [{ label: 'OK', onPress: () => {} }],
      );
    }
  };

  // Undo from the snackbar (group + batch frees).
  const undoLastFree = async () => {
    if (!undo || undoBusy) return;
    setUndoBusy(true);
    try {
      await reopenAndReport(undo.sessions);
    } catch {
      showDialog('Couldn’t undo', 'Please try again.', [{ label: 'OK', onPress: () => {} }]);
    } finally {
      setUndo(null);
      setUndoBusy(false);
      void loadTables();
    }
  };

  // Drop a card from the in-card sweep set once its ClearFlash finishes.
  const removeFreedId = useCallback((id: string) => {
    setRecentlyFreedIds(prev => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  // ── End-of-service multi-select ─────────────────────────────────────────────
  const exitSelectMode = () => { setSelectMode(false); setSelectedIds(new Set()); };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const freeSelectedTables = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) { exitSelectMode(); return; }
    // In-card sweep on every cleared card (the batch counterpart to the overlay).
    setRecentlyFreedIds(new Set(ids));
    setTables(prev => prev.map(t =>
      selectedIds.has(t.id) ? { ...t, status: 'available' as TableStatus, sessionId: undefined, groups: undefined } : t));
    exitSelectMode();
    try {
      const res = await crewTables.freeBatch(ids);
      const sessions = res.data.closed_sessions ?? [];
      const freed = res.data.freed_count ?? 0;
      if (sessions.length > 0) {
        setUndo({ message: `${freed} table${freed === 1 ? '' : 's'} freed`, sessions });
      }
    } catch {
      // ignore
    } finally {
      void loadTables();
    }
  };

  // Toggle a menu item's availability. Persists server-side (same endpoint
  // effect as the partner dashboard) so the item leaves the diner menu.
  //
  // `backAt` makes the 86 temporary — the item returns on its own — which is the
  // difference between "we're out of paneer tonight" and a dish quietly missing
  // from the menu for a week because nobody remembered to switch it back.
  const toggleMenuItemAvailability = async (itemId: string, next: boolean, backAt?: string | null) => {
    const until = next ? null : (backAt ?? null);
    const before = menuData.find(m => m.id === itemId);
    setMenuData(prev => prev.map(m => m.id === itemId ? { ...m, available: next, unavailableUntil: until } : m)); // optimistic
    try {
      await crewMenu.setAvailability(itemId, next, until);
      // Drop the order-menu screen's cached copy so the 86 shows on next open.
      invalidateCache('crew-order-menu:');
    } catch {
      // Revert on failure so the UI never lies about the real state.
      setMenuData(prev => prev.map(m => m.id === itemId
        ? { ...m, available: !next, unavailableUntil: before?.unavailableUntil ?? null }
        : m));
    }
  };

  // Turning an item OFF asks when it should come back; turning it ON is
  // immediate (and clears any pending return).
  const onToggleMenuItemPress = (item: MenuRow) => {
    if (item.available) setEightySixTarget(item);
    else void toggleMenuItemAvailability(item.id, true);
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
      invalidateCache('crew-order-menu:');
    } catch {
      setOptionState(itemId, optionId, !next); // revert
    }
  };

  // Tapping a free table calls this directly (see handleTablePress) — no
  // confirm step. StartSessionOverlay shows the "timer sweep" progress while
  // the create-session call is in flight; navigation is deferred until the
  // overlay's success animation has actually played (see onDismissStartSession),
  // so the checkmark is never cut short by the screen changing under it.
  const startSessionForTable = async (table: Table) => {
    const tableLabel = `T${String(table.number).padStart(2, '0')}`;
    setStartSessionJob({ phase: 'starting', tableLabel });
    try {
      const res = await crewSessions.start(table.id);
      void loadTables();
      pendingSessionNav.current = {
        pathname: '/(staff)/[tableId]',
        params: {
          tableId: String(table.number),
          sessionId: res.session_id,
          tableDbId: table.id,
          zoneName: table.zoneName ?? '',
        },
      };
      setStartSessionJob({ phase: 'done', tableLabel });
    } catch (e: any) {
      setStartSessionJob({
        phase: 'failed',
        tableLabel,
        message: e?.message ?? 'Could not start session. Try again.',
        onRetry: () => { void startSessionForTable(table); },
      });
    }
  };

  // Desktop: open a free table straight into the order menu. The session is
  // created in the background (services/tableSessionStart.ts) and the menu picks
  // its id up when it lands — no overlay, no waiting on the POST, no table
  // screen in between. A failure shows on the menu with a Retry; back out at any
  // point and the grid refreshes itself (focus + the session_started event).
  const lastOpenAt = useRef(0);
  const openTableToOrder = (table: Table) => {
    // A double tap must not push two menus. (A second start for the same table
    // is already refused by the store; this stops the second navigation.)
    const now = Date.now();
    if (now - lastOpenAt.current < 800) return;
    lastOpenAt.current = now;

    if (!isTableSessionStarting(table.id)) {
      void startTableSession(table.id, { onSettled: () => { void loadTables(); } }).catch(() => {});
    }
    // Select this table into the panel before leaving — order-menu's own
    // `isWide` path just pops back (router.back()) rather than replacing,
    // trusting the panel to already be pointed here. That's only true when
    // this was reached via the panel's own "Take order" CTA on an already-
    // selected table; the grid card's quick '+' action calls this directly
    // without selecting first, which used to pop back to whatever (or
    // nothing) was previously shown instead of this table.
    if (isWide) setTablePanel({ status: 'available', table });
    router.push({
      pathname: '/(staff)/order-menu',
      params: {
        tableId: String(table.number),
        tableDbId: table.id,
        pendingStart: '1',
        zoneName: table.zoneName ?? '',
      },
    });
  };

  const onDismissStartSession = () => {
    const nav = pendingSessionNav.current;
    pendingSessionNav.current = null;
    setStartSessionJob(null);
    if (nav) router.push(nav);
  };

  // '+' opens the order menu at once, the same instant-nav the table grid
  // uses (openTableToOrder): the create-session POST runs in the background
  // (services/takeawaySessionStart.ts) and the menu picks its id up when it
  // lands — no spinner, no waiting on the POST. No name/phone prompt here
  // either — the order-menu guest CRM row collects that right before placing.
  //
  // The session this starts carries no pickup token yet — see
  // takeaway.routes.ts — so a tap that opens the menu and never places
  // anything never shows up as a skipped TK number. The token is minted the
  // moment an order actually lands (crew/orders.service.ts's placeOrder).
  const lastTakeawayOpenAt = useRef(0);
  const startTakeawayOrder = () => {
    const now = Date.now();
    if (now - lastTakeawayOpenAt.current < 800) return;
    lastTakeawayOpenAt.current = now;

    startTakeawaySession().catch(() => {});
    router.push({
      pathname: '/(staff)/order-menu',
      params: {
        channel: 'TAKEAWAY',
        pendingStart: '1',
      },
    });
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

  // Manage-sheet → Free: close the sheet and free the whole table immediately.
  // No confirm dialog — the Undo snackbar is the safety net. Frees every party
  // on a shared table in one go.
  const onPressFreeFromManage = () => {
    const t = manageTable;
    setManageTable(null);
    if (!t) return;
    void freeWholeTable({ id: t.id, number: t.number });
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

  // Desktop opens a free table straight into the order menu, which paints from
  // this cache and refreshes behind it. Warm it now so even the first tap of the
  // day shows the menu instantly instead of a skeleton.
  useEffect(() => {
    const rid = staffInfo?.restaurantId;
    if (!rid || !isDesktop()) return;
    restaurantApi.getMenu(rid, 'CREW')
      .then((res) => {
        const cats = (res as any)?.data;
        if (Array.isArray(cats)) writeCache(cacheKeys.crewOrderMenu(rid, 'CREW'), cats);
      })
      .catch(() => {});
  }, [staffInfo?.restaurantId]);

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
      // Wide layout: a free table selects into the side panel, which shows a
      // placeholder with its own "take order" CTA (openTableToOrder) — no
      // navigation on the tap itself. Desktop-but-narrow and phone keep going
      // straight to the menu / the start-session overlay respectively.
      if (isWide) { setTablePanel({ status: 'available', table }); return; }
      if (isDesktop()) openTableToOrder(table);
      else void startSessionForTable(table);
    } else {
      const table = tables.find(t => t.number === tableNum);
      if (!table) return;

      // Shared seating: several parties on one table → bottom sheet asks
      // which group's bill to open (plus "seat new group" while under the
      // cap). A single party at a shared-seating restaurant still gets the
      // sheet so crew can seat a second group; everyone else goes straight
      // through. Fallback: if groups[] is missing (older cached /tables
      // response) but the table has a session, synthesize one entry from the
      // legacy fields so the sheet still works.
      const groups: TableGroup[] = (table.groups && table.groups.length > 0)
        ? table.groups
        : table.sessionId
          ? [{
              session_id: table.sessionId,
              party_slot: 1,
              label: 'G1',
              occupied_since: table.occupiedSince ?? null,
              expires_at: table.expiresAt ?? null,
              customer_name: table.customerName ?? null,
              customer_phone: table.customerPhone ?? null,
              bill_total: table.billAmount,
              items_total: table.itemsTotal,
              payment_settled: table.paymentSettled,
            }]
          : [];
      const maxParties = table.maxParties ?? 1;
      const canAddParty = maxParties > 1 && groups.length >= 1 && groups.length < maxParties;
      if (groups.length > 1 || canAddParty) {
        setGroupPicker({ table, groups, canAddParty });
        return;
      }

      openGroupForTable(table, groups[0]);
    }
  };

  // Shared seating: open one party's bill — the side panel on wide layouts,
  // the table-detail screen everywhere else.
  const openGroupForTable = (table: Table, g?: TableGroup, opts?: { forceLabel?: boolean; autoOpenPrint?: boolean }) => {
    const fields = {
      tableId: String(table.number),
      sessionId: g?.session_id ?? table.sessionId ?? '',
      tableDbId: table.id ?? '',
      occupiedSince: (g?.occupied_since ?? table.occupiedSince) ?? '',
      expiresAt: (g?.expires_at ?? table.expiresAt) ?? '',
      customerName: (g?.customer_name ?? table.customerName) ?? '',
      customerPhone: (g?.customer_phone ?? table.customerPhone) ?? '',
      groupLabel: g && (opts?.forceLabel || (table.groups?.length ?? 0) > 1) ? g.label : '',
      // Only the grid knows the seating zone — the table-detail screen fetches
      // a bill, not a table. Carried so the adjust-bill header can say which
      // part of the floor this is.
      zoneName: table.zoneName ?? '',
    };
    // autoOpenPrint is a panel-only convenience (the grid card's quick-print
    // icon) — the phone route has no matching param, so it's left out of the
    // router.push below rather than sending a route param [tableId].tsx
    // doesn't read.
    if (isWide) { setTablePanel({ status: 'occupied', ...fields, autoOpenPrint: opts?.autoOpenPrint }); return; }
    router.push({ pathname: '/(staff)/[tableId]', params: fields });
  };

  // The grid card's quick-print icon: snapshot the panel's current selection
  // first, so onQuickPrintFinished (passed to TableDetailScreen below) has
  // something to put back once the print flow is done.
  const openTableQuickPrint = (table: Table, g?: TableGroup) => {
    quickPrintPrevPanelRef.current = tablePanel;
    openGroupForTable(table, g, { autoOpenPrint: true });
  };

  // Shared seating: crew seats a SEPARATE walk-in party (didn't scan the QR)
  // on an occupied table — backend assigns the next free slot.
  const seatNewParty = async (table: Table) => {
    if (seatingParty) return;
    setSeatingParty(true);
    try {
      const res = await crewSessions.start(table.id, true) as any;
      void loadTables();
      setGroupPicker(null);
      const fields = {
        tableId: String(table.number),
        sessionId: res.session_id,
        tableDbId: table.id ?? '',
        occupiedSince: res.started_at ?? '',
        expiresAt: '',
        customerName: '',
        customerPhone: '',
        groupLabel: res.party_slot ? `G${res.party_slot}` : '',
        zoneName: table.zoneName ?? '',
      };
      if (isWide) setTablePanel({ status: 'occupied', ...fields });
      else router.push({ pathname: '/(staff)/[tableId]', params: fields });
    } catch (e: any) {
      setGroupPicker(null);
      const msg = typeof e?.message === 'string' && e.message.includes('TABLE_PARTIES_FULL')
        ? 'This table already has the maximum number of groups.'
        : (e?.message ?? 'Please try again.');
      showDialog('Could not start group', msg, [{ label: 'OK', onPress: () => { } }]);
    } finally {
      setSeatingParty(false);
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

  // Shared between the CenteredModal (tablet-landscape) and BottomSheet
  // (everywhere else) filter pickers below.
  const filterChipRows = FILTER_CHIPS.map((chip) => {
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
  });

  // "Back at" choices shown when an item is 86'd. Picking one fires the toggle
  // and closes the sheet; the preset's instant is computed at tap time so it is
  // always relative to now, not to when the screen mounted.
  const eightySixOptionRows = EIGHTY_SIX_PRESETS.map((preset) => (
    <TouchableOpacity
      key={preset.key}
      style={styles.sheetOptionRow}
      onPress={() => {
        const target = eightySixTarget;
        setEightySixTarget(null);
        if (target) void toggleMenuItemAvailability(target.id, false, preset.until());
      }}
      activeOpacity={0.7}
    >
      <Text style={styles.sheetOptionText}>{preset.label}</Text>
      <View style={styles.sheetOptionRight}>
        <Text style={styles.sheetOptionCount}>{preset.hint}</Text>
      </View>
    </TouchableOpacity>
  ));

  // Search + refresh + select + filter cluster for the Tables tab. On tablet
  // it sits inline in the top bar beside the burger icon; on phone it keeps
  // its own row below (not enough width to fit alongside the burger + avatar).
  const tableControls = (
    <>
      <View style={[styles.searchBox, { flex: 1 }]}>
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

      {/* Multi-select clear — enter select mode to free several tables at
          once (end of service). Hidden while no table is occupied. */}
      {counts.occupied > 0 && (
        <TouchableOpacity
          style={[styles.refreshTableBtn, selectMode && styles.selectToggleActive]}
          onPress={() => { if (selectMode) exitSelectMode(); else setSelectMode(true); }}
          activeOpacity={0.7}
        >
          <Ionicons
            name={selectMode ? 'close' : 'checkmark-done'}
            size={16}
            color={selectMode ? QuinckleColors.primary : QuinckleColors.textPrimary}
          />
        </TouchableOpacity>
      )}

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
    </>
  );

  // The fixed 40%-width panel — always present on wide layouts (not just
  // while something's selected), so the grid never reflows width as staff
  // tap around the floor. Its content is the only thing that changes.
  const tablePanelJsx = !isWide ? null : (
    <View style={[styles.tablePanelPane, { marginTop: insets.top + Spacing.md }]}>
      {!tablePanel ? (
        <View style={styles.tablePanelIdle}>
          <NoTableSelectedIcon size={72} color={QuinckleColors.textTertiary} />
          <Text style={styles.tablePanelIdleText}>Select a table to see its details</Text>
        </View>
      ) : tablePanel.status === 'available' ? (
        <View style={styles.tablePanelIdle}>
          <TableAvailableIcon size={72} color={QuinckleColors.textTertiary} />
          <Text style={styles.tablePanelAvailableTitle}>
            Table T{String(tablePanel.table.number).padStart(2, '0')}
          </Text>
          <Text style={styles.tablePanelIdleText}>This table is free.</Text>
          <TouchableOpacity
            style={styles.tablePanelCta}
            onPress={() => openTableToOrder(tablePanel.table)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={`Take order for table T${String(tablePanel.table.number).padStart(2, '0')}`}
          >
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={styles.tablePanelCtaText}>Take order</Text>
          </TouchableOpacity>
        </View>
      ) : (
        // Keyed on the session — switching tables/groups should remount with
        // fresh state rather than an existing instance quietly seeing new
        // props (its identity fields are read once via useState, same as
        // when this was route params). Mounted immediately — even under the
        // curtain — so its own data fetch runs the whole time the curtain
        // plays instead of starting only once the curtain clears; by the
        // time it lifts, the bill underneath is already there.
        <View style={{ flex: 1 }}>
          <TableDetailScreen
            key={tablePanel.sessionId}
            panelMode
            onDeselect={() => setTablePanel(null)}
            tableId={tablePanel.tableId}
            sessionId={tablePanel.sessionId}
            tableDbId={tablePanel.tableDbId}
            occupiedSince={tablePanel.occupiedSince}
            expiresAt={tablePanel.expiresAt}
            customerName={tablePanel.customerName}
            customerPhone={tablePanel.customerPhone}
            groupLabel={tablePanel.groupLabel}
            zoneName={tablePanel.zoneName}
            autoOpenPrint={tablePanel.autoOpenPrint}
            onAutoPrintHandled={() => setTablePanel((p) => (p && p.status === 'occupied' ? { ...p, autoOpenPrint: false } : p))}
            onQuickPrintFinished={() => { setTablePanel(quickPrintPrevPanelRef.current); quickPrintPrevPanelRef.current = null; }}
          />
          {curtainSessionId === tablePanel.sessionId && (
            <OrderPlacedCurtain onDone={() => setCurtainSessionId(null)} />
          )}
        </View>
      )}
    </View>
  );

  // Wide Tables/Takeaway tabs: the window splits in two full-height columns.
  // The left 60% carries the top bar, grid and bottom navbar; the detail panel
  // takes the right 40% edge to edge (top to bottom), so it is not boxed in by
  // the bar. Same split, same panel width, on both tabs — one desktop layout
  // language for "a grid of things, and the selected one's detail beside it."
  const split = isWide && (activeTab === 'tables' || activeTab === 'takeaway');

  // The bottom navbar used to live inside `container`, so its width just
  // snapped with that box's instant flexBasis flip (60% split / 100% full)
  // every time `split` toggled — jarring on a wide window, where 40% of the
  // screen appears or vanishes from under the bar in a single frame. It's
  // rendered as its own sibling now (see the JSX below) with its left/width
  // driven by these two Animated.Values instead, tweened in real pixels so
  // the resize reads as one continuous glide. (Plain numbers pre-`isWide` —
  // the split state never changes on a phone, so nothing here ever animates
  // there; it's a no-op, not a workaround.)
  const navFloatT = useRef(new Animated.Value(split ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(navFloatT, {
      toValue: split ? 1 : 0,
      duration: 340,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false, // animating left/width — no native-driver support
    }).start();
  }, [split, navFloatT]);
  const navLeftAnim = navFloatT.interpolate({ inputRange: [0, 1], outputRange: [0, Spacing.lg] });
  const navWidthAnim = navFloatT.interpolate({
    inputRange: [0, 1],
    outputRange: [winWidth, Math.max(0, winWidth * 0.6 - Spacing.lg * 2)],
  });

  const selectedTakeawayOrder: TakeawayGroup | null = selectedTakeawayId
    ? takeawayGroups.find((g) => g.orders.some((o) => o.orderId === selectedTakeawayId)) ?? null
    : null;

  const twPaidUnits = (row: TakeawayRowItem) => row.lines.reduce((n, l) => n + (l.paid ? l.qty : 0), 0);
  const twQty = (row: TakeawayRowItem) => twDraft[takeawayRowKey(row)] ?? row.qty;
  const twSetQty = (row: TakeawayRowItem, qty: number) => {
    const key = takeawayRowKey(row);
    const next = Math.max(twPaidUnits(row), Math.min(row.qty + 50, qty));
    setTwDraft((d) => {
      const out = { ...d };
      if (next === row.qty) delete out[key]; else out[key] = next;
      return out;
    });
  };
  const twCanEdit = !!selectedTakeawayOrder && selectedTakeawayOrder.status !== 'SERVED'
    && !!selectedTakeawayOrder.sessionId && selectedTakeawayOrder.items.length > 0;

  const twPlan = useMemo(() => {
    const removals: { line: TakeawayLine; units: number; name: string; unitPrice: number }[] = [];
    const additions: { row: TakeawayRowItem; units: number }[] = [];
    let changedRows = 0;
    for (const row of selectedTakeawayOrder?.items ?? []) {
      const target = twDraft[takeawayRowKey(row)];
      if (target == null) continue;
      if (target < row.qty) {
        changedRows += 1;
        // Newest unpaid round first: least likely to be cooked, and paid
        // lines can only be refunded.
        let left = row.qty - target;
        for (const line of [...row.lines].reverse()) {
          if (left <= 0) break;
          if (line.paid) continue;
          const units = Math.min(line.qty, left);
          removals.push({ line, units, name: row.name, unitPrice: row.unitPrice });
          left -= units;
        }
      } else if (target > row.qty && row.menuItemId) {
        changedRows += 1;
        additions.push({ row, units: target - row.qty });
      }
    }
    const removedValue = removals.reduce((n, r) => n + r.unitPrice * r.units, 0);
    return { removals, additions, removedValue, changedRows };
  }, [selectedTakeawayOrder, twDraft]);

  const twSave = () => {
    if (twSaving || twPlan.changedRows === 0) return;
    if (twPlan.removals.length > 0) setTwReasonOpen(true);
    else void twApply(null);
  };

  const twApply = async (reason: CancelReason | null) => {
    const g = selectedTakeawayOrder;
    if (!g?.sessionId || twSaving) return;
    const { removals, additions, removedValue } = twPlan;
    // Survives the manager-PIN retry: nothing that went through goes twice.
    const done = new Set<string>();
    let added = additions.length === 0;
    const attempt = async (mint?: MintGrant) => {
      try {
        for (const r of removals) {
          const key = `${r.line.orderId}:${r.line.itemId}`;
          if (done.has(key)) continue;
          const grantId = mint ? await mint(r.line.orderId, r.unitPrice * r.units) : undefined;
          await crewOrders.cancelItem(r.line.orderId, r.line.itemId, reason ?? undefined, { qty: r.units, grantId });
          done.add(key);
        }
        if (!added) {
          // Lands as a new, unpaid round on the same customer — its own KOT,
          // and "Due" on the card until it is collected.
          await crewOrders.placeOrder(g.sessionId!, additions.map((a) => ({
            item_id: a.row.menuItemId!,
            qty: a.units,
            ...(a.row.selectedModifiers?.length ? { selectedModifiers: a.row.selectedModifiers } : {}),
            ...(a.row.modifiers ? { modifiers_summary: a.row.modifiers } : {}),
          })));
          added = true;
        }
      } catch (e) {
        void loadTakeawayOrders();
        throw e;
      }
      setTwEditing(false);
      setTwDraft({});
      await loadTakeawayOrders();
    };
    setTwSaving(true);
    try {
      await runWithApproval({ action: 'VOID_AFTER_BILL', amount: removedValue }, attempt);
    } catch (e: any) {
      showDialog('Could not save changes', takeawayCancelMessage(e), [{ label: 'OK', onPress: () => {} }]);
    } finally {
      setTwSaving(false);
    }
  };

  // Add to this customer's order: the menu, on THEIR session — the new round
  // prints its own KOT and joins this card with its own "Due".
  const addToTakeaway = (g: TakeawayGroup) => {
    if (!g.sessionId || g.status === 'SERVED') return;
    router.push({
      pathname: '/(staff)/order-menu',
      params: {
        channel: 'TAKEAWAY',
        sessionId: g.sessionId,
        pickupToken: g.pickupToken ?? '',
        customerName: g.customerName ?? '',
        customerPhone: g.customerPhone ?? '',
      },
    });
  };

  // Same shape [tableId].tsx builds for its own chevron-up breakdown
  // (explainedBill) — nothing here computes money, every figure comes
  // straight off the order the server already priced.
  const [takeawayBillExpanded, setTakeawayBillExpanded] = useState(false);
  const explainedTakeawayBill = useMemo<ExplainedBill | null>(() => {
    if (!selectedTakeawayOrder) return null;
    const o = selectedTakeawayOrder;
    return {
      items: o.items.map((it, idx) => ({
        key: `${o.orderId}:${it.itemId}:${idx}`,
        name: `${it.qty}× ${it.name}`,
        modifiersSummary: it.modifiers,
        price: it.qty * it.unitPrice,
      })),
      subtotal: o.subtotal,
      discountTotal: o.discount,
      // Takeaway orders don't itemise WHICH discount a rupee came from
      // (offer vs. staff-given) the way a session's discount_lines do — one
      // untagged "Discount" row (BillExplainContent's own fallback) beats a
      // guessed attribution.
      discountLines: [],
      chargesTotal: o.serviceCharge,
      chargeLines: o.chargeLines ?? [],
      taxTotal: o.tax,
      taxRate: o.subtotal > 0 ? (o.tax / o.subtotal) * 100 : 0,
      taxLines: o.taxLines ?? [],
      tip: 0,
      roundOff: o.roundOff ?? 0,
      total: o.total,
    };
  }, [selectedTakeawayOrder]);

  const takeawayListData = (
    takeawaySubTab === 'preparing'
      ? takeawayGroups.filter((o) => o.status !== 'SERVED')
      : takeawayGroups.filter((o) => o.status === 'SERVED')
  ).filter(matchesTakeawaySearch);

  // The desktop grid's cards are `flex: 1` so every column shares the row
  // evenly — great for full rows, but a trailing row with fewer items than
  // `takeawayGridColumns` stretches to fill the leftover width instead of
  // matching the cards above it. Pad it out with invisible fillers that
  // still claim a flex:1 slot, so the last row sizes exactly like the rest
  // and the remainder is genuinely empty space, not a stretched card.
  const takeawayGridData = useMemo<(TakeawayOrder | { __filler: true; orderId: string })[]>(() => {
    if (!split || takeawayGridColumns <= 1) return takeawayListData;
    const remainder = takeawayListData.length % takeawayGridColumns;
    if (remainder === 0) return takeawayListData;
    const fillers = Array.from({ length: takeawayGridColumns - remainder }, (_, i) => ({
      __filler: true as const,
      orderId: `__takeaway-grid-filler-${i}`,
    }));
    return [...takeawayListData, ...fillers];
  }, [takeawayListData, takeawayGridColumns, split]);

  // Same visual language as the table panel's desktop command rail
  // ([tableId].tsx: cmdHeader / cmdRow / cmdBill / cmdRail) — a compact
  // single-line header, numbered-style tabular rows, a Payable footer with
  // one primary CTA, and a narrow icon rail for the secondary actions —
  // instead of the old standalone layout (giant coloured token, a loose
  // action row of mixed icon/text buttons) that looked like a different app
  // next to the table panel.
  const takeawayPanelJsx = !isWide ? null : (
    <View style={[styles.tablePanelPane, { marginTop: insets.top + Spacing.md }]}>
      {!selectedTakeawayOrder ? (
        <View style={styles.tablePanelIdle}>
          <Ionicons name="bag-handle-outline" size={72} color={QuinckleColors.textTertiary} />
          <Text style={styles.tablePanelIdleText}>Select an order to see its details, or take a new one</Text>
          <TouchableOpacity
            style={styles.tablePanelCta}
            onPress={startTakeawayOrder}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Take new takeaway order"
          >
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={styles.tablePanelCtaText}>Take new order</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.twpSplit}>
          <View style={styles.twpMain}>
            <View style={styles.twpHeader}>
              <Text style={styles.twpTitle} numberOfLines={1}>{selectedTakeawayOrder.pickupToken ?? '—'}</Text>
              {selectedTakeawayOrder.customerName ? (
                <Text style={styles.takeawayCustomer} numberOfLines={1}>{selectedTakeawayOrder.customerName}</Text>
              ) : null}
              {selectedTakeawayOrder.customerPhone ? (
                <TouchableOpacity
                  onPress={() => { void Linking.openURL(`tel:${(selectedTakeawayOrder.customerPhone ?? '').replace(/[^0-9+]/g, '')}`); }}
                  activeOpacity={0.7}
                  style={styles.takeawayPhoneBtn}
                >
                  <Ionicons name="call-outline" size={12} color={QuinckleColors.primary} />
                  <Text style={styles.takeawayPhoneLink}>{selectedTakeawayOrder.customerPhone}</Text>
                </TouchableOpacity>
              ) : null}
              <View style={{ flex: 1, minWidth: Spacing.sm }} />
              <Text style={styles.twpTime} numberOfLines={1}>
                {new Date(selectedTakeawayOrder.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
              </Text>
              <TouchableOpacity
                onPress={() => { setSelectedTakeawayId(null); setTakeawayBillExpanded(false); }}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                style={styles.twpCloseBtn}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <Ionicons name="close" size={18} color={QuinckleColors.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={styles.twpTicketHeader}>
              <Text style={styles.twpSectionLabel}>
                {selectedTakeawayOrder.items.length} {selectedTakeawayOrder.items.length === 1 ? 'item' : 'items'}
                {selectedTakeawayOrder.sessionRef ? `  ·  ${selectedTakeawayOrder.sessionRef}` : ''}
              </Text>
              {twEditing ? (
                <View style={styles.twEditBar}>
                  <TouchableOpacity onPress={() => { setTwEditing(false); setTwDraft({}); }} disabled={twSaving} activeOpacity={0.7} hitSlop={8}>
                    <Text style={styles.twEditCancel}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={twSave}
                    disabled={twSaving || twPlan.changedRows === 0}
                    activeOpacity={0.8}
                    style={[styles.twEditSave, (twSaving || twPlan.changedRows === 0) && { opacity: 0.4 }]}
                  >
                    {twSaving
                      ? <ActivityIndicator size="small" color="#fff" />
                      : <Text style={styles.twEditSaveText}>{twPlan.changedRows > 0 ? `Save (${twPlan.changedRows})` : 'Save'}</Text>}
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.twEditBar}>
                  <Text style={[
                    styles.twpSectionLabel,
                    { color: isTakeawayPaid(selectedTakeawayOrder) ? QuinckleColors.success : QuinckleColors.warning },
                  ]}>
                    {takeawayPayLabel(selectedTakeawayOrder)}
                  </Text>
                  {twCanEdit && (
                    <TouchableOpacity onPress={() => setTwEditing(true)} activeOpacity={0.7} hitSlop={8} accessibilityRole="button" accessibilityLabel="Edit quantities">
                      <Text style={styles.twEditLink}>Edit</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            </View>

            <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.twpListContent}>
              {selectedTakeawayOrder.items.map((it, j) => {
                // "1 at 06:11 · 2 at 06:34" once a dish spans several rounds.
                const rounds = new Set(it.lines.map((l) => l.orderId)).size > 1
                  ? it.lines.map((l) => `${l.qty} at ${new Date(l.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`).join(' · ')
                  : null;
                const sub = [it.modifiers, rounds].filter(Boolean).join(' · ');
                if (twEditing) {
                  const q = twQty(it);
                  const floor = twPaidUnits(it);
                  const changed = q !== it.qty;
                  return (
                    <View key={j} style={[styles.twpRow, q === 0 && { opacity: 0.5 }]}>
                      <View style={styles.twpRowBody}>
                        <Text style={[styles.twpRowName, q === 0 && styles.twStruck]} numberOfLines={1}>{it.name}</Text>
                        <Text style={styles.twpRowSub} numberOfLines={1}>
                          {floor > 0 ? `${floor} paid — refund to remove` : (sub || (changed ? `was ${it.qty}` : ''))}
                        </Text>
                      </View>
                      <Text style={styles.twpRowPrice}>{(q * it.unitPrice).toFixed(0)}</Text>
                      <View style={styles.twStepper}>
                        <TouchableOpacity
                          style={[styles.twStepBtn, q <= floor && styles.twStepBtnOff]}
                          onPress={() => twSetQty(it, q - 1)}
                          disabled={q <= floor || twSaving}
                          activeOpacity={0.7}
                          accessibilityLabel={`One less ${it.name}`}
                        >
                          <Ionicons name="remove" size={16} color={QuinckleColors.textPrimary} />
                        </TouchableOpacity>
                        <Text style={[styles.twStepQty, changed && { color: QuinckleColors.primary }]}>{q}</Text>
                        <TouchableOpacity
                          style={[styles.twStepBtn, !it.menuItemId && styles.twStepBtnOff]}
                          onPress={() => twSetQty(it, q + 1)}
                          disabled={!it.menuItemId || twSaving}
                          activeOpacity={0.7}
                          accessibilityLabel={`One more ${it.name}`}
                        >
                          <Ionicons name="add" size={16} color={QuinckleColors.textPrimary} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.twStepRemove, (floor > 0) && styles.twStepBtnOff]}
                          onPress={() => twSetQty(it, q === floor ? it.qty : floor)}
                          disabled={floor > 0 || twSaving}
                          activeOpacity={0.7}
                          accessibilityLabel={q === 0 ? `Keep ${it.name}` : `Remove ${it.name}`}
                        >
                          <Ionicons name={q === 0 ? 'arrow-undo' : 'close'} size={15} color={QuinckleColors.danger} />
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                }
                return (
                  <View key={j} style={styles.twpRow}>
                    <Text style={styles.twpRowQty}>{it.qty}×</Text>
                    <View style={styles.twpRowBody}>
                      <Text style={styles.twpRowName} numberOfLines={1}>{it.name}</Text>
                      {sub ? <Text style={styles.twpRowSub} numberOfLines={1}>{sub}</Text> : null}
                    </View>
                    <Text style={styles.twpRowPrice}>{(it.qty * it.unitPrice).toFixed(0)}</Text>
                  </View>
                );
              })}
            </ScrollView>

            <View style={styles.twpBill}>
              <TouchableOpacity
                style={styles.twpPayRow}
                activeOpacity={selectedTakeawayOrder.items.length > 0 ? 0.7 : 1}
                disabled={selectedTakeawayOrder.items.length === 0}
                onPress={() => setTakeawayBillExpanded(true)}
                accessibilityRole="button"
                accessibilityLabel="Full bill breakdown"
              >
                <Text style={styles.twpPayLabel}>Payable</Text>
                <View style={styles.twpPayRight}>
                  <Text style={styles.twpPayValue}>₹{selectedTakeawayOrder.total}</Text>
                  {selectedTakeawayOrder.items.length > 0 && (
                    <Ionicons name="chevron-up" size={16} color={QuinckleColors.textTertiary} />
                  )}
                </View>
              </TouchableOpacity>

              {selectedTakeawayOrder.status === 'SERVED' ? (
                <View style={[styles.twpPaidBadge, styles.twpPaidBadgeSuccess]}>
                  <Ionicons name="checkmark-circle" size={15} color={QuinckleColors.success} />
                  <Text style={[styles.twpPaidText, { color: QuinckleColors.success }]}>Handed over</Text>
                </View>
              ) : isTakeawayPendingCollection(selectedTakeawayOrder) ? (
                <TouchableOpacity
                  style={styles.twpCollectBtn}
                  onPress={() => handleCollectTakeaway(selectedTakeawayOrder)}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel="Send to payment collection"
                >
                  <Ionicons name="cash-outline" size={15} color="#fff" />
                  <Text style={styles.twpCollectText}>
                    {selectedTakeawayOrder.paidTotal > 0.005 ? `Collect ₹${Math.round(selectedTakeawayOrder.dueTotal)}` : 'Collect Payment'}
                  </Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[
                    styles.twpCollectBtn,
                    (!isTakeawayPaid(selectedTakeawayOrder) || handingOverIds.includes(selectedTakeawayOrder.orderId)) && styles.twpCollectBtnDisabled,
                  ]}
                  onPress={() => handleHandover(selectedTakeawayOrder.orderId)}
                  disabled={!isTakeawayPaid(selectedTakeawayOrder) || handingOverIds.includes(selectedTakeawayOrder.orderId)}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel="Hand over order"
                >
                  {handingOverIds.includes(selectedTakeawayOrder.orderId) && (
                    <ActivityIndicator size="small" color="#fff" />
                  )}
                  <Text style={styles.twpCollectText}>
                    {handingOverIds.includes(selectedTakeawayOrder.orderId) ? 'Handing Over…' : 'Hand Over'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {selectedTakeawayOrder.status !== 'SERVED' && (
            <View style={styles.twpRail}>
              {selectedTakeawayOrder.sessionId && (
                <TouchableOpacity
                  style={styles.twpRailBtn}
                  onPress={() => addToTakeaway(selectedTakeawayOrder)}
                  activeOpacity={0.6}
                  accessibilityRole="button"
                  accessibilityLabel="Add items to this order"
                >
                  <Ionicons name="add-circle-outline" size={20} color={QuinckleColors.textSecondary} />
                  <Text style={styles.twpRailLabel}>Add</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.twpRailBtn}
                onPress={() => setPrintTakeawayOrder(selectedTakeawayOrder)}
                activeOpacity={0.6}
                accessibilityRole="button"
                accessibilityLabel="Print"
              >
                <Ionicons name="print-outline" size={20} color={QuinckleColors.textSecondary} />
                <Text style={styles.twpRailLabel}>Print</Text>
              </TouchableOpacity>
              {/* Discount lives inside Adjust bill's own form (see
                  AdjustBillForm's discount section) — no separate rail
                  button needed for it here. */}
              {canDiscountTakeaway(selectedTakeawayOrder) && selectedTakeawayOrder.sessionId && (
                <TouchableOpacity
                  style={styles.twpRailBtn}
                  onPress={() => openAdjustBill(selectedTakeawayOrder)}
                  activeOpacity={0.6}
                  accessibilityRole="button"
                  accessibilityLabel="Adjust bill"
                >
                  <Ionicons name="options-outline" size={20} color={QuinckleColors.textSecondary} />
                  <Text style={styles.twpRailLabel}>Bill</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      )}

      {/* Bill breakdown — the same chevron-up-beside-Payable move as the
          table panel's command rail (cmdPayRow → BillExplainSheet), nested
          here so it opens inside this panel instead of the old full-screen
          sheet's usual home. */}
      <BillExplainSheet
        visible={takeawayBillExpanded}
        onClose={() => setTakeawayBillExpanded(false)}
        bill={explainedTakeawayBill}
      />

      {/* Order placed — the same green beat as the table panel. Keyed to the
          order it was raised for, so picking another order mid-animation
          does not play it over the wrong one. Unlike the handover curtain it
          leaves the order selected: the crew wants to see what they placed. */}
      {takeawayPlacedCurtainId && takeawayPlacedCurtainId === selectedTakeawayId && !handoverCurtainId && (
        <OrderPlacedCurtain onDone={() => setTakeawayPlacedCurtainId(null)} />
      )}

      {/* Handed over — a brief celebration, same component the table panel
          uses for "order placed", then fall back to the idle placeholder
          instead of leaving a settled order sitting in the panel. */}
      {handoverCurtainId && (
        <OrderPlacedCurtain
          label="Order handed over"
          skipLoading
          onDone={() => {
            setHandoverCurtainId(null);
            setSelectedTakeawayId(null);
            setTakeawayBillExpanded(false);
          }}
        />
      )}

      {/* Send to Payment Collection — same move as the table panel's
          CollectPaymentPanel sheet (see [tableId].tsx): a method picker + one
          CTA embedded HERE, inside this panel's own box, instead of pushing
          the phone's payment-collect.tsx screen. Nested inside
          tablePanelPane (not at the top level) so its absoluteFill backdrop
          is clipped to this panel's rounded card, same as the table one. */}
      {takeawayCollectTarget && (
        <BottomSheet
          visible={!!takeawayCollectTarget}
          onClose={() => setTakeawayCollectTarget(null)}
          title="Send to payment collection"
          dismissible={false}
        >
          <CollectPaymentPanel
            {...(takeawayCollectTarget.unpaidOrders.length === 1
              ? { orderId: takeawayCollectTarget.unpaidOrders[0]!.orderId }
              : {
                  sessionId: takeawayCollectTarget.sessionId,
                  orderIds: takeawayCollectTarget.unpaidOrders.map((o) => o.orderId),
                })}
            amount={takeawayCollectTarget.dueTotal}
            tableLabel={takeawayCollectTarget.pickupToken ?? 'Takeaway'}
            staffId={staffInfo?.id ?? ''}
            customerName={takeawayCollectTarget.customerName}
            customerPhone={takeawayCollectTarget.customerPhone}
            onClose={() => setTakeawayCollectTarget(null)}
            secondaryAction={{
              label: 'Hand over',
              run: async () => {
                for (const o of takeawayCollectTarget.orders) {
                  if (o.status !== 'SERVED') await crewOrders.handoverTakeaway(o.orderId);
                }
                handedOverViaCollectRef.current = true;
              },
            }}
            onCollected={() => {
              const orderId = takeawayCollectTarget.orderId;
              setTakeawayCollectTarget(null);
              void loadTakeawayOrders();
              if (handedOverViaCollectRef.current) {
                handedOverViaCollectRef.current = false;
                if (selectedTakeawayOrder?.orderId === orderId) setHandoverCurtainId(orderId);
              }
            }}
          />
        </BottomSheet>
      )}

      {/* Print — same PrintOptionsSheet the table panel uses, nested here for
          the same reason as the collect sheet above (was rendered at the top
          level, so its backdrop covered the left grid instead of this panel). */}
      <PrintOptionsSheet
        visible={!!printTakeawayOrder}
        onPrintKot={() => { if (printTakeawayOrder) void handlePrintTakeawayKot(printTakeawayOrder); }}
        onPrintInvoice={(buyer) => { if (printTakeawayOrder) void handlePrintTakeawayInvoice(printTakeawayOrder, buyer); }}
        onClose={() => setPrintTakeawayOrder(null)}
      />

      {/* Adjust bill — embedded on desktop, same move as [tableId].tsx's
          "Bill" rail button (AdjustBillForm's own doc comment: "the desktop
          table panel puts it in a BottomSheet beside the ticket"). */}
      {takeawayAdjustTarget && (
        <BottomSheet
          visible={!!takeawayAdjustTarget}
          onClose={() => setTakeawayAdjustTarget(null)}
          title="Adjust bill"
          disableInternalScroll
          maxHeightRatio={0.88}
        >
          <AdjustBillForm
            embedded
            sessionId={takeawayAdjustTarget.sessionId!}
            subtitle={takeawayAdjustTarget.pickupToken ? `Order ${takeawayAdjustTarget.pickupToken}` : 'This order'}
            billTotal={takeawayAdjustTarget.total}
            onClose={() => setTakeawayAdjustTarget(null)}
            onSaved={() => { void loadTakeawayOrders(); }}
          />
        </BottomSheet>
      )}
    </View>
  );

  return (
    <View style={styles.root}>
    <View style={[styles.container, split && styles.containerSplit, { paddingTop: insets.top + Spacing.sm }]}>
      <View style={styles.topBar}>
        <View style={styles.topBarLeft}>
          <TouchableOpacity
            style={styles.burgerBtn}
            onPress={() => { if (isDesktop()) setMenuOpen(true); else router.push('/(staff)/more'); }}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="menu" size={26} color={QuinckleColors.textPrimary} />
          </TouchableOpacity>
        </View>

        {/* The splash wordmark, centred between the burger and the cash icon.
            A flex slot rather than absolute centring, so it shrinks instead
            of overlapping either side on a narrow window. */}
        <View style={styles.headerLogoSlot} pointerEvents="none">
          <Image
            source={require('../../assets/images/logo/quinckle crew logo header.webp')}
            style={styles.headerLogo}
            resizeMode="contain"
            accessibilityLabel="Quinckle Crew"
          />
        </View>

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

          {/* Profile now lives behind the burger → Menu → Profile, so the
              header carries one nav affordance instead of two. */}
        </View>
      </View>

      {activeTab === 'tables' ? (
        <View style={isWide ? styles.tablesRow : styles.tablesFill}>
        <View style={isWide ? styles.tablesGridPane : styles.tablesFill}>
          {/* Own row below the header, same as the takeaway tab's toolbar —
              not squeezed inline beside the burger icon any more. */}
          <View style={styles.controlsRow}>{tableControls}</View>

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
                zoneSections.map((section) => (
                <View key={section.key}>
                {section.name !== null && (
                  <View style={styles.zoneHeader}>
                    <Text style={styles.zoneHeaderName}>{section.name}</Text>
                    <View style={styles.zoneHeaderRule} />
                    <Text style={styles.zoneHeaderCount}>{section.tables.length}</Text>
                  </View>
                )}
                <View style={styles.tableGrid}>
                  {section.tables.map((item) => {
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
                    // Amber, not green: green means done. A printed, unpaid bill
                    // is the window where cutting it needs a manager.
                    const billPrinted = showStatusIcons && !paid && item.billPrintedUnpaid === true;
                    // Where the card carries the round print button (wide layouts,
                    // single party), THAT button is the printed marker; the small
                    // receipt icon is only for cards without one (phones, and
                    // multi-party tables, which get no print button).
                    const hasPrintFab = isWide && item.status === 'occupied' && (item.groups?.length ?? 0) <= 1;
                    const timeLeft = item.status === 'occupied' ? formatTimeLeft(item.expiresAt, now, item.occupiedSince) : null;
                    const isOccupied = item.status === 'occupied';
                    const selected = selectedIds.has(item.id);
                    // In select mode only occupied cards are actionable; others dim.
                    const dimmed = selectMode && !isOccupied;
                    const cardInner = (
                      <TouchableOpacity
                        style={[
                          styles.tableCardOuter,
                          item.status === 'offline' && styles.offlineCard,
                          dimmed && styles.selectDim,
                        ]}
                        onPress={() => {
                          if (selectMode) { if (isOccupied) toggleSelect(item.id); return; }
                          handleTablePress(item.number, item.status);
                        }}
                        onLongPress={() => { if (!selectMode) handleLongPress(item.id, item.status); }}
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
                        {/* Selection tint + check (multi-select mode) */}
                        {selectMode && isOccupied && selected && (
                          <View style={styles.selectedOverlay} pointerEvents="none" />
                        )}
                        {selectMode && isOccupied && (
                          <View style={styles.selectCheck} pointerEvents="none">
                            <Ionicons
                              name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                              size={22}
                              color={selected ? QuinckleColors.primary : QuinckleColors.textTertiary}
                            />
                          </View>
                        )}
                        {/* Batch-free sweep — brief green wash over the just-cleared card */}
                        {recentlyFreedIds.has(item.id) && (
                          <ClearFlash onDone={() => removeFreedId(item.id)} />
                        )}
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
                                  {!hasPrintFab && (
                                    <Ionicons
                                      name={billPrinted ? 'receipt' : 'receipt-outline'}
                                      size={14}
                                      color={billPrinted ? QuinckleColors.warning : QuinckleColors.textTertiary}
                                      accessibilityLabel={billPrinted ? 'Bill printed, not paid' : undefined}
                                    />
                                  )}
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
                                  <Text style={styles.billSubtitle}>
                                    {(item.groups?.length ?? 0) > 1
                                      ? `${item.groups!.length} groups`
                                      : item.since ? `since ${item.since}` : 'active session'}
                                  </Text>
                                </View>
                                {timeLeft && (
                                  <View style={[styles.cardTimer, expiryChipStyle(timeLeft.level)]}>
                                    <Ionicons
                                      name={timeLeft.level === 'overdue' ? 'alert-circle-outline' : 'time-outline'}
                                      size={12}
                                      color={expiryColor(timeLeft.level)}
                                    />
                                    <Text
                                      style={[styles.cardTimerText, { color: expiryColor(timeLeft.level) }]}
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
                    // Freeing is deliberately NOT a swipe on the grid. A stray
                    // horizontal drag while scanning the floor was clearing
                    // occupied tables outright — an Undo snackbar the crew
                    // never saw mid-rush is not a safety net. Free now lives
                    // behind long-press → Manage → Free table.
                    // One quick action per card, same notch + FAB affordance,
                    // the icon/handler set by status:
                    //  - occupied, single party → print (multi-party is
                    //    ambiguous about whose bill, so it's left to the
                    //    card's own tap, which opens the group picker)
                    //  - available → '+' straight into order-menu, skipping
                    //    the panel-select step (same instant-nav openTableToOrder
                    //    already gives the panel's own "Take order" CTA)
                    //  - offline → play, straight back to available, no
                    //    confirm dialog (the card's own tap still asks)
                    // tableCardOuter clips overflow for its gradient border,
                    // so the notch + FAB render out here as gridCell's own
                    // children instead of inside that clipped box.
                    // Glass fill stays neutral (same as takeaway's FAB) —
                    // only the icon tints to the card's own status color
                    // (meta.color, the same value driving the gradient
                    // border), so the button reads as "this card's action"
                    // without turning the tile into another colored blob.
                    const quickAction = !isWide ? null
                      : item.status === 'occupied' && (item.groups?.length ?? 0) <= 1
                        ? {
                            // Printed and unpaid: filled amber, so a glance at the
                            // floor shows which guests already hold their bill.
                            icon: billPrinted ? 'print' as const : 'print-outline' as const,
                            label: billPrinted ? 'Print again — bill already printed' : 'Print',
                            color: billPrinted ? QuinckleColors.background : meta.color,
                            printed: billPrinted,
                            onPress: () => openTableQuickPrint(item, item.groups?.[0]),
                          }
                        : item.status === 'available'
                        ? { icon: 'add' as const, label: 'Take order', color: meta.color, onPress: () => openTableToOrder(item) }
                        : item.status === 'offline'
                        ? {
                            icon: 'play' as const,
                            label: 'Make available',
                            color: meta.color,
                            onPress: () => { void updateTableStatus(item.number, 'available'); },
                          }
                        : null;
                    return (
                      <View key={item.id} style={[styles.gridCell, { width: tableCellWidth }]}>
                        {cardInner}
                        {quickAction && (
                          <>
                            <View style={styles.tableCardActionNotch} pointerEvents="none" />
                            <TouchableOpacity
                              style={[styles.tableCardActionFab, 'printed' in quickAction && quickAction.printed && styles.tableCardActionFabPrinted]}
                              onPress={quickAction.onPress}
                              activeOpacity={0.8}
                              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                              accessibilityRole="button"
                              accessibilityLabel={quickAction.label}
                            >
                              <Ionicons name={quickAction.icon} size={18} color={quickAction.color} />
                            </TouchableOpacity>
                          </>
                        )}
                      </View>
                    );
                  })}
                  {/* tableGrid uses justifyContent:'space-between' per row; a
                      short last row would otherwise have its slack spread
                      across the gaps instead of matching the column grid
                      above. Invisible fillers pad it to a full row so the
                      real cards land on the same column positions. Counted
                      per zone section — each one ends in its own short row. */}
                  {Array.from({
                    length: (tableColumns - (section.tables.length % tableColumns)) % tableColumns,
                  }).map((_, i) => (
                    <View key={`filler-${i}`} style={{ width: tableCellWidth }} />
                  ))}
                </View>
                </View>
                ))
              )}
            </ScrollView>
          )}
        </View>
        </View>
      ) : activeTab === 'menu' ? (
        <>
          {/* Main menu view */}
          {isLoadingMenu ? (
            <MenuSkeleton />
          ) : (() => {
            const tilesJsx = (
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
            );

            const searchJsx = (
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
            );

            const itemListJsx = (
              <>
                {menuData
                  .filter(item => {
                    const q = searchText.trim().toLowerCase();
                    // A search spans the WHOLE menu. Now that the tab opens on one
                    // category instead of "All", scoping search to that category
                    // would quietly hide matches sitting in the others.
                    if (q) return item.name.toLowerCase().includes(q);
                    return menuFilter === 'All' || item.category === menuFilter;
                  })
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
                        {!item.available && item.unavailableUntil && (
                          <View style={styles.backAtBadge}>
                            <Ionicons name="time-outline" size={11} color={QuinckleColors.textSecondary} />
                            <Text style={styles.backAtBadgeText}>{formatBackAt(item.unavailableUntil)}</Text>
                          </View>
                        )}
                        <TouchableOpacity
                          onPress={() => onToggleMenuItemPress(item)}
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
              </>
            );

            // Desktop/tablet-landscape: categories move into a left rail (20% of
            // the window) instead of the horizontal chip row, so a long category
            // list doesn't need to scroll sideways on a screen with room to spare.
            if (isWide) {
              return (
                <View style={styles.menuRow}>
                  <ScrollView
                    style={[styles.menuCategoryRail, { width: winWidth * 0.2 }]}
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={styles.menuCategoryRailContent}
                  >
                    {menuCategories.map(cat => {
                      const active = menuFilter === cat;
                      return (
                        <TouchableOpacity
                          key={cat}
                          style={[styles.menuRailItem, active && styles.menuRailItemActive]}
                          onPress={() => setMenuFilter(cat)}
                          activeOpacity={0.75}
                        >
                          <View style={[styles.menuRailAccent, active && styles.menuRailAccentActive]} />
                          <Text style={[styles.menuRailText, active && styles.menuRailTextActive]} numberOfLines={2}>
                            {cat}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>

                  <View style={styles.menuRowDivider} />

                  <ScrollView style={styles.menuRightPane} showsVerticalScrollIndicator={false}>
                    {tilesJsx}
                    {searchJsx}
                    {itemListJsx}
                  </ScrollView>
                </View>
              );
            }

            return (
              <ScrollView style={styles.tabContent} showsVerticalScrollIndicator={false}>
                {tilesJsx}
                {searchJsx}

                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipScroll} style={styles.chipRow}>
                  {menuCategories.map(cat => (
                    <TouchableOpacity key={cat} style={[styles.chip, menuFilter === cat && styles.chipActive]} onPress={() => setMenuFilter(cat)}>
                      <Text style={[styles.chipText, menuFilter === cat && styles.chipTextActive]}>{cat}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                {itemListJsx}
              </ScrollView>
            );
          })()}
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
            // numColumns can't change on a live FlatList without a remount —
            // same trick the takeaway grid uses.
            key={`orders-grid-${ordersGridColumns}`}
            data={ordersSubTab === 'active' ? activePickupOrders : completedPickupOrders}
            keyExtractor={(item) => item.id}
            numColumns={ordersGridColumns}
            columnWrapperStyle={ordersGridColumns > 1 ? styles.ordersGridRow : undefined}
            contentContainerStyle={styles.orderListContent}
            renderItem={({ item }) => (
              <PickupCard
                order={item}
                isCompleting={completingIds.includes(item.id)}
                onToggleItem={(itemId, nextQty) => togglePickupItem(item.id, itemId, nextQty)}
                onCompletionFinished={() => handleCompletionFinished(item.id)}
                onReopen={undefined}
                fixedWidth={ordersGridColumns > 1 ? KOT_CARD_WIDTH : undefined}
                fixedHeight={ordersGridColumns > 1 ? KOT_CARD_HEIGHT : undefined}
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
          {isWide ? (
            // Wide layout: tabs, search, refresh and add in one compact bar
            // instead of two stacked rows — and no QR icon here. That code
            // opens a self-order QR for a customer to scan; it stays on the
            // phone's stacked layout below, where the crew actually hands
            // the device across the counter.
            <View style={styles.takeawayToolbarRow}>
              <TouchableOpacity
                ref={takeawayTabBtnRef}
                style={styles.takeawayToolbarSeg}
                onPress={openTakeawayTabMenu}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={`${takeawaySubTab === 'preparing' ? 'Preparing' : 'Handed'}, change list`}
              >
                <Text style={styles.twDropdownText}>
                  {takeawaySubTab === 'preparing' ? 'Preparing' : 'Handed'}
                </Text>
                <View style={{ flex: 1 }} />
                <View style={styles.twDropdownCount}>
                  <Text style={styles.twDropdownCountText}>
                    {takeawaySubTab === 'preparing'
                      ? takeawayGroups.filter((o) => o.status !== 'SERVED').length
                      : takeawayGroups.filter((o) => o.status === 'SERVED').length}
                  </Text>
                </View>
                <Ionicons name="chevron-down" size={16} color={QuinckleColors.textSecondary} />
              </TouchableOpacity>
              <View style={[styles.searchBox, { flex: 1 }]}>
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
                style={styles.takeawayNewIconBtn}
                onPress={startTakeawayOrder}
                activeOpacity={0.85}
              >
                <Ionicons name="add" size={22} color="#fff" />
              </TouchableOpacity>
            </View>
          ) : (
            <>
              <View style={styles.segmentWrap}>
                <PickupSegmented
                  items={[
                    { key: 'preparing', label: 'Preparing', count: takeawayGroups.filter((o) => o.status !== 'SERVED').length },
                    { key: 'handed', label: 'Handed', count: takeawayGroups.filter((o) => o.status === 'SERVED').length },
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
                  onPress={startTakeawayOrder}
                  activeOpacity={0.85}
                >
                  <Ionicons name="add" size={22} color="#fff" />
                </TouchableOpacity>
              </View>
            </>
          )}

          {/* Preparing/Handed dropdown menu — a transparent Modal so it
              floats above the grid regardless of where this sits in the
              tree, positioned off the trigger button's measured coordinates.
              The backdrop Pressable behind it closes on any outside tap. */}
          <Modal visible={takeawayTabMenuOpen} transparent animationType="fade" onRequestClose={() => setTakeawayTabMenuOpen(false)}>
            <Pressable style={styles.twDropdownBackdrop} onPress={() => setTakeawayTabMenuOpen(false)} />
            {takeawayTabMenuPos && (
              <View style={[styles.twDropdownMenu, { top: takeawayTabMenuPos.top, left: takeawayTabMenuPos.left, width: takeawayTabMenuPos.width }]}>
                <TouchableOpacity
                  style={[styles.twDropdownRow, takeawaySubTab === 'preparing' && styles.twDropdownRowActive]}
                  onPress={() => { setTakeawaySubTab('preparing'); setTakeawayTabMenuOpen(false); }}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.twDropdownRowText, takeawaySubTab === 'preparing' && styles.twDropdownRowTextActive]}>Preparing</Text>
                  <Text style={[styles.twDropdownRowText, takeawaySubTab === 'preparing' && styles.twDropdownRowTextActive]}>
                    {takeawayGroups.filter((o) => o.status !== 'SERVED').length}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.twDropdownRow, takeawaySubTab === 'handed' && styles.twDropdownRowActive]}
                  onPress={() => { setTakeawaySubTab('handed'); setTakeawayTabMenuOpen(false); }}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.twDropdownRowText, takeawaySubTab === 'handed' && styles.twDropdownRowTextActive]}>Handed</Text>
                  <Text style={[styles.twDropdownRowText, takeawaySubTab === 'handed' && styles.twDropdownRowTextActive]}>
                    {takeawayGroups.filter((o) => o.status === 'SERVED').length}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </Modal>

          {isLoadingTakeaway && takeawayOrders.length === 0 ? (
            <TakeawaySkeleton />
          ) : split ? (
          // ── Desktop: a grid of compact cards, full detail lives in the
          //     fixed 40% panel beside it (takeawayPanelJsx) — same division
          //     of labour as the table grid's tiles vs. its side panel. ──
          <FlatList
            key={`grid-${takeawayGridColumns}`}
            data={takeawayGridData}
            numColumns={takeawayGridColumns}
            columnWrapperStyle={styles.takeawayGridRow}
            keyExtractor={(item) => item.orderId}
            contentContainerStyle={styles.orderListContent}
            refreshControl={
              <RefreshControl refreshing={refreshingTakeaway} onRefresh={handleRefreshTakeaway} tintColor={QuinckleColors.primary} />
            }
            renderItem={({ item }) => {
              // A blank slot claiming its flex:1 share of the row, so the
              // real cards beside it stay the same size the fully-populated
              // rows above use, instead of stretching to fill the gap.
              if ('__filler' in item) return <View style={{ flex: 1 }} />;
              return (
              <Pressable
                style={({ pressed }) => [
                  styles.takeawayGridCard,
                  item.orderId === selectedTakeawayOrder?.orderId && styles.takeawayGridCardActive,
                  pressed && styles.takeawayCardPressed,
                ]}
                onPress={() => setSelectedTakeawayId(item.orderId)}
              >
                <View style={styles.takeawayCardTop}>
                  <View style={styles.takeawayCardLeft}>
                    <Text style={styles.takeawayToken}>{item.pickupToken ?? '—'}</Text>
                    <Text style={styles.takeawayCustomer} numberOfLines={1}>
                      {item.customerName ?? 'N/A'} · {item.customerPhone ?? 'N/A'}
                    </Text>
                  </View>
                  <Text style={[
                    styles.takeawayStatusText,
                    { color: isTakeawayPaid(item) ? QuinckleColors.success : QuinckleColors.warning },
                  ]}>
                    {takeawayPayLabel(item)}
                  </Text>
                </View>
                <View style={styles.takeawayGridFooterRow}>
                  <Text style={styles.takeawayGridItemCount}>
                    {item.items.length} item{item.items.length === 1 ? '' : 's'}
                  </Text>
                  <Text style={styles.takeawayTotal}>₹{item.total}</Text>
                </View>
                <View style={styles.takeawayGridPrintNotch} pointerEvents="none" />
                <TouchableOpacity
                  style={styles.takeawayGridPrintFab}
                  onPress={() => setQuickPrintOrder(item)}
                  activeOpacity={0.8}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  accessibilityRole="button"
                  accessibilityLabel="Print"
                >
                  <Ionicons name="print-outline" size={18} color={QuinckleColors.primary} />
                </TouchableOpacity>
              </Pressable>
              );
            }}
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
          ) : (
          <FlatList
            data={takeawayListData}
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
                      <View style={styles.takeawayCustomerRow}>
                        {item.customerName ? (
                          <Text style={styles.takeawayCustomer}>{item.customerName}</Text>
                        ) : null}
                        {item.customerName && item.customerPhone ? (
                          <Text style={styles.takeawayCustomer}>·</Text>
                        ) : null}
                        {item.customerPhone ? (
                          <TouchableOpacity
                            onPress={() => { void Linking.openURL(`tel:${(item.customerPhone ?? '').replace(/[^0-9+]/g, '')}`); }}
                            hitSlop={{ top: 6, bottom: 6, left: 4, right: 10 }}
                            activeOpacity={0.7}
                            style={styles.takeawayPhoneBtn}
                          >
                            <Ionicons name="call-outline" size={12} color={QuinckleColors.primary} />
                            <Text style={styles.takeawayPhoneLink}>{item.customerPhone}</Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>
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
                        {takeawayPayLabel(item)}
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
                    {canDiscountTakeaway(item) && item.sessionId && (
                      <TouchableOpacity
                        style={styles.discountTakeawayBtn}
                        onPress={() => openAdjustBill(item)}
                        activeOpacity={0.8}
                        accessibilityLabel="Adjust bill"
                      >
                        <Ionicons
                          name="options-outline"
                          size={15}
                          color={QuinckleColors.textSecondary}
                        />
                      </TouchableOpacity>
                    )}
                    {canDiscountTakeaway(item) && (
                      <TouchableOpacity
                        style={styles.discountTakeawayBtn}
                        onPress={() => setDiscountOrder(item)}
                        activeOpacity={0.8}
                        accessibilityLabel={
                          (item.manualDiscount ?? 0) > 0 ? 'Edit discount' : 'Give discount'
                        }
                      >
                        <Ionicons
                          name="pricetag-outline"
                          size={15}
                          color={
                            (item.manualDiscount ?? 0) > 0
                              ? QuinckleColors.primary
                              : QuinckleColors.textSecondary
                          }
                        />
                      </TouchableOpacity>
                    )}
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
          )}
        </View>
      ) : activeTab === 'delivery' ? (
        <View style={styles.tabContent}>
          {/* The whole delivery board, framed as a tab: the dashboard keeps its
              top bar and side padding, the board brings the rest. */}
          {deliveryView === 'RIDER' ? <RiderRuns embedded /> : <DeliveryBoard embedded />}
        </View>
      ) : null}

      {/* End-of-service multi-select action bar — floats above the navbar. */}
      {activeTab === 'tables' && selectMode && (
        <View style={[styles.selectBar, { paddingBottom: insets.bottom + Spacing.sm }]}>
          <TouchableOpacity style={styles.selectCancel} onPress={exitSelectMode} activeOpacity={0.7}>
            <Text style={styles.selectCancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.selectFreeBtn, selectedIds.size === 0 && { opacity: 0.4 }]}
            onPress={() => { void freeSelectedTables(); }}
            disabled={selectedIds.size === 0}
            activeOpacity={0.85}
          >
            <Ionicons name="exit-outline" size={17} color="#fff" />
            <Text style={styles.selectFreeText}>
              {selectedIds.size === 0 ? 'Select tables to free' : `Free ${selectedIds.size} table${selectedIds.size === 1 ? '' : 's'}`}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* DUAL_CHANNEL "item ready" cards render in the staff _layout, above the
          whole Stack, so they stay visible on every staff screen. */}

      {/* Undo snackbar — reverses every free (single, group, or batch). */}
      <UndoSnackbar
        visible={!!undo}
        message={undo?.message ?? ''}
        busy={undoBusy}
        onUndo={() => { void undoLastFree(); }}
        onDismiss={() => setUndo(null)}
      />

      <SuccessToast message={placedMessage} onDismiss={() => setPlacedMessage(null)} />

      {/* left/width are driven by navFloatT (above) in real pixels instead of
          tracking `container`'s own instant flexBasis flip (60% split / 100%
          full) — that flip used to make the bar's width snap in one frame
          every time the tab changed; this makes it glide. Stays declared
          here (not hoisted out to a `container` sibling) so it keeps its
          original stacking position under every sheet/modal below that
          expects to cover it. */}
      <BottomNavbar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        tabs={navTabs}
        floating={split}
        animatedBox={{ left: navLeftAnim, width: navWidthAnim }}
      />

      {/* Filter tables — centered modal on tablet-landscape, bottom sheet elsewhere */}
      {isWide ? (
        <CenteredModal visible={filterVisible} onClose={() => setFilterVisible(false)} title="Filter tables">
          <View style={styles.sheetBody}>{filterChipRows}</View>
        </CenteredModal>
      ) : (
        <BottomSheet visible={filterVisible} onClose={() => setFilterVisible(false)} title="Filter tables">
          <View style={styles.sheetBody}>{filterChipRows}</View>
        </BottomSheet>
      )}

      {/* "When does it come back?" — asked every time an item is 86'd, so a
          dish is never lost to the menu because nobody remembered it. */}
      {isWide ? (
        <CenteredModal
          visible={!!eightySixTarget}
          onClose={() => setEightySixTarget(null)}
          title={eightySixTarget ? `When does ${eightySixTarget.name} come back?` : 'When does it come back?'}
        >
          <View style={styles.sheetBody}>{eightySixOptionRows}</View>
        </CenteredModal>
      ) : (
        <BottomSheet
          visible={!!eightySixTarget}
          onClose={() => setEightySixTarget(null)}
          title={eightySixTarget ? `When does ${eightySixTarget.name} come back?` : 'When does it come back?'}
        >
          <View style={styles.sheetBody}>{eightySixOptionRows}</View>
        </BottomSheet>
      )}

      {/* Tapping a free table starts the session immediately (see
          handleTablePress) — this overlay is the only feedback while it's
          in flight, no confirm step. */}
      <StartSessionOverlay job={startSessionJob} onDismiss={onDismissStartSession} />

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

      {/* Shared seating — pick a group's bill or seat a separate party */}
      <GroupPickerSheet
        visible={!!groupPicker}
        tableNum={String(groupPicker?.table.number ?? 0).padStart(2, '0')}
        groups={groupPicker?.groups ?? []}
        canAddParty={groupPicker?.canAddParty ?? false}
        submitting={seatingParty}
        onClose={() => { if (!seatingParty) setGroupPicker(null); }}
        onOpenGroup={(g) => {
          const t = groupPicker?.table;
          setGroupPicker(null);
          if (t) openGroupForTable(t, g as TableGroup, { forceLabel: (groupPicker?.groups.length ?? 0) > 1 });
        }}
        onSeatNewGroup={() => { if (groupPicker) void seatNewParty(groupPicker.table); }}
        onFreeGroup={(g) => {
          const t = groupPicker?.table;
          if (!t) return;
          // Last group leaving closes the sheet; otherwise keep it open on the
          // shrinking list.
          const remaining = (groupPicker?.groups ?? []).filter(x => x.session_id !== g.session_id);
          if (remaining.length <= 1) setGroupPicker(null);
          else setGroupPicker({ ...groupPicker!, groups: remaining });
          void freeOneGroup(t, g as TableGroup);
        }}
        onFreeTable={() => {
          const t = groupPicker?.table;
          setGroupPicker(null);
          if (t) void freeWholeTable({ id: t.id, number: t.number });
        }}
      />

      <ThemedDialog
        visible={dialog.visible}
        title={dialog.title}
        message={dialog.message}
        actions={dialog.actions}
        onClose={closeDialog}
      />


      {/* Tap-to-paper print progress */}
      <PrintProgressOverlay job={printJob} onDismiss={() => setPrintJob(null)} />

      {/* Grid card's own quick-print icon — a bare KOT/Invoice choice in a
          centered modal (not the panel's full bottom sheet with GSTIN
          capture), reusing the same PrintCard the panel's print sheet uses. */}
      <CenteredModal visible={!!quickPrintOrder} onClose={() => setQuickPrintOrder(null)} title="Print">
        <View style={styles.quickPrintGrid}>
          <PrintCard
            icon="restaurant-outline"
            label="Print KOT"
            onPress={() => { const o = quickPrintOrder; setQuickPrintOrder(null); if (o) void handlePrintTakeawayKot(o); }}
          />
          <PrintCard
            icon="receipt-outline"
            label="Print invoice"
            onPress={() => { const o = quickPrintOrder; setQuickPrintOrder(null); if (o) void handlePrintTakeawayInvoice(o); }}
          />
        </View>
      </CenteredModal>

      {discountOrder?.sessionId && (
        <GiveDiscountModal
          visible
          onClose={() => setDiscountOrder(null)}
          sessionId={discountOrder.sessionId}
          currentTotal={discountOrder.total ?? 0}
          currentManualDiscount={discountOrder.manualDiscount ?? 0}
          currentNote={discountOrder.manualDiscountNote ?? null}
          isAdmin={staffInfo?.role === 'ADMIN'}
          subtitle={
            discountOrder.pickupToken
              ? `Order ${discountOrder.pickupToken} · applies to the unpaid amount.`
              : "Applies to this order's unpaid amount."
          }
          onApplied={() => { void loadTakeawayOrders(); }}
          onError={(title, message) =>
            showDialog(title, message, [{ label: 'OK', onPress: () => {} }])
          }
        />
      )}

      <TakeawayManageSheet
        order={manageOrder}
        onClose={() => setManageOrder(null)}
        onDeleteItem={(itemId, reason) => deleteTakeawayItem(manageOrder!.orderId, itemId, reason)}
        onDeleteWholeOrder={requestDeleteWholeTakeaway}
        errorMessageFor={takeawayCancelMessage}
      />

      <ReasonSheet
        visible={!!deleteWholeTarget}
        title="Delete this order?"
        subject={deleteWholeTarget?.pickupToken ? `Order ${deleteWholeTarget.pickupToken}` : null}
        note="Every item in this order will be cancelled. This can't be undone."
        confirmLabel="Delete order"
        busy={deletingWhole}
        onConfirm={(reason) => void confirmDeleteWholeTakeaway(reason)}
        onClose={() => setDeleteWholeTarget(null)}
      />

      {/* Takeaway Edit: one reason for every removal on Save. */}
      <ReasonSheet
        visible={twReasonOpen}
        title="Take these off the order?"
        subject={(selectedTakeawayOrder?.items ?? [])
          .filter((row) => twDraft[takeawayRowKey(row)] != null && twQty(row) < row.qty)
          .map((row) => `${row.qty - twQty(row)}× ${row.name}`)
          .join(', ')}
        note={`₹${Math.round(twPlan.removedValue)} will be removed.${
          twPlan.additions.length > 0 ? ' The added items go to the kitchen as a new order.' : ''
        }`}
        confirmLabel="Remove"
        busy={twSaving}
        onConfirm={(reason) => {
          setTwReasonOpen(false);
          // Let the sheet close before a manager-PIN sheet can open over it.
          setTimeout(() => void twApply(reason), 220);
        }}
        onClose={() => setTwReasonOpen(false)}
      />
      {managerPinSheet}

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

      {/* Takeaway self-order QR — show to a customer who wants to order themselves */}
      <BottomSheet visible={takeawayQrOpen} onClose={() => setTakeawayQrOpen(false)} title="Takeaway QR">
        <View style={styles.takeawayQrBody}>
          <View style={styles.takeawayQrBox}>
            {takeawayOrderUrl ? <QRCode value={takeawayOrderUrl} size={200} /> : null}
          </View>
          <Text style={styles.takeawayQrHint}>Ask the customer to scan this to order takeaway themselves</Text>
        </View>
      </BottomSheet>

      {/* Desktop menu drawer. Last child, so it stacks above everything else on
          this screen. Navigating from it starts the push and the slide-out
          together — the incoming screen covers the panel as it leaves. */}
    </View>
      {split && (activeTab === 'tables' ? tablePanelJsx : takeawayPanelJsx)}

      {menuOpen && (
        <SlideDrawer width={460} onClosed={() => setMenuOpen(false)}>
          {(close) => (
            <MenuPanel
              variant="drawer"
              onClose={close}
              onNavigate={(route) => { close(); router.push(route as any); }}
            />
          )}
        </SlideDrawer>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, flexDirection: 'row', backgroundColor: QuinckleColors.background },
  container: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    backgroundColor: QuinckleColors.background,
  },
  // flexBasis, not width: the base style's `flex: 1` sets a 0 basis on web,
  // which beats `width` and collapsed this column to its content.
  containerSplit: { flexGrow: 0, flexShrink: 0, flexBasis: '60%' },

  // ── Wide layout: table grid + the fixed 40% side panel ──
  tablesRow: { flex: 1, flexDirection: 'row', gap: Spacing.lg },
  tablesFill: { flex: 1 },
  tablesGridPane: { flex: 1, minWidth: 0 },
  // A big rounded card inset from the window edge. The gap on its left comes
  // from the grid column's own right padding; the bottom margin matches the
  // floating navbar's so the two sit on the same baseline.
  tablePanelPane: {
    flex: 1,
    marginRight: Spacing.lg,
    marginBottom: Spacing.md,
    backgroundColor: QuinckleColors.surface,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    overflow: 'hidden',
  },
  tablePanelIdle: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    paddingHorizontal: Spacing.xl,
  },
  tablePanelIdleText: { ...Typography.caption, color: QuinckleColors.textTertiary, textAlign: 'center' },
  tablePanelAvailableTitle: { ...Typography.subtitle, color: QuinckleColors.textPrimary },
  tablePanelCta: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.md,
    backgroundColor: QuinckleColors.primary, paddingHorizontal: Spacing.xl, paddingVertical: 12,
    borderRadius: Radius.pill,
  },
  tablePanelCtaText: { ...Typography.bodyStrong, color: '#fff' },

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
  // "Back 6 AM" pill on a temporarily-86'd item row.
  backAtBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: Radius.sm,
    backgroundColor: QuinckleColors.surfaceMuted,
    marginRight: Spacing.sm,
  },
  backAtBadgeText: { color: QuinckleColors.textSecondary, fontSize: 11, fontWeight: '600' },
  sheetOptionText: { color: QuinckleColors.textSecondary, fontSize: 15, fontWeight: '500' },
  sheetOptionTextActive: { color: QuinckleColors.textPrimary, fontWeight: '700' },
  sheetOptionRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sheetOptionCount: { color: QuinckleColors.textTertiary, fontSize: 13, fontWeight: '600' },
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
  topBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    flexShrink: 1,
  },
  headerLogoSlot: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
  },
  headerLogo: {
    width: '100%',
    maxWidth: 102,
    height: 30,
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
    minWidth: 0,
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
  // Seating-zone section header. Only rendered when the restaurant actually
  // has zones, so a floor without them looks exactly as it always has.
  zoneHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
    marginBottom: 8,
  },
  zoneHeaderName: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: QuinckleColors.textSecondary,
  },
  zoneHeaderRule: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: QuinckleColors.border,
  },
  zoneHeaderCount: {
    fontSize: 11,
    fontWeight: '600',
    color: QuinckleColors.textTertiary,
    fontVariant: ['tabular-nums'],
  },
  // The grid cell owns the 2-column width; the card fills it.
  gridCell: {
    width: '48.5%',
    // Padded out (beyond a plain gap) so an occupied card's print notch —
    // which overhangs the card below tableCardOuter's own clipped box — has
    // room before the next row, same margin every cell gets for a
    // consistent row rhythm regardless of which ones show the button.
    marginBottom: Spacing.xxxl,
  },
  tableCardOuter: {
    width: '100%',
    // Matches the takeaway grid card's own minHeight (takeawayGridCard).
    minHeight: 156,
    borderRadius: Radius.lg + 1.5,
    padding: 1.5,
    overflow: 'hidden',
  },
  // Same notch + glass FAB as the takeaway grid card (index.tsx's
  // takeawayGridPrintNotch/Fab) — kept as its own copy since gridCell's
  // structure differs (tableCardOuter clips overflow for its gradient
  // border, so these sit outside it as gridCell's own children). One shared
  // shape for whichever quickAction a card gets — print, take-order '+', or
  // reactivate-play — only the icon and handler change.
  tableCardActionNotch: {
    position: 'absolute',
    left: '50%',
    bottom: -23,
    marginLeft: -23,
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: QuinckleColors.background,
  },
  twEditBar: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  twEditLink: { color: QuinckleColors.primary, fontSize: 13, fontWeight: '700' },
  twEditCancel: { color: QuinckleColors.textSecondary, fontSize: 13, fontWeight: '600' },
  twEditSave: { minWidth: 72, alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: QuinckleColors.primary },
  twEditSaveText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  twStepper: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: Spacing.sm },
  twStepBtn: {
    width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: QuinckleColors.borderSubtle, backgroundColor: QuinckleColors.surfaceMuted,
  },
  twStepBtnOff: { opacity: 0.3 },
  twStepQty: { minWidth: 22, textAlign: 'center', color: QuinckleColors.textPrimary, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  twStepRemove: {
    width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginLeft: 2,
    backgroundColor: QuinckleColors.dangerSoft,
  },
  twStruck: { textDecorationLine: 'line-through', color: QuinckleColors.textTertiary },
  tableCardActionFabPrinted: { backgroundColor: QuinckleColors.warning, borderColor: QuinckleColors.warning },
  tableCardActionFab: {
    position: 'absolute',
    left: '50%',
    bottom: -18,
    marginLeft: -18,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: QuinckleColors.surfaceMutedHover,
    borderWidth: 1.5,
    borderColor: QuinckleColors.borderStrong,
  },
  // Multi-select overlays.
  selectDim: { opacity: 0.35 },
  selectedOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: QuinckleColors.primarySoft,
    borderRadius: Radius.lg + 1.5,
    borderWidth: 1.5,
    borderColor: QuinckleColors.primary,
  },
  selectCheck: {
    position: 'absolute',
    top: 6,
    right: 6,
    zIndex: 2,
  },
  selectToggleActive: {
    backgroundColor: QuinckleColors.primarySoft,
    borderColor: QuinckleColors.primarySoftBorder,
  },
  selectBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    backgroundColor: QuinckleColors.surface,
    borderTopWidth: 1,
    borderTopColor: QuinckleColors.border,
    zIndex: 900,
  },
  selectCancel: {
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  selectCancelText: {
    ...Typography.bodyStrong,
    color: QuinckleColors.textSecondary,
  },
  selectFreeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    backgroundColor: QuinckleColors.danger,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
  },
  selectFreeText: {
    ...Typography.bodyStrong,
    color: '#fff',
    fontWeight: '700',
  },
  tableCard: {
    flex: 1,
    backgroundColor: QuinckleColors.background,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    minHeight: 156 - 3,
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
  // A real chip, not a bare row: expiryChipStyle supplies fill + border colour,
  // which need geometry to land on. Kept tight so a grid of cards doesn't bloat.
  cardTimer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginLeft: Spacing.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    borderWidth: 1,
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

  // Desktop/tablet-landscape Menu tab: category rail (20% width) + content pane,
  // same two-pane shape order-menu.tsx uses for its own category rail.
  menuRow: { flex: 1, flexDirection: 'row' },
  menuCategoryRail: { paddingRight: Spacing.md, flexGrow: 0, flexShrink: 0 },
  menuCategoryRailContent: { paddingVertical: Spacing.sm },
  menuRowDivider: { width: 1, backgroundColor: QuinckleColors.border, marginHorizontal: Spacing.sm },
  menuRightPane: { flex: 1 },
  menuRailItem: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingVertical: 12, paddingHorizontal: Spacing.md, borderRadius: Radius.md, marginBottom: 2,
  },
  menuRailItemActive: { backgroundColor: QuinckleColors.primarySoft },
  menuRailAccent: { width: 3, height: 20, borderRadius: 2, backgroundColor: 'transparent' },
  menuRailAccentActive: { backgroundColor: QuinckleColors.primary },
  menuRailText: { ...Typography.body, color: QuinckleColors.textSecondary, fontWeight: '500', flex: 1 },
  menuRailTextActive: { color: QuinckleColors.primary, fontWeight: '700' },

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
  // ── Desktop orders (serve queue): fixed 3-across tile grid, nothing
  //     stretches — see KOT_CARD_WIDTH/HEIGHT and PickupCard's fixed*
  //     props. Left-aligned with gaps; leftover row space stays empty. ──
  ordersGridRow: { gap: Spacing.md },
  segmentWrap: {
    marginBottom: Spacing.md,
  },
  // Wide takeaway toolbar: tabs + search + refresh + add, one row.
  takeawayToolbarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  // Fixed width so PickupSegmented's own flex:1 buttons resolve against a
  // known size instead of stretching to fill the row — the search box next
  // to it takes whatever's left.
  // The active tab's fill runs the container's full height edge to edge
  // (no inner padding), clipped to the container's own rounded corners via
  // overflow:hidden — not a pill floating inside a track.
  takeawayToolbarSeg: {
    width: 210,
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    backgroundColor: QuinckleColors.surfaceMuted,
  },
  twDropdownText: { fontSize: 13, fontWeight: '600', color: QuinckleColors.textPrimary },
  twDropdownCount: {
    minWidth: 20, paddingHorizontal: 5, height: 18, borderRadius: Radius.pill,
    backgroundColor: QuinckleColors.primarySoft, alignItems: 'center', justifyContent: 'center',
  },
  twDropdownCountText: { fontSize: 11, fontWeight: '700', color: QuinckleColors.primary },
  twDropdownBackdrop: { ...StyleSheet.absoluteFillObject },
  twDropdownMenu: {
    position: 'absolute',
    backgroundColor: QuinckleColors.surfaceElevated,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: QuinckleColors.borderStrong,
    overflow: 'hidden',
  },
  twDropdownRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm + 2,
  },
  twDropdownRowActive: { backgroundColor: QuinckleColors.primarySoft },
  twDropdownRowText: { fontSize: 13, fontWeight: '600', color: QuinckleColors.textSecondary },
  twDropdownRowTextActive: { color: QuinckleColors.primary },
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
  takeawayCustomerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  takeawayCustomer: {
    fontSize: 13,
    color: QuinckleColors.textSecondary,
  },
  takeawayPhoneBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  takeawayPhoneLink: {
    fontSize: 13,
    color: QuinckleColors.primary,
    fontWeight: '600',
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
  // Icon-only so it never crowds out "Collect Payment", which is the action the
  // counter reaches for on almost every order.
  discountTakeawayBtn: {
    width: 42,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    borderRadius: Radius.sm,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
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

  // ── Desktop takeaway: grid cards (left 60%) ──────────────────────────────
  takeawayGridRow: { gap: Spacing.sm },
  takeawayGridCard: {
    flex: 1,
    minHeight: 156,
    justifyContent: 'space-between',
    backgroundColor: QuinckleColors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    padding: Spacing.lg,
    // Extra clearance under the card (beyond the row's own gap) so the print
    // FAB, which overlaps the bottom edge, has room to sit in the space
    // between rows instead of overlapping the next row's cards.
    marginBottom: Spacing.xxxl,
  },
  takeawayGridCardActive: {
    borderColor: QuinckleColors.primary,
    backgroundColor: QuinckleColors.surfaceElevated,
  },
  takeawayGridFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.sm,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: QuinckleColors.borderSubtle,
  },
  takeawayGridItemCount: {
    fontSize: 12,
    color: QuinckleColors.textTertiary,
  },
  // Orange FAB peeking off the card's bottom edge, centered — the card has
  // no overflow:hidden, so it paints outside the card's own box; the card's
  // marginBottom above is padded out to give it room before the next row.
  // A same-center circle in the page's own background color, painted after
  // the card, "erases" a semicircular bite out of the card's bottom border —
  // the FAB then sits inside that bite instead of just overlapping the edge.
  takeawayGridPrintNotch: {
    position: 'absolute',
    left: '50%',
    bottom: -23,
    marginLeft: -23,
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: QuinckleColors.background,
  },
  takeawayGridPrintFab: {
    position: 'absolute',
    left: '50%',
    bottom: -18,
    marginLeft: -18,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: QuinckleColors.surfaceMutedHover,
    borderWidth: 1.5,
    borderColor: QuinckleColors.borderStrong,
  },
  quickPrintGrid: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.xl,
    gap: Spacing.md,
  },

  // ── Desktop takeaway: detail panel (fixed 40%) ───────────────────────────
  // Mirrors the table panel's command rail in [tableId].tsx (cmdHeader /
  // cmdRow / cmdBill / cmdRail) so the two right-hand panels read as one
  // design language instead of two different apps stitched together.
  twpSplit: { flex: 1, flexDirection: 'row' },
  twpMain: { flex: 1, minWidth: 0 },
  twpHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingLeft: Spacing.lg, paddingRight: Spacing.sm, paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: QuinckleColors.border,
  },
  twpTitle: { fontSize: 16, fontWeight: '700', color: QuinckleColors.textPrimary, letterSpacing: -0.3, flexShrink: 0 },
  twpTime: {
    fontSize: 12, fontWeight: '600', color: QuinckleColors.textSecondary,
    fontVariant: ['tabular-nums'] as any,
  },
  twpCloseBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },

  twpTicketHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.sm,
  },
  twpSectionLabel: {
    fontSize: 11, fontWeight: '700', color: QuinckleColors.textTertiary,
    textTransform: 'uppercase', letterSpacing: 1,
  },

  twpListContent: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm },
  twpRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingVertical: 7,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: QuinckleColors.borderSubtle,
  },
  twpRowQty: {
    width: 26, textAlign: 'right',
    fontSize: 12, fontWeight: '600', color: QuinckleColors.textMuted,
    fontVariant: ['tabular-nums'] as any,
  },
  twpRowBody: { flex: 1, minWidth: 0 },
  twpRowName: { fontSize: 13.5, fontWeight: '600', color: QuinckleColors.textPrimary },
  twpRowSub: { fontSize: 11, fontWeight: '500', color: QuinckleColors.textTertiary, marginTop: 1 },
  twpRowPrice: {
    fontSize: 12.5, fontWeight: '600', color: QuinckleColors.textSecondary,
    minWidth: 46, textAlign: 'right',
    fontVariant: ['tabular-nums'] as any,
  },

  twpBill: {
    paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.lg,
    borderTopWidth: 1, borderTopColor: QuinckleColors.border,
    backgroundColor: QuinckleColors.surface,
  },
  twpPayRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  twpPayLabel: { fontSize: 11, fontWeight: '700', color: QuinckleColors.textTertiary, textTransform: 'uppercase', letterSpacing: 1 },
  twpPayRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  twpPayValue: {
    fontSize: 22, fontWeight: '700', color: QuinckleColors.textPrimary, letterSpacing: -0.5,
    fontVariant: ['tabular-nums'] as any,
  },
  twpPaidBadge: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: Spacing.md, paddingVertical: 12, borderRadius: Radius.md, borderWidth: 1,
  },
  twpPaidBadgeSuccess: { backgroundColor: QuinckleColors.successSoft, borderColor: QuinckleColors.successBorder },
  twpPaidText: { fontSize: 14, fontWeight: '700' },
  twpCollectBtn: {
    backgroundColor: QuinckleColors.primary,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    paddingVertical: 11, borderRadius: Radius.md, marginTop: Spacing.md,
  },
  twpCollectBtnDisabled: { opacity: 0.5 },
  twpCollectText: { color: '#fff', fontSize: 13.5, fontWeight: '700' },

  twpRail: {
    width: 60,
    alignItems: 'center',
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.lg,
    gap: 4,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: QuinckleColors.border,
    backgroundColor: QuinckleColors.surface,
  },
  twpRailBtn: {
    width: 54,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    borderRadius: Radius.sm,
  },
  twpRailLabel: { fontSize: 9, fontWeight: '600', color: QuinckleColors.textTertiary, letterSpacing: 0.1 },
});
