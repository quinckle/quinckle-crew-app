/**
 * order-menu.tsx — Full-screen manual order screen for crew staff.
 *
 * Navigated to from [tableId].tsx via router.push.
 * Handles the complete flow: menu → cart → identity → payment.
 *
 * Features:
 *  - Category dropdown next to search bar (not a chips row)
 *  - Item image + veg/non-veg icon + real & discounted price + discount % badge
 *  - Collapsible per-item note input
 *  - KeyboardAvoidingView so search bar never hides behind keyboard
 *  - Modifier bottom sheet (BottomSheet component)
 *  - Identity modal → CollectionSheet for payment
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  KeyboardAvoidingView,
  LayoutAnimation,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  UIManager,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useResponsive } from '../../hooks/useResponsive';
import { useAuth } from '../../context/AuthContext';
import { QuinckleColors, Radius, Spacing, Typography } from '../../constants/Colors';
import {
  crewSessions, crewOrders, crewDiners, crewMemberships, restaurantApi, crewOffers,
} from '../../services/api';
import type { MenuItem, ModifierGroup, CrewOffer } from '../../services/api';
import { BottomSheet } from '../../components/ui/BottomSheet';
import { CartReviewSheet, type CartLine } from '../../components/ui/CartReviewSheet';
import { Skeleton } from '../../components/ui/Skeleton';
import { readCache, writeCache, cacheKeys } from '../../services/dataCache';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// Smooth reflow when the CRM card (visits/membership) appears below the guest
// name field, pushing the Place Order button down instead of it snapping.
const GUEST_CRM_LAYOUT_PRESET = {
  duration: 320,
  create: { type: LayoutAnimation.Types.easeOut, property: LayoutAnimation.Properties.opacity },
  update: { type: LayoutAnimation.Types.spring, springDamping: 0.8 },
  delete: { duration: 200, type: LayoutAnimation.Types.easeIn, property: LayoutAnimation.Properties.opacity },
};

// ── Veg / Non-veg icon (Indian standard) ─────────────────────────────────────

function VegIcon({ isVeg }: { isVeg: boolean }) {
  const color = isVeg ? '#22c55e' : '#dc2626';
  return (
    <View style={[vegStyles.outer, { borderColor: color }]}>
      <View style={[vegStyles.inner, { backgroundColor: color }]} />
    </View>
  );
}
const vegStyles = StyleSheet.create({
  outer: { width: 14, height: 14, borderWidth: 1.5, borderRadius: 2, alignItems: 'center', justifyContent: 'center' },
  inner: { width: 6, height: 6, borderRadius: 3 },
});

// ── Skeleton row ──────────────────────────────────────────────────────────────

function ItemSkeleton() {
  return (
    <View style={styles.itemRow}>
      <Skeleton width={76} height={76} radius={Radius.md} style={{ flexShrink: 0 }} />
      <View style={{ flex: 1, paddingLeft: Spacing.md, gap: 8 }}>
        <Skeleton width="70%" height={15} />
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
          <Skeleton width={14} height={14} radius={2} />
          <Skeleton width={56} height={11} radius={Radius.pill} />
        </View>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <Skeleton width={48} height={16} />
          <Skeleton width={38} height={13} />
        </View>
      </View>
      <Skeleton width={68} height={34} radius={Radius.md} style={{ flexShrink: 0 }} />
    </View>
  );
}

// ── Menu item row ─────────────────────────────────────────────────────────────

// media.quinckle.com uploads have Sharp-generated R2 variants (same convention
// as the diner web themes): `<base>.webp-thumb.webp` is the 400px thumb —
// plenty for this 76px render at 3x DPR. Legacy uploads without variants fall
// back to the base URL via onError.
const menuThumbUrl = (url: string) =>
  url.includes('media.quinckle.com') && url.endsWith('.webp') ? `${url}-thumb.webp` : url;

// Memoized so a cart tap only re-renders the touched row, not every visible
// one. All props are per-row slices; callbacks must be identity-stable.
const MenuItemRow = React.memo(function MenuItemRow({
  item, qty, note, noteOpen, mods, onAdd, onRemove, onToggleNote, onChangeNote,
}: {
  item: MenuItem;
  qty: number;
  note: string;
  noteOpen: boolean;
  mods: { groupId: string; optionId: string }[] | undefined;
  onAdd: (item: MenuItem) => void;
  onRemove: (itemId: string) => void;
  onToggleNote: (itemId: string) => void;
  onChangeNote: (itemId: string, text: string) => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const hasImage = !!item.imageUrl;
  const price = parseFloat(item.price);
  const origPrice = item.originalPrice ? parseFloat(item.originalPrice) : null;
  const discountPct = origPrice && origPrice > price
    ? Math.round(((origPrice - price) / origPrice) * 100) : 0;

  const modSummary = (() => {
    if (!mods?.length) return null;
    return mods.map(({ groupId, optionId }) => {
      const g = item.modifierGroups?.find(g => g.id === groupId);
      return g?.options.find(o => o.id === optionId)?.name;
    }).filter(Boolean).join(', ') || null;
  })();

  return (
    <View style={styles.itemRow}>
      {/* Image — disk-cached thumb variant; base URL if the variant 404s */}
      {hasImage ? (
        <Image
          source={{ uri: imgFailed ? item.imageUrl! : menuThumbUrl(item.imageUrl!) }}
          style={styles.itemImg}
          contentFit="cover"
          cachePolicy="disk"
          transition={0}
          onError={() => setImgFailed(true)}
        />
      ) : (
        <View style={styles.itemImgPlaceholder}>
          <Ionicons name="fast-food-outline" size={26} color={QuinckleColors.textMuted} />
        </View>
      )}

      {/* Info col */}
      <View style={styles.itemInfo}>
        <Text style={styles.itemName} numberOfLines={2}>{item.name}</Text>

        {/* Meta row: veg icon + category */}
        <View style={styles.itemMeta}>
          <VegIcon isVeg={item.isVeg} />
          <View style={styles.catChip}>
            <Text style={styles.catChipText} numberOfLines={1}>{item.category}</Text>
          </View>
          {(item.modifierGroups?.length ?? 0) > 0 && (
            <Text style={styles.optionsLabel}>+ options</Text>
          )}
        </View>

        {/* Price row */}
        <View style={styles.priceRow}>
          <Text style={styles.price}>₹{price.toFixed(0)}</Text>
          {origPrice && discountPct > 0 && (
            <>
              <Text style={styles.originalPrice}>₹{origPrice.toFixed(0)}</Text>
              <View style={styles.discountBadge}>
                <Text style={styles.discountText}>{discountPct}% OFF</Text>
              </View>
            </>
          )}
        </View>

        {/* Modifier summary */}
        {modSummary ? <Text style={styles.modSummary} numberOfLines={1}>{modSummary}</Text> : null}

        {/* Note toggle — always rendered to reserve height, invisible when qty=0 */}
        <TouchableOpacity
          style={[styles.noteToggle, qty === 0 && { opacity: 0 }]}
          onPress={() => qty > 0 && onToggleNote(item.id)}
          activeOpacity={qty > 0 ? 0.7 : 1}
        >
          <Ionicons
            name={noteOpen ? 'chevron-up' : 'create-outline'}
            size={12}
            color={QuinckleColors.textMuted}
          />
          <Text style={styles.noteToggleText}>
            {noteOpen ? 'Hide note' : note ? `Note: ${note}` : 'Add note'}
          </Text>
        </TouchableOpacity>
        {qty > 0 && noteOpen && (
          <TextInput
            style={styles.noteInput}
            placeholder="e.g. no onions, extra spicy…"
            placeholderTextColor={QuinckleColors.textMuted}
            value={note}
            onChangeText={text => onChangeNote(item.id, text)}
            returnKeyType="done"
            autoFocus
          />
        )}
      </View>

      {/* Qty control */}
      <View style={styles.qtyWrap}>
        {qty > 0 ? (
          <View style={styles.qtyControl}>
            <TouchableOpacity onPress={() => onRemove(item.id)} style={styles.qtyBtn} hitSlop={6}>
              <Ionicons name="remove" size={16} color={QuinckleColors.primary} />
            </TouchableOpacity>
            <Text style={styles.qtyText}>{qty}</Text>
            <TouchableOpacity onPress={() => onAdd(item)} style={styles.qtyBtn} hitSlop={6}>
              <Ionicons name="add" size={16} color={QuinckleColors.primary} />
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity onPress={() => onAdd(item)} style={styles.addBtn} activeOpacity={0.8}>
            <Ionicons name="add" size={15} color={QuinckleColors.primary} />
            <Text style={styles.addBtnText}>Add</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
});

// ── Menu item card (tablet-landscape POS grid) ───────────────────────────────

// Square-ish tile used in the wide two-pane grid: image on top with a veg
// badge + discount overlay, name/price below, and an Add / qty control docked
// to the bottom edge so every card is the same height regardless of name len.
const MenuItemCard = React.memo(function MenuItemCard({
  item, qty, onAdd, onRemove,
}: {
  item: MenuItem;
  qty: number;
  onAdd: (item: MenuItem) => void;
  onRemove: (itemId: string) => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const hasImage = !!item.imageUrl;
  const price = parseFloat(item.price);
  const origPrice = item.originalPrice ? parseFloat(item.originalPrice) : null;
  const discountPct = origPrice && origPrice > price
    ? Math.round(((origPrice - price) / origPrice) * 100) : 0;
  const hasMods = (item.modifierGroups?.length ?? 0) > 0;

  return (
    <View style={[cardStyles.card, qty > 0 && cardStyles.cardActive]}>
      {/* Image */}
      <View style={cardStyles.imgWrap}>
        {hasImage ? (
          <Image
            source={{ uri: imgFailed ? item.imageUrl! : menuThumbUrl(item.imageUrl!) }}
            style={cardStyles.img}
            contentFit="cover"
            cachePolicy="disk"
            transition={0}
            onError={() => setImgFailed(true)}
          />
        ) : (
          <View style={[cardStyles.img, cardStyles.imgPlaceholder]}>
            <Ionicons name="fast-food-outline" size={30} color={QuinckleColors.textMuted} />
          </View>
        )}
        <View style={cardStyles.vegBadge}>
          <VegIcon isVeg={item.isVeg} />
        </View>
        {discountPct > 0 && (
          <View style={cardStyles.discountBadge}>
            <Text style={cardStyles.discountText}>{discountPct}% OFF</Text>
          </View>
        )}
      </View>

      {/* Body */}
      <View style={cardStyles.body}>
        <Text style={cardStyles.name} numberOfLines={2}>{item.name}</Text>
        <View style={cardStyles.priceRow}>
          <Text style={cardStyles.price}>₹{price.toFixed(0)}</Text>
          {origPrice && discountPct > 0 && (
            <Text style={cardStyles.originalPrice}>₹{origPrice.toFixed(0)}</Text>
          )}
          {hasMods && <Text style={cardStyles.optionsLabel}>+ options</Text>}
        </View>

        {/* Add / qty control — docked at the bottom */}
        {qty > 0 ? (
          <View style={cardStyles.qtyControl}>
            <TouchableOpacity onPress={() => onRemove(item.id)} style={cardStyles.qtyBtn} hitSlop={6}>
              <Ionicons name="remove" size={18} color={QuinckleColors.primary} />
            </TouchableOpacity>
            <Text style={cardStyles.qtyText}>{qty}</Text>
            <TouchableOpacity onPress={() => onAdd(item)} style={cardStyles.qtyBtn} hitSlop={6}>
              <Ionicons name="add" size={18} color={QuinckleColors.primary} />
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity onPress={() => onAdd(item)} style={cardStyles.addBtn} activeOpacity={0.85}>
            <Ionicons name="add" size={16} color="#fff" />
            <Text style={cardStyles.addBtnText}>Add</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
});

const cardStyles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: QuinckleColors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    overflow: 'hidden',
  },
  cardActive: { borderColor: QuinckleColors.primarySoftBorder },
  imgWrap: { width: '100%', aspectRatio: 1.3, backgroundColor: QuinckleColors.surfaceElevated },
  img: { width: '100%', height: '100%' },
  imgPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  vegBadge: {
    position: 'absolute', top: 6, left: 6,
    backgroundColor: QuinckleColors.surface, borderRadius: 4, padding: 2,
  },
  discountBadge: {
    position: 'absolute', top: 6, right: 6,
    backgroundColor: QuinckleColors.successSoft, borderRadius: Radius.pill,
    paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: QuinckleColors.successBorder,
  },
  discountText: { fontSize: 10, fontWeight: '700', color: QuinckleColors.success },
  body: { padding: Spacing.md, gap: 6, flex: 1 },
  name: { ...Typography.caption, color: QuinckleColors.textPrimary, fontWeight: '600', lineHeight: 17, minHeight: 34 },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  price: { fontSize: 15, fontWeight: '700', color: QuinckleColors.primary, letterSpacing: -0.3 },
  originalPrice: { fontSize: 12, color: QuinckleColors.textMuted, textDecorationLine: 'line-through' },
  optionsLabel: { fontSize: 10, fontWeight: '600', color: QuinckleColors.primary },
  addBtn: {
    marginTop: 'auto', flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 4, backgroundColor: QuinckleColors.primary, borderRadius: Radius.md, height: 38,
  },
  addBtnText: { fontSize: 14, color: '#fff', fontWeight: '700' },
  qtyControl: {
    marginTop: 'auto', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: QuinckleColors.primarySoft, borderRadius: Radius.md,
    borderWidth: 1, borderColor: QuinckleColors.primarySoftBorder, height: 38, overflow: 'hidden',
  },
  qtyBtn: { width: 44, height: '100%', alignItems: 'center', justifyContent: 'center' },
  qtyText: { ...Typography.body, color: QuinckleColors.primary, fontWeight: '700', minWidth: 20, textAlign: 'center' },
});

// ── Modifier bottom sheet ─────────────────────────────────────────────────────

function ModifierSheet({
  item, pending, onToggle, onConfirm, onCancel,
}: {
  item: MenuItem | null;
  pending: Record<string, string[]>;
  onToggle: (gId: string, oId: string, max: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <BottomSheet visible={!!item} onClose={onCancel} title={item?.name ?? ''} maxHeightRatio={0.75}>
      {item?.modifierGroups?.map((group: ModifierGroup) => (
        <View key={group.id} style={styles.modGroup}>
          <View style={styles.modGroupHeader}>
            <Text style={styles.modGroupName}>{group.name}</Text>
            <Text style={styles.modGroupHint}>
              {group.minSelections > 0 ? 'Required · ' : ''}
              {group.maxSelections === 1 ? 'Pick 1' : `Up to ${group.maxSelections}`}
            </Text>
          </View>
          {group.options.map(opt => {
            const selected = (pending[group.id] ?? []).includes(opt.id);
            const adj = parseFloat(opt.priceAdjustment ?? '0');
            return (
              <TouchableOpacity
                key={opt.id}
                style={[styles.modOption, selected && styles.modOptionActive]}
                onPress={() => onToggle(group.id, opt.id, group.maxSelections)}
                activeOpacity={0.75}
              >
                <View style={[styles.modCheck, selected && styles.modCheckActive,
                  group.maxSelections === 1 && { borderRadius: 9 }]}>
                  {selected && <Ionicons name="checkmark" size={11} color="#fff" />}
                </View>
                <Text style={styles.modOptionName}>{opt.name}</Text>
                {adj !== 0 && (
                  <Text style={[styles.modAdj, adj < 0 && { color: QuinckleColors.success }]}>
                    {adj > 0 ? '+' : ''}₹{Math.abs(adj).toFixed(0)}
                  </Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
      <TouchableOpacity style={styles.modConfirmBtn} onPress={onConfirm} activeOpacity={0.85}>
        <Text style={styles.modConfirmText}>Add to order</Text>
      </TouchableOpacity>
    </BottomSheet>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

// Left category rail width in the tablet-landscape two-pane layout.
const RAIL_WIDTH = 208;

export default function OrderMenuScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { staffInfo } = useAuth();
  const { isWide, width, contentMaxWidth } = useResponsive();

  // Grid columns for the wide POS layout — target ~200dp per card in the space
  // left of the category rail, clamped so cards never get comically wide/thin.
  const gridColumns = useMemo(() => {
    const avail = width - RAIL_WIDTH - Spacing.xl * 2;
    return Math.max(2, Math.min(5, Math.floor(avail / 200)));
  }, [width]);

  const {
    tableId,
    tableNum: paramTableNum,
    tableDbId,
    sessionId,
    customerPhone: paramPhone,
    customerName: paramName,
    channel: paramChannel,
    pickupToken: paramPickupToken,
  } = useLocalSearchParams<{
    tableId: string;
    tableNum: string;
    tableDbId: string;
    sessionId: string;
    customerPhone: string;
    customerName: string;
    channel: string;
    pickupToken: string;
  }>();

  const isTakeaway = paramChannel === 'TAKEAWAY';
  const pickupToken = paramPickupToken || null;
  const tableNum = paramTableNum ?? String(tableId ?? '').padStart(2, '0');

  // ── Menu data ──────────────────────────────────────────────────────────────
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [offers, setOffers] = useState<CrewOffer[]>([]);
  const [priorSubtotal, setPriorSubtotal] = useState(0);
  const [menuCategories, setMenuCategories] = useState<string[]>(['All']);
  const [isMenuLoading, setIsMenuLoading] = useState(true);

  // ── Filter state ───────────────────────────────────────────────────────────
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const [catDropOpen, setCatDropOpen] = useState(false);

  // ── Cart ───────────────────────────────────────────────────────────────────
  const [cart, setCart] = useState<Record<string, number>>({});
  const [cartNotes, setCartNotes] = useState<Record<string, string>>({});
  const [cartModifiers, setCartModifiers] = useState<Record<string, { groupId: string; optionId: string }[]>>({});
  const [noteExpanded, setNoteExpanded] = useState<Record<string, boolean>>({});
  const [reviewOpen, setReviewOpen] = useState(false);

  // ── Modifiers ──────────────────────────────────────────────────────────────
  const [modifierItem, setModifierItem] = useState<MenuItem | null>(null);
  const [pendingMods, setPendingMods] = useState<Record<string, string[]>>({});

  // ── Footer animation refs (effect wired after cartCount is declared below) ──
  const footerAnim = useRef(new Animated.Value(0)).current;
  const [footerMounted, setFooterMounted] = useState(false);

  // ── Checkout / Identity ────────────────────────────────────────────────────
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [coPhone, setCoPhone] = useState('');
  const [coName, setCoName] = useState('');
  const [coLooking, setCoLooking] = useState(false);
  const [coFound, setCoFound] = useState<boolean | null>(null);
  const [coLookupFailed, setCoLookupFailed] = useState(false);
  const [coVisits, setCoVisits] = useState<number | null>(null);
  const [coMember, setCoMember] = useState<boolean | null>(null);
  // Brief "order placed" confirmation shown before opening payment collection.
  const [placed, setPlaced] = useState<{ amount: number } | null>(null);
  const navTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (navTimerRef.current) clearTimeout(navTimerRef.current); }, []);
  // Card scale/fade-in, then the checkmark pops in a beat later — makes the
  // wait before payment-collect feel shorter than a static "Order placed" card.
  const placedCardAnim = useRef(new Animated.Value(0)).current;
  const placedTickAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!placed) return;
    placedCardAnim.setValue(0);
    placedTickAnim.setValue(0);
    Animated.spring(placedCardAnim, {
      toValue: 1, damping: 16, stiffness: 220, mass: 0.7, useNativeDriver: true,
    }).start();
    Animated.spring(placedTickAnim, {
      toValue: 1, damping: 9, stiffness: 200, mass: 0.6, delay: 100, useNativeDriver: true,
    }).start();
  }, [placed, placedCardAnim, placedTickAnim]);
  const [coSubmitting, setCoSubmitting] = useState(false);
  const [coError, setCoError] = useState<string | null>(null);

  // Keep session customer for pre-fill
  const [sessionCustomerPhone, setSessionCustomerPhone] = useState(paramPhone || null);
  const [sessionCustomerName, setSessionCustomerName] = useState(paramName || null);

  // ── Load menu + offers on mount — stale-while-revalidate ──────────────────
  // The cached copy paints instantly (no skeleton on repeat opens); the fresh
  // fetch always runs and replaces it, so the list is at most one open stale.
  useEffect(() => {
    const rid = staffInfo?.restaurantId;
    if (!rid) return;
    const channel = isTakeaway ? 'TAKEAWAY' : 'CREW';
    let cancelled = false;
    let freshLanded = false;

    const applyMenu = (cats: any[]) => {
      const items = cats.flatMap((c: any) =>
        (c.items ?? []).map((i: any) => ({ ...i, category: i.category || c.name }))
      ).filter((i: any) => i.isAvailable !== false);
      setMenuItems(items);
      setMenuCategories(['All', ...cats.map((c: any) => c.name).filter(Boolean)]);
      setIsMenuLoading(false);
    };

    setIsMenuLoading(true);
    readCache<any[]>(cacheKeys.crewOrderMenu(rid, channel)).then(cats => {
      if (!cancelled && !freshLanded && cats?.length) applyMenu(cats);
    });

    // 'CREW' → dine-in menu + crew-only special charges (e.g. birthday fees)
    // that diners never see but staff can add to a bill.
    // Takeaway sessions get the TAKEAWAY menu so per-channel availability is
    // respected (CREW-only special charges stay dine-in).
    restaurantApi.getMenu(rid, channel)
      .then(res => {
        const cats: any[] = (res as any)?.data ?? [];
        writeCache(cacheKeys.crewOrderMenu(rid, channel), cats);
        if (cancelled) return;
        freshLanded = true;
        applyMenu(cats);
      })
      .catch(() => { if (!cancelled) setIsMenuLoading(false); });

    // Offers list is cacheable per restaurant; sessionSubtotalBeforeCart is
    // session-specific so it only ever comes from the fresh response.
    readCache<CrewOffer[]>(cacheKeys.crewOffers(rid)).then(cached => {
      if (!cancelled && cached) setOffers(prev => (prev.length ? prev : cached));
    });
    crewOffers.list(sessionId)
      .then(res => {
        const d = (res as any)?.data;
        if (d?.offers) writeCache(cacheKeys.crewOffers(rid), d.offers);
        if (cancelled) return;
        setOffers(d?.offers ?? []);
        setPriorSubtotal(Number(d?.sessionSubtotalBeforeCart ?? 0));
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [staffInfo?.restaurantId, sessionId, isTakeaway]);

  // ── Cart helpers — identity-stable so MenuItemRow's React.memo holds ───────
  const addToCart = useCallback((itemId: string, mods?: { groupId: string; optionId: string }[]) => {
    setCart(prev => ({ ...prev, [itemId]: (prev[itemId] ?? 0) + 1 }));
    if (mods) setCartModifiers(prev => ({ ...prev, [itemId]: mods }));
  }, []);

  const removeFromCart = useCallback((itemId: string) => {
    setCart(prev => {
      const qty = (prev[itemId] ?? 0) - 1;
      if (qty <= 0) {
        const next = { ...prev }; delete next[itemId];
        setCartModifiers(pm => { const nm = { ...pm }; delete nm[itemId]; return nm; });
        setNoteExpanded(ne => { const nn = { ...ne }; delete nn[itemId]; return nn; });
        return next;
      }
      return { ...prev, [itemId]: qty };
    });
  }, []);

  const cartTotal = useMemo(() => Object.entries(cart).reduce((sum, [id, qty]) => {
    const item = menuItems.find(m => m.id === id);
    let base = parseFloat(item?.price ?? '0') * qty;
    (cartModifiers[id] ?? []).forEach(({ groupId, optionId }) => {
      const g = item?.modifierGroups?.find(g => g.id === groupId);
      const opt = g?.options.find(o => o.id === optionId);
      if (opt) base += parseFloat(opt.priceAdjustment ?? '0') * qty;
    });
    return sum + base;
  }, 0), [cart, menuItems, cartModifiers]);

  // Flattened cart lines for the review sheet — one entry per cart key (an item
  // keeps a single line regardless of qty), with its modifier-adjusted unit
  // price and a readable modifier summary.
  const cartLines = useMemo<CartLine[]>(() => Object.entries(cart).map(([id, qty]) => {
    const item = menuItems.find(m => m.id === id);
    const mods = cartModifiers[id] ?? [];
    let unit = parseFloat(item?.price ?? '0');
    const names: string[] = [];
    mods.forEach(({ groupId, optionId }) => {
      const g = item?.modifierGroups?.find(g => g.id === groupId);
      const opt = g?.options.find(o => o.id === optionId);
      if (opt) { unit += parseFloat(opt.priceAdjustment ?? '0'); if (opt.name) names.push(opt.name); }
    });
    return {
      id,
      name: item?.name ?? 'Item',
      qty,
      unitPrice: unit,
      lineTotal: unit * qty,
      modSummary: names.length ? names.join(', ') : null,
      note: cartNotes[id]?.trim() || null,
      imageUrl: item?.imageUrl ?? null,
    };
  }), [cart, menuItems, cartModifiers, cartNotes]);

  // Spend-threshold offer nudge: nearest unmet offer (or best already-unlocked).
  // Item-triggered offers are skipped here (no "remaining amount" to show).
  const offerNudge = useMemo(() => {
    const reward = (o: CrewOffer) =>
      o.type === 'PERCENTAGE_OFF' ? `${o.discountPct}% off`
      : o.type === 'FLAT_OFF'     ? `₹${o.discountFlat} off`
      : 'a free item';
    const spendOffers = offers.filter(o => o.minOrderValue != null && o.minOrderValue > 0);
    if (spendOffers.length === 0) return null;

    // Same threshold base the discount engine uses: prior orders on the table
    // + the current cart.
    const base = priorSubtotal + cartTotal;

    const locked = spendOffers
      .filter(o => base < (o.minOrderValue as number))
      .sort((a, b) => (a.minOrderValue as number) - (b.minOrderValue as number));
    if (locked.length > 0) {
      const o = locked[0];
      const min = o.minOrderValue as number;
      return {
        unlocked: false,
        name: o.name,
        reward: reward(o),
        remaining: Math.max(0, Math.round(min - base)),
        progress: Math.max(0, Math.min(base / min, 1)),
      };
    }
    // All spend offers met → celebrate the highest-threshold one.
    const best = spendOffers.sort((a, b) => (b.minOrderValue as number) - (a.minOrderValue as number))[0];
    return { unlocked: true, name: best.name, reward: reward(best), remaining: 0, progress: 1 };
  }, [offers, cartTotal, priorSubtotal]);

  // ── Offer nudge animations ──────────────────────────────────────────────────
  const offerProgressAnim = useRef(new Animated.Value(0)).current; // 0→1 bar fill
  const offerUnlockAnim   = useRef(new Animated.Value(0)).current; // 0=orange, 1=green
  const offerSectionAnim  = useRef(new Animated.Value(0)).current; // mount/expand
  const [nudgeMounted, setNudgeMounted] = useState(false);
  const lastNudge = useRef(offerNudge);
  if (offerNudge) lastNudge.current = offerNudge; // keep latest for exit frames

  // Animate the bar fill (smooth left/right) + colour (orange ⇄ green).
  useEffect(() => {
    if (!offerNudge) return;
    Animated.spring(offerProgressAnim, { toValue: offerNudge.progress, useNativeDriver: false, damping: 18, stiffness: 140, mass: 0.7 }).start();
    Animated.timing(offerUnlockAnim, { toValue: offerNudge.unlocked ? 1 : 0, duration: 320, useNativeDriver: false }).start();
  }, [offerNudge, offerProgressAnim, offerUnlockAnim]);

  // Smoothly reveal / collapse the whole section as offers (dis)appear.
  useEffect(() => {
    if (offerNudge) {
      setNudgeMounted(true);
      Animated.spring(offerSectionAnim, { toValue: 1, useNativeDriver: false, damping: 20, stiffness: 200, mass: 0.8 }).start();
    } else if (nudgeMounted) {
      Animated.timing(offerSectionAnim, { toValue: 0, duration: 200, useNativeDriver: false })
        .start(({ finished }) => { if (finished) setNudgeMounted(false); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!offerNudge]);

  const cartCount = useMemo(() =>
    Object.values(cart).reduce((a, b) => a + b, 0), [cart]);

  // ── Footer spring-in / slide-out ─────────────────────────────────────────
  useEffect(() => {
    if (cartCount > 0 && !footerMounted) {
      setFooterMounted(true);
      Animated.spring(footerAnim, { toValue: 1, damping: 22, stiffness: 280, useNativeDriver: true }).start();
    } else if (cartCount > 0) {
      Animated.spring(footerAnim, { toValue: 1, damping: 22, stiffness: 280, useNativeDriver: true }).start();
    } else if (cartCount === 0 && footerMounted) {
      Animated.timing(footerAnim, { toValue: 0, duration: 160, useNativeDriver: true }).start(() => {
        setFooterMounted(false);
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartCount]);

  // ── Add item (with modifier check) ────────────────────────────────────────
  const handleAddPress = useCallback((item: MenuItem) => {
    if ((item.modifierGroups?.length ?? 0) > 0) {
      const init: Record<string, string[]> = {};
      item.modifierGroups!.forEach(g => { init[g.id] = []; });
      setPendingMods(init);
      setModifierItem(item);
    } else {
      addToCart(item.id);
    }
  }, [addToCart]);

  const handleToggleNote = useCallback((itemId: string) => {
    setNoteExpanded(prev => ({ ...prev, [itemId]: !prev[itemId] }));
  }, []);

  const handleChangeNote = useCallback((itemId: string, text: string) => {
    setCartNotes(prev => ({ ...prev, [itemId]: text }));
  }, []);

  const handleToggleMod = (gId: string, oId: string, max: number) => {
    setPendingMods(prev => {
      const cur = prev[gId] ?? [];
      if (cur.includes(oId)) return { ...prev, [gId]: cur.filter(id => id !== oId) };
      if (max === 1) return { ...prev, [gId]: [oId] };
      if (cur.length >= max) return prev;
      return { ...prev, [gId]: [...cur, oId] };
    });
  };

  const handleConfirmMods = () => {
    if (!modifierItem) return;
    const flat: { groupId: string; optionId: string }[] = [];
    Object.entries(pendingMods).forEach(([gId, opts]) =>
      opts.forEach(oId => flat.push({ groupId: gId, optionId: oId })));
    addToCart(modifierItem.id, flat);
    setModifierItem(null);
  };

  // ── Filtered list ──────────────────────────────────────────────────────────
  const filteredItems = useMemo(() => menuItems.filter(item => {
    const matchSearch = item.name.toLowerCase().includes(search.toLowerCase());
    const matchCat = activeCategory === 'All' || item.category === activeCategory;
    return matchSearch && matchCat;
  }), [menuItems, search, activeCategory]);

  // ── Checkout (identity) ────────────────────────────────────────────────────
  const openCheckout = () => {
    setCoError(null);
    setCoVisits(null); setCoMember(null);
    if (sessionCustomerPhone) {
      const digits = sessionCustomerPhone.replace(/\D/g, '').slice(-10);
      setCoPhone(digits.length === 10 ? digits : '');
      setCoName(sessionCustomerName ?? '');
      setCoFound(digits.length === 10 ? true : null);
      if (digits.length === 10) void lookupGuest(digits, { keepName: true });
    } else {
      setCoPhone(''); setCoName(''); setCoFound(null);
    }
    setCheckoutOpen(true);
  };

  // Looks up diner history (visit count) and membership status in parallel.
  // `keepName` is used when re-opening for an already-known session customer,
  // so a slower membership lookup can't blank out the name field meanwhile.
  const lookupGuest = async (digits: string, opts?: { keepName?: boolean }) => {
    setCoLooking(true);
    const [dinerRes, memberRes] = await Promise.allSettled([
      crewDiners.lookup(digits),
      crewMemberships.lookup(digits),
    ]);
    if (dinerRes.status === 'fulfilled') {
      const { found, name, totalSessions } = dinerRes.value.data;
      if (found) {
        if (!opts?.keepName) setCoName(name ?? '');
        setCoFound(true);
      } else {
        setCoFound(false);
      }
      setCoVisits(totalSessions ?? 0);
    } else {
      // A failed lookup must NOT masquerade as a new diner — leave coFound
      // unresolved and flag the failure so the UI stays neutral.
      setCoLookupFailed(true);
    }
    if (memberRes.status === 'fulfilled') {
      setCoMember(memberRes.value.data.alreadyMember);
    }
    // The CRM card is about to appear (or the "new guest" hint change) below
    // the name field — glide the Place Order button down instead of a snap.
    LayoutAnimation.configureNext(GUEST_CRM_LAYOUT_PRESET);
    setCoLooking(false);
  };

  const onCoPhoneChange = async (v: string) => {
    const digits = v.replace(/\D/g, '').slice(0, 10);
    // Phone cleared/edited — the CRM card (if showing) is about to disappear,
    // so the button glides back up instead of snapping.
    LayoutAnimation.configureNext(GUEST_CRM_LAYOUT_PRESET);
    setCoPhone(digits); setCoFound(null); setCoName(''); setCoLookupFailed(false);
    setCoVisits(null); setCoMember(null);
    if (digits.length === 10) void lookupGuest(digits);
  };

  const confirmAndPlace = async () => {
    const phone = coPhone.replace(/\D/g, '');
    if (phone.length > 0 && phone.length !== 10) {
      setCoError('Enter a valid 10-digit number, or leave blank for a walk-in guest.');
      return;
    }
    const items = Object.entries(cart).map(([item_id, qty]) => {
      const mods = cartModifiers[item_id];
      const menuItem = menuItems.find(m => m.id === item_id);
      const modSummary = mods?.length
        ? mods.map(({ groupId, optionId }) => {
          const g = menuItem?.modifierGroups?.find(g => g.id === groupId);
          return g?.options.find(o => o.id === optionId)?.name;
        }).filter(Boolean).join(', ')
        : undefined;
      return {
        item_id, qty,
        ...(cartNotes[item_id]?.trim() ? { note: cartNotes[item_id].trim() } : {}),
        ...(mods?.length ? { selectedModifiers: mods, modifiers_summary: modSummary } : {}),
      };
    });
    if (items.length === 0) { setCoError('Cart is empty.'); return; }
    if (!sessionId) { setCoError('No active session. Go back and try again.'); return; }

    const snapshotTotal = cartTotal;
    const guestPhone = phone.length === 10 ? phone : '';
    const guestName = coName.trim() || null;

    setCoSubmitting(true);
    setCoError(null);
    try {
      if (guestPhone) {
        crewSessions.saveCustomer(sessionId, guestPhone, guestName).catch(() => {});
        setSessionCustomerPhone(guestPhone);
        if (guestName) setSessionCustomerName(guestName);
      }

      const orderRes = await crewOrders.placeOrder(sessionId, items);
      const orderId = orderRes?.order_id ?? '';

      setCart({});
      setCartNotes({});
      setCartModifiers({});
      setNoteExpanded({});

      // placeOrder already returns the full payable total (tax included) —
      // payment-collect re-fetches its own context anyway, so no extra
      // round trip here.
      let orderTotal = Number(orderRes?.total ?? 0);
      if (!Number.isFinite(orderTotal) || orderTotal <= 0) orderTotal = snapshotTotal;

      if (!Number.isFinite(orderTotal) || orderTotal <= 0) {
        router.back();
        return;
      }

      // Show a short-lived "Order placed" confirmation, then leave order-menu.
      // Dine-in returns to [tableId] with the bill breakdown forced open — so
      // the crew reviews exactly what was ordered before doing anything else —
      // instead of jumping straight to payment collection. Takeaway has no
      // table screen to return to, so it still goes to payment-collect directly.
      //
      // dismissTo (not replace) pops back to the [tableId] instance already in
      // the stack — the one we were pushed from — updating its params. Using
      // replace here mounted a *second* [tableId] on top of the original, which
      // is why the crew had to hit Back twice to reach the table floor.
      setPlaced({ amount: orderTotal });
      navTimerRef.current = setTimeout(() => {
        if (isTakeaway) {
          router.replace({
            pathname: '/(staff)/payment-collect',
            params: {
              orderId,
              tableNumber: String(tableId ?? 0),
              channel: 'TAKEAWAY',
              pickupToken: pickupToken ?? '',
              amount: String(orderTotal),
              customerName: guestName ?? '',
              customerPhone: guestPhone,
            },
          });
        } else {
          router.dismissTo({
            pathname: '/(staff)/[tableId]',
            params: {
              tableId: String(tableId ?? 0),
              sessionId: sessionId ?? '',
              tableDbId: tableDbId ?? '',
              openBill: '1',
            },
          });
        }
      }, 500);
    } catch (e: any) {
      setCoError(e?.message ?? 'Failed to place order. Try again.');
    } finally {
      setCoSubmitting(false);
    }
  };

  // ── Render each item — memoized row; only the touched row re-renders ──────
  const renderItem = useCallback(({ item }: { item: MenuItem }) => (
    <MenuItemRow
      item={item}
      qty={cart[item.id] ?? 0}
      note={cartNotes[item.id] ?? ''}
      noteOpen={!!noteExpanded[item.id]}
      mods={cartModifiers[item.id]}
      onAdd={handleAddPress}
      onRemove={removeFromCart}
      onToggleNote={handleToggleNote}
      onChangeNote={handleChangeNote}
    />
  ), [cart, cartNotes, noteExpanded, cartModifiers, handleAddPress, removeFromCart, handleToggleNote, handleChangeNote]);

  // Pad the last grid row with invisible fillers so an incomplete final row
  // doesn't let its flex:1 cards stretch to fill the width (FlatList would
  // otherwise blow up 2 leftover cards to half-screen each).
  const gridData = useMemo(() => {
    const remainder = filteredItems.length % gridColumns;
    if (remainder === 0) return filteredItems;
    const fillers = Array.from({ length: gridColumns - remainder }, (_, i) => ({
      id: `__filler_${i}`, __filler: true,
    })) as unknown as MenuItem[];
    return [...filteredItems, ...fillers];
  }, [filteredItems, gridColumns]);

  // Grid card renderer for the tablet-landscape POS layout.
  const renderCard = useCallback(({ item }: { item: MenuItem }) => {
    if ((item as any).__filler) return <View style={{ flex: 1 }} />;
    return (
      <MenuItemCard
        item={item}
        qty={cart[item.id] ?? 0}
        onAdd={handleAddPress}
        onRemove={removeFromCart}
      />
    );
  }, [cart, handleAddPress, removeFromCart]);

  // ── Guest details — its own screen (not a modal), pushed in place of the ──
  // menu when "Place Order" is tapped. Same fields/CRM lookup as before.
  if (checkoutOpen) {
    // Once the order is placed, this same screen morphs into the success tick
    // (card + checkmark spring in) instead of bouncing back to the menu to
    // show a separate confirmation — one continuous transition, not a jump.
    if (placed) {
      return (
        <View style={[styles.screen, { paddingTop: insets.top }]}>
          <View style={styles.placedScreenWrap}>
            <Animated.View
              style={[
                styles.placedCard,
                {
                  opacity: placedCardAnim,
                  transform: [{
                    scale: placedCardAnim.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }),
                  }],
                },
              ]}
            >
              <Animated.View
                style={[
                  styles.placedIcon,
                  {
                    transform: [{
                      scale: placedTickAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] }),
                    }],
                  },
                ]}
              >
                <Ionicons name="checkmark" size={34} color="#fff" />
              </Animated.View>
              <Text style={styles.placedTitle}>Order placed</Text>
              <Text style={styles.placedSub}>
                {isTakeaway ? (pickupToken ?? 'Takeaway') : `Table T${tableNum}`} · ₹{placed.amount.toFixed(0)}
              </Text>
              <Text style={styles.placedHint}>Opening payment collection…</Text>
            </Animated.View>
          </View>
        </View>
      );
    }

    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => !coSubmitting && setCheckoutOpen(false)}
            style={styles.backBtn}
            activeOpacity={0.7}
            disabled={coSubmitting}
          >
            <Ionicons name="chevron-back" size={20} color={QuinckleColors.textPrimary} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerTitle}>Guest details</Text>
            <Text style={styles.headerSub}>Optional — skip to place a walk-in order</Text>
          </View>
        </View>

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={[
              styles.coScreenBody,
              contentMaxWidth != null && { maxWidth: contentMaxWidth, width: '100%', alignSelf: 'center' },
            ]}
            keyboardShouldPersistTaps="handled"
          >
            {/* Phone */}
            <View style={styles.coInputWrap}>
              <View style={styles.coCode}><Text style={styles.coCodeText}>+91</Text></View>
              <View style={styles.coDivider} />
              <TextInput
                style={styles.coInput}
                value={coPhone}
                onChangeText={onCoPhoneChange}
                placeholder="10-digit mobile"
                placeholderTextColor={QuinckleColors.textMuted}
                keyboardType="phone-pad"
                maxLength={10}
                autoFocus
              />
              {coLooking && <ActivityIndicator size="small" color={QuinckleColors.primary} style={{ marginRight: 12 }} />}
            </View>

            {coFound === false && !coLookupFailed && coPhone.length === 10 && (
              <Text style={styles.notFoundText}>New guest — enter name below</Text>
            )}
            {coLookupFailed && coPhone.length === 10 && (
              <Text style={styles.notFoundText}>Couldn’t check — enter the name to continue</Text>
            )}
            {coError ? <Text style={styles.coErrorText}>{coError}</Text> : null}

            {/* Name */}
            <View style={[styles.coInputWrap, { marginTop: 10 }]}>
              <TextInput
                style={[styles.coInput, { flex: 1, paddingHorizontal: 14 }]}
                value={coName}
                onChangeText={setCoName}
                placeholder="Guest name (optional)"
                placeholderTextColor={QuinckleColors.textMuted}
                returnKeyType="done"
                onSubmitEditing={confirmAndPlace}
              />
              {coFound === true && (
                <Ionicons name="checkmark-circle" size={18} color={QuinckleColors.success} style={{ marginRight: 12 }} />
              )}
            </View>

            {/* CRM — visit history + membership status */}
            {coPhone.length === 10 && !coLooking && (coFound !== null || coMember !== null) && (
              <View style={styles.crmCard}>
                <View style={styles.crmRow}>
                  <View style={styles.crmCol}>
                    <Text style={styles.crmLabel}>VISITS HERE</Text>
                    <View style={styles.crmValueRow}>
                      <Text style={styles.crmValueNum}>{coVisits ?? 0}</Text>
                      <Text style={styles.crmValueUnit}>{coVisits === 1 ? 'time' : 'times'}</Text>
                    </View>
                  </View>
                  <View style={styles.crmDivider} />
                  <View style={styles.crmCol}>
                    <Text style={styles.crmLabel}>MEMBERSHIP</Text>
                    {coMember ? (
                      <View style={styles.crmMemberRow}>
                        <Ionicons name="ribbon" size={14} color={QuinckleColors.warning} />
                        <Text style={styles.crmMemberText}>Member</Text>
                      </View>
                    ) : (
                      <Text style={styles.crmNotMemberText}>Not a member</Text>
                    )}
                  </View>
                </View>
                {coMember && (
                  <View style={styles.crmDiscountStrip}>
                    <Ionicons name="pricetag" size={13} color={QuinckleColors.warning} />
                    <Text style={styles.crmDiscountText}>Membership discount applied at billing</Text>
                  </View>
                )}
              </View>
            )}

            {/* Sits right below the name section normally; when the CRM card
                above appears/disappears, LayoutAnimation glides it down/up
                instead of it snapping to its new spot. */}
            {/* The CRM lookup is informational only — never gate placing the
                order on it, or a slow lookup adds a full RTT to every order. */}
            <TouchableOpacity
              style={[styles.coConfirm,
                { marginTop: Spacing.lg },
                (coSubmitting || (coPhone.length > 0 && coPhone.length < 10)) && { opacity: 0.4 }]}
              onPress={confirmAndPlace}
              disabled={coSubmitting || (coPhone.length > 0 && coPhone.length < 10)}
              activeOpacity={0.8}
            >
              {coSubmitting
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={styles.coConfirmText}>Place Order</Text>}
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    );
  }

  // ── UI ─────────────────────────────────────────────────────────────────────

  // ── Shared bits, hoisted so the phone and tablet-landscape layouts reuse the
  //    exact same offer nudge / search input / footer without duplication. ──

  const offerNudgeJsx = nudgeMounted && lastNudge.current && (
    <Animated.View
      style={{
        overflow: 'hidden',
        opacity: offerSectionAnim,
        maxHeight: offerSectionAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 140] }),
        transform: [{ translateY: offerSectionAnim.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] }) }],
      }}
    >
      <Animated.View
        style={[
          styles.offerBar,
          {
            backgroundColor: offerUnlockAnim.interpolate({ inputRange: [0, 1], outputRange: [QuinckleColors.primarySoft, QuinckleColors.successSoft] }),
            borderColor: offerUnlockAnim.interpolate({ inputRange: [0, 1], outputRange: [QuinckleColors.primarySoftBorder, QuinckleColors.successBorder] }),
          },
        ]}
      >
        <View style={styles.offerBarRow}>
          <Ionicons
            name={lastNudge.current.unlocked ? 'checkmark-circle' : 'pricetag'}
            size={14}
            color={lastNudge.current.unlocked ? QuinckleColors.success : QuinckleColors.primary}
          />
          <Text style={styles.offerBarText} numberOfLines={1}>
            {lastNudge.current.unlocked
              ? `${lastNudge.current.reward} unlocked — ${lastNudge.current.name}`
              : `Add ₹${lastNudge.current.remaining} more to unlock ${lastNudge.current.reward}`}
          </Text>
        </View>
        <View style={styles.offerTrack}>
          <Animated.View
            style={[
              styles.offerFill,
              {
                width: offerProgressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'], extrapolate: 'clamp' }),
                backgroundColor: offerUnlockAnim.interpolate({ inputRange: [0, 1], outputRange: [QuinckleColors.primary, QuinckleColors.success] }),
              },
            ]}
          />
        </View>
      </Animated.View>
    </Animated.View>
  );

  const searchBarJsx = (
    <View style={styles.searchBar}>
      <Ionicons name="search" size={15} color={QuinckleColors.textMuted} />
      <TextInput
        style={styles.searchInput}
        placeholder="Search menu…"
        placeholderTextColor={QuinckleColors.textMuted}
        value={search}
        onChangeText={setSearch}
        returnKeyType="search"
      />
      {search.length > 0 && (
        <TouchableOpacity onPress={() => setSearch('')} hitSlop={8}>
          <Ionicons name="close-circle" size={15} color={QuinckleColors.textMuted} />
        </TouchableOpacity>
      )}
    </View>
  );

  const footerJsx = footerMounted && (
    <Animated.View style={[
      styles.footer,
      { paddingBottom: insets.bottom + Spacing.sm },
      {
        opacity: footerAnim,
        transform: [{ translateY: footerAnim.interpolate({ inputRange: [0, 1], outputRange: [56, 0] }) }],
      },
    ]}>
      <TouchableOpacity
        style={styles.footerLeft}
        onPress={() => setReviewOpen(true)}
        activeOpacity={0.7}
        accessibilityLabel="Review order summary"
      >
        <View style={styles.footerChevron}>
          <Ionicons name="chevron-up" size={16} color={QuinckleColors.primary} />
        </View>
        <View>
          <Text style={styles.footerCount}>{cartCount} item{cartCount !== 1 ? 's' : ''}</Text>
          <Text style={styles.footerTotal}>₹{cartTotal.toFixed(0)}</Text>
        </View>
      </TouchableOpacity>
      <TouchableOpacity style={styles.placeBtn} onPress={openCheckout} activeOpacity={0.85}>
        <Text style={styles.placeBtnText}>Place Order</Text>
        <Ionicons name="arrow-forward" size={16} color="#fff" />
      </TouchableOpacity>
    </Animated.View>
  );

  const cartReviewJsx = (
    <CartReviewSheet
      visible={reviewOpen && cartLines.length > 0}
      onClose={() => setReviewOpen(false)}
      isWide={isWide}
      lines={cartLines}
      total={cartTotal}
      onInc={addToCart}
      onDec={removeFromCart}
      onCheckout={() => { setReviewOpen(false); openCheckout(); }}
    />
  );

  const headerJsx = (
    <View style={styles.header}>
      <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
        <Ionicons name="chevron-back" size={20} color={QuinckleColors.textPrimary} />
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text style={styles.headerTitle}>{isTakeaway ? 'New Takeaway Order' : 'Add Items'}</Text>
        <Text style={[styles.headerSub, isTakeaway && { color: QuinckleColors.primary, fontWeight: '700' }]}>
          {isTakeaway ? `TAKEAWAY${pickupToken ? ` · ${pickupToken}` : ''}` : `Table T${tableNum}`}
        </Text>
      </View>
      {cartCount > 0 && (
        <View style={styles.cartBadge}>
          <Text style={styles.cartBadgeText}>{cartCount} item{cartCount !== 1 ? 's' : ''}</Text>
        </View>
      )}
    </View>
  );

  const emptyJsx = (
    <View style={styles.empty}>
      <Ionicons name="search-outline" size={32} color={QuinckleColors.textMuted} />
      <Text style={styles.emptyText}>
        {menuItems.length === 0 ? 'No items available' : 'No items match your search'}
      </Text>
    </View>
  );

  // ── Tablet-landscape "full POS" layout: category rail on the left, a grid of
  //    square item cards on the right (multi-column, like a till). ──
  if (isWide) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        {headerJsx}
        {offerNudgeJsx}

        <View style={styles.wideRow}>
          {/* Category rail */}
          <View style={styles.rail}>
            <View style={styles.railSearch}>{searchBarJsx}</View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingVertical: Spacing.sm }}>
              {menuCategories.map(cat => {
                const active = activeCategory === cat;
                return (
                  <TouchableOpacity
                    key={cat}
                    style={[styles.railItem, active && styles.railItemActive]}
                    onPress={() => setActiveCategory(cat)}
                    activeOpacity={0.75}
                  >
                    <View style={[styles.railAccent, active && styles.railAccentActive]} />
                    <Text
                      style={[styles.railText, active && styles.railTextActive]}
                      numberOfLines={2}
                    >
                      {cat}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          <View style={styles.wideDivider} />

          {/* Item grid */}
          <View style={styles.wideRightPane}>
            <KeyboardAvoidingView
              style={{ flex: 1 }}
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              keyboardVerticalOffset={0}
            >
              {isMenuLoading ? (
                <ActivityIndicator size="large" color={QuinckleColors.primary} style={{ marginTop: Spacing.huge }} />
              ) : filteredItems.length === 0 ? (
                emptyJsx
              ) : (
                <FlatList
                  key={`grid-${gridColumns}`}
                  data={gridData}
                  keyExtractor={item => item.id}
                  renderItem={renderCard}
                  numColumns={gridColumns}
                  columnWrapperStyle={{ gap: Spacing.md }}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={{
                    padding: Spacing.xl,
                    gap: Spacing.md,
                    paddingBottom: footerMounted ? 110 : Spacing.xxl,
                  }}
                />
              )}
              {footerJsx}
            </KeyboardAvoidingView>
          </View>
        </View>

        {/* ── Modifier sheet ── */}
        <ModifierSheet
          item={modifierItem}
          pending={pendingMods}
          onToggle={handleToggleMod}
          onConfirm={handleConfirmMods}
          onCancel={() => setModifierItem(null)}
        />

        {/* ── Cart review (right-side drawer on tablet-landscape) ── */}
        {cartReviewJsx}
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>

      {/* ── Header ── */}
      {headerJsx}

      {/* ── Offer progress nudge ── */}
      {offerNudgeJsx}

      {/* ── Search + Category dropdown ── */}
      <View style={styles.searchRow}>
        {searchBarJsx}

        {/* Category dropdown trigger */}
        <TouchableOpacity
          style={styles.catDropTrigger}
          onPress={() => setCatDropOpen(true)}
          activeOpacity={0.8}
        >
          <Text style={styles.catDropLabel} numberOfLines={1}>
            {activeCategory === 'All' ? 'All' : activeCategory}
          </Text>
          <Ionicons name="chevron-down" size={12} color={QuinckleColors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* ── Category dropdown modal ── */}
      <Modal visible={catDropOpen} transparent animationType="fade" onRequestClose={() => setCatDropOpen(false)}>
        <TouchableOpacity style={styles.dropBackdrop} activeOpacity={1} onPress={() => setCatDropOpen(false)}>
          <View style={styles.dropMenu}>
            <Text style={styles.dropTitle}>Category</Text>
            {menuCategories.map(cat => (
              <TouchableOpacity
                key={cat}
                style={[styles.dropItem, activeCategory === cat && styles.dropItemActive]}
                onPress={() => { setActiveCategory(cat); setCatDropOpen(false); }}
                activeOpacity={0.75}
              >
                <Text style={[styles.dropItemText, activeCategory === cat && styles.dropItemTextActive]}>
                  {cat}
                </Text>
                {activeCategory === cat && (
                  <Ionicons name="checkmark" size={15} color={QuinckleColors.primary} />
                )}
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* ── List (KeyboardAvoidingView keeps footer visible when keyboard opens) ── */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {isMenuLoading ? (
          <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
            {Array.from({ length: 8 }).map((_, i) => <ItemSkeleton key={i} />)}
            <View style={{ height: Spacing.huge }} />
          </ScrollView>
        ) : filteredItems.length === 0 ? (
          emptyJsx
        ) : (
          <FlatList
            data={filteredItems}
            keyExtractor={item => item.id}
            renderItem={renderItem}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: footerMounted ? 100 : Spacing.xxl }}
          />
        )}

        {/* ── Footer CTA — springs up, fades out smoothly ── */}
        {footerJsx}
      </KeyboardAvoidingView>

      {/* ── Modifier sheet ── */}
      <ModifierSheet
        item={modifierItem}
        pending={pendingMods}
        onToggle={handleToggleMod}
        onConfirm={handleConfirmMods}
        onCancel={() => setModifierItem(null)}
      />

      {/* ── Cart review (bottom sheet on phone) ── */}
      {cartReviewJsx}

    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: QuinckleColors.background },

  // Header
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md, gap: Spacing.md },
  backBtn: { width: 38, height: 38, borderRadius: Radius.md, backgroundColor: QuinckleColors.surfaceMuted, borderWidth: 1, borderColor: QuinckleColors.border, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { ...Typography.subtitle, color: QuinckleColors.textPrimary },
  headerSub: { ...Typography.micro, color: QuinckleColors.textMuted, marginTop: 1 },
  cartBadge: { backgroundColor: QuinckleColors.primarySoft, borderRadius: Radius.pill, paddingHorizontal: Spacing.md, paddingVertical: 4, borderWidth: 1, borderColor: QuinckleColors.primarySoftBorder },
  cartBadgeText: { ...Typography.micro, color: QuinckleColors.primary, fontWeight: '700' },

  // Offer progress nudge
  offerBar: {
    marginHorizontal: Spacing.xl,
    marginBottom: Spacing.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: QuinckleColors.primarySoftBorder,
    backgroundColor: QuinckleColors.primarySoft,
    gap: 8,
  },
  offerBarRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  offerBarText: { ...Typography.caption, color: QuinckleColors.textPrimary, fontWeight: '600', flex: 1 },
  offerTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: QuinckleColors.surfaceMuted,
    overflow: 'hidden',
  },
  offerFill: {
    height: '100%',
    borderRadius: 3,
  },

  // Tablet-landscape two-pane POS layout
  wideRow: { flex: 1, flexDirection: 'row' },
  rail: { width: RAIL_WIDTH, paddingLeft: Spacing.md },
  railSearch: { flexDirection: 'row', paddingRight: Spacing.md, paddingTop: Spacing.sm, paddingBottom: Spacing.sm },
  railItem: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    paddingVertical: 12, paddingRight: Spacing.md, borderRadius: Radius.md, marginBottom: 2,
  },
  railItemActive: { backgroundColor: QuinckleColors.primarySoft },
  railAccent: { width: 3, height: 20, borderRadius: 2, backgroundColor: 'transparent' },
  railAccentActive: { backgroundColor: QuinckleColors.primary },
  railText: { ...Typography.body, color: QuinckleColors.textSecondary, fontWeight: '500', flex: 1 },
  railTextActive: { color: QuinckleColors.primary, fontWeight: '700' },
  wideDivider: { width: 1, backgroundColor: QuinckleColors.border, marginHorizontal: Spacing.sm },
  wideRightPane: { flex: 1 },

  // Search row
  searchRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.xl, marginBottom: Spacing.md, gap: Spacing.sm },
  searchBar: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: QuinckleColors.surfaceElevated, borderRadius: Radius.md, borderWidth: 1, borderColor: QuinckleColors.border, paddingHorizontal: Spacing.md, height: 44, gap: Spacing.sm },
  searchInput: { flex: 1, color: QuinckleColors.textPrimary, fontSize: 14 },
  catDropTrigger: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: QuinckleColors.surfaceElevated, borderRadius: Radius.md, borderWidth: 1, borderColor: QuinckleColors.border, paddingHorizontal: Spacing.md, height: 44, minWidth: 72, maxWidth: 100 },
  catDropLabel: { ...Typography.micro, color: QuinckleColors.textPrimary, fontWeight: '600', flex: 1 },

  // Category dropdown
  dropBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: Spacing.xl },
  dropMenu: { width: '85%', backgroundColor: QuinckleColors.surface, borderRadius: Radius.xl, paddingVertical: Spacing.sm, borderWidth: 1, borderColor: QuinckleColors.border },
  dropTitle: { ...Typography.label, color: QuinckleColors.textMuted, paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md },
  dropItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md, borderRadius: Radius.md, marginHorizontal: Spacing.sm },
  dropItemActive: { backgroundColor: QuinckleColors.primarySoft },
  dropItemText: { ...Typography.body, color: QuinckleColors.textSecondary },
  dropItemTextActive: { color: QuinckleColors.primary, fontWeight: '600' },

  // Item row
  itemRow: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: Spacing.xl, paddingVertical: Spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: QuinckleColors.borderSubtle, gap: Spacing.md },
  itemImg: { width: 76, height: 76, borderRadius: Radius.md, backgroundColor: QuinckleColors.surfaceElevated, flexShrink: 0 },
  itemImgPlaceholder: { width: 76, height: 76, borderRadius: Radius.md, backgroundColor: QuinckleColors.surfaceElevated, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  itemInfo: { flex: 1, gap: 5 },
  itemName: { ...Typography.body, color: QuinckleColors.textPrimary, fontWeight: '600', lineHeight: 20 },
  itemMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  catChip: { backgroundColor: QuinckleColors.surfaceElevated, borderRadius: Radius.pill, paddingHorizontal: 7, paddingVertical: 2 },
  catChipText: { fontSize: 10, fontWeight: '600', color: QuinckleColors.textTertiary },
  optionsLabel: { fontSize: 10, fontWeight: '600', color: QuinckleColors.primary },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  price: { fontSize: 16, fontWeight: '700', color: QuinckleColors.primary, letterSpacing: -0.3 },
  originalPrice: { fontSize: 13, color: QuinckleColors.textMuted, textDecorationLine: 'line-through' },
  discountBadge: { backgroundColor: QuinckleColors.successSoft, borderRadius: Radius.pill, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, borderColor: QuinckleColors.successBorder },
  discountText: { fontSize: 10, fontWeight: '700', color: QuinckleColors.success },
  modSummary: { fontSize: 11, color: QuinckleColors.textMuted, fontStyle: 'italic' },

  // Note toggle + input
  noteToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  noteToggleText: { fontSize: 11, color: QuinckleColors.textMuted, fontWeight: '500' },
  noteInput: { marginTop: 6, backgroundColor: QuinckleColors.surfaceElevated, borderRadius: Radius.sm, borderWidth: 1, borderColor: QuinckleColors.border, paddingHorizontal: Spacing.sm, paddingVertical: 6, color: QuinckleColors.textPrimary, fontSize: 12 },

  // Qty + Add
  qtyWrap: { alignItems: 'center', justifyContent: 'flex-start', paddingTop: 2, flexShrink: 0 },
  qtyControl: { flexDirection: 'row', alignItems: 'center', backgroundColor: QuinckleColors.primarySoft, borderRadius: Radius.md, borderWidth: 1, borderColor: QuinckleColors.primarySoftBorder, overflow: 'hidden' },
  qtyBtn: { width: 30, height: 34, alignItems: 'center', justifyContent: 'center' },
  qtyText: { ...Typography.body, color: QuinckleColors.primary, fontWeight: '700', minWidth: 18, textAlign: 'center' },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: QuinckleColors.primarySoft, borderRadius: Radius.md, borderWidth: 1, borderColor: QuinckleColors.primarySoftBorder, paddingHorizontal: Spacing.md, height: 34 },
  addBtnText: { fontSize: 13, color: QuinckleColors.primary, fontWeight: '700' },

  // Empty
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, paddingVertical: Spacing.huge },
  emptyText: { ...Typography.caption, color: QuinckleColors.textMuted },

  // Footer
  footer: { backgroundColor: QuinckleColors.surface, borderTopWidth: 1, borderTopColor: QuinckleColors.border, paddingHorizontal: Spacing.xl, paddingTop: Spacing.md, flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  footerLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  footerChevron: {
    width: 32, height: 32, borderRadius: Radius.md,
    backgroundColor: QuinckleColors.primarySoft, borderWidth: 1, borderColor: QuinckleColors.primarySoftBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  footerCount: { ...Typography.micro, color: QuinckleColors.textSecondary },
  footerTotal: { ...Typography.subtitle, color: QuinckleColors.textPrimary, marginTop: 1 },
  placeBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: QuinckleColors.primary, paddingHorizontal: Spacing.xl, paddingVertical: 13, borderRadius: Radius.md },
  placeBtnText: { ...Typography.bodyStrong, color: '#fff' },

  // Guest details screen
  coScreenBody: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  coInputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: QuinckleColors.surfaceElevated, borderRadius: Radius.md, borderWidth: 1, borderColor: QuinckleColors.border, height: 48, overflow: 'hidden' },
  coCode: { paddingHorizontal: 12, height: '100%', justifyContent: 'center' },
  coCodeText: { ...Typography.body, color: QuinckleColors.textSecondary, fontWeight: '600' },
  coDivider: { width: 1, height: '60%', backgroundColor: QuinckleColors.border },
  coInput: { flex: 1, color: QuinckleColors.textPrimary, fontSize: 15, paddingHorizontal: 12, height: '100%' },
  notFoundText: { fontSize: 12, color: QuinckleColors.textMuted, marginTop: 6, fontStyle: 'italic' },
  coErrorText: { fontSize: 12, color: QuinckleColors.danger, marginTop: 6 },
  crmCard: { marginTop: 14, backgroundColor: QuinckleColors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: QuinckleColors.border, overflow: 'hidden' },
  crmRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16 },
  crmCol: { flex: 1 },
  crmDivider: { width: 1, height: 34, backgroundColor: QuinckleColors.border, marginHorizontal: 14 },
  crmLabel: { fontSize: 11, color: QuinckleColors.textSecondary, marginBottom: 3 },
  crmValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 5 },
  crmValueNum: { fontSize: 20, fontWeight: '700', color: QuinckleColors.textPrimary },
  crmValueUnit: { fontSize: 12, color: QuinckleColors.textSecondary },
  crmMemberRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  crmMemberText: { fontSize: 14, fontWeight: '700', color: QuinckleColors.warning },
  crmNotMemberText: { fontSize: 13, color: QuinckleColors.textSecondary },
  crmDiscountStrip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: QuinckleColors.warningSoft, borderTopWidth: 1, borderTopColor: QuinckleColors.warningBorder, paddingVertical: 8, paddingHorizontal: 16 },
  crmDiscountText: { fontSize: 12, fontWeight: '600', color: QuinckleColors.warning },
  coConfirm: { backgroundColor: QuinckleColors.success, borderRadius: Radius.md, paddingVertical: 14, alignItems: 'center' },
  coConfirmText: { ...Typography.bodyStrong, color: '#fff' },

  // Modifier sheet
  modGroup: { paddingHorizontal: Spacing.xl, marginBottom: Spacing.lg },
  modGroupHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.md },
  modGroupName: { ...Typography.caption, color: QuinckleColors.textPrimary, fontWeight: '700' },
  modGroupHint: { ...Typography.micro, color: QuinckleColors.textMuted },
  modOption: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingVertical: Spacing.md, paddingHorizontal: Spacing.md, borderRadius: Radius.md, marginBottom: 4, backgroundColor: QuinckleColors.surfaceElevated, borderWidth: 1, borderColor: QuinckleColors.border },
  modOptionActive: { backgroundColor: QuinckleColors.primarySoft, borderColor: QuinckleColors.primarySoftBorder },
  modCheck: { width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, borderColor: QuinckleColors.borderStrong, backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  modCheckActive: { borderColor: QuinckleColors.primary, backgroundColor: QuinckleColors.primary },
  modOptionName: { ...Typography.body, color: QuinckleColors.textPrimary, flex: 1 },
  modAdj: { ...Typography.caption, color: QuinckleColors.textSecondary },
  modConfirmBtn: { marginHorizontal: Spacing.xl, marginTop: Spacing.sm, marginBottom: Spacing.md, backgroundColor: QuinckleColors.primary, borderRadius: Radius.lg, paddingVertical: Spacing.lg, alignItems: 'center' },
  modConfirmText: { ...Typography.bodyStrong, color: '#fff' },

  // Order-placed confirmation — takes over the guest-details screen in place
  placedScreenWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  placedCard: { alignItems: 'center', gap: 8, paddingHorizontal: Spacing.xl },
  placedIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: QuinckleColors.success, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  placedTitle: { ...Typography.title, color: QuinckleColors.textPrimary, fontWeight: '800' },
  placedSub: { ...Typography.body, color: QuinckleColors.textSecondary },
  placedHint: { ...Typography.caption, color: QuinckleColors.textTertiary, marginTop: 6 },
});
