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

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../context/AuthContext';
import { QuinckleColors, Radius, Spacing, Typography } from '../../constants/Colors';
import {
  crewSessions, crewOrders, crewDiners, restaurantApi, crewOffers,
} from '../../services/api';
import type { MenuItem, ModifierGroup, CrewOffer } from '../../services/api';
import { BottomSheet } from '../../components/ui/BottomSheet';
import { Skeleton } from '../../components/ui/Skeleton';

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

export default function OrderMenuScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { staffInfo } = useAuth();

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
  // Brief "order placed" confirmation shown before opening payment collection.
  const [placed, setPlaced] = useState<{ amount: number } | null>(null);
  const navTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (navTimerRef.current) clearTimeout(navTimerRef.current); }, []);
  const [coSubmitting, setCoSubmitting] = useState(false);
  const [coError, setCoError] = useState<string | null>(null);

  // Keep session customer for pre-fill
  const [sessionCustomerPhone, setSessionCustomerPhone] = useState(paramPhone || null);
  const [sessionCustomerName, setSessionCustomerName] = useState(paramName || null);

  // ── Load menu + branding on mount ──────────────────────────────────────────
  useEffect(() => {
    const rid = staffInfo?.restaurantId;
    if (!rid) return;
    setIsMenuLoading(true);

    // 'CREW' → dine-in menu + crew-only special charges (e.g. birthday fees)
    // that diners never see but staff can add to a bill.
    // Takeaway sessions get the TAKEAWAY menu so per-channel availability is
    // respected (CREW-only special charges stay dine-in).
    const menuP = restaurantApi.getMenu(rid, isTakeaway ? 'TAKEAWAY' : 'CREW')
      .then(res => {
        const cats: any[] = (res as any)?.data ?? [];
        const items = cats.flatMap((c: any) =>
          (c.items ?? []).map((i: any) => ({ ...i, category: i.category || c.name }))
        ).filter((i: any) => i.isAvailable !== false);
        setMenuItems(items);
        setMenuCategories(['All', ...cats.map((c: any) => c.name).filter(Boolean)]);
      })
      .catch(() => {})
      .finally(() => setIsMenuLoading(false));

    crewOffers.list(sessionId)
      .then(res => {
        const d = (res as any)?.data;
        setOffers(d?.offers ?? []);
        setPriorSubtotal(Number(d?.sessionSubtotalBeforeCart ?? 0));
      })
      .catch(() => {});
  }, [staffInfo?.restaurantId, sessionId]);

  // ── Cart helpers ───────────────────────────────────────────────────────────
  const addToCart = (itemId: string, mods?: { groupId: string; optionId: string }[]) => {
    setCart(prev => ({ ...prev, [itemId]: (prev[itemId] ?? 0) + 1 }));
    if (mods) setCartModifiers(prev => ({ ...prev, [itemId]: mods }));
  };

  const removeFromCart = (itemId: string) => {
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
  };

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
  }, [offerNudge?.progress, offerNudge?.unlocked]);

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
  const handleAddPress = (item: MenuItem) => {
    if ((item.modifierGroups?.length ?? 0) > 0) {
      const init: Record<string, string[]> = {};
      item.modifierGroups!.forEach(g => { init[g.id] = []; });
      setPendingMods(init);
      setModifierItem(item);
    } else {
      addToCart(item.id);
    }
  };

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
    if (sessionCustomerPhone) {
      const digits = sessionCustomerPhone.replace(/\D/g, '').slice(-10);
      setCoPhone(digits.length === 10 ? digits : '');
      setCoName(sessionCustomerName ?? '');
      setCoFound(digits.length === 10 ? true : null);
    } else {
      setCoPhone(''); setCoName(''); setCoFound(null);
    }
    setCheckoutOpen(true);
  };

  const onCoPhoneChange = async (v: string) => {
    const digits = v.replace(/\D/g, '').slice(0, 10);
    setCoPhone(digits); setCoFound(null); setCoName(''); setCoLookupFailed(false);
    if (digits.length === 10) {
      setCoLooking(true);
      try {
        const res = await crewDiners.lookup(digits);
        if (res.data.found) { setCoName(res.data.name ?? ''); setCoFound(true); }
        else setCoFound(false);
      } catch {
        // A failed lookup must NOT masquerade as a new diner — leave coFound
        // unresolved and flag the failure so the UI stays neutral.
        setCoLookupFailed(true);
      }
      finally { setCoLooking(false); }
    }
  };

  const buildIdempotencyKey = (
    orderId: string,
    splits: { method: string; amount: number }[],
  ) => `crew-collect:${orderId}:${splits.map(s => `${s.method}:${Number(s.amount).toFixed(2)}`).join('|')}`;

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
      setCheckoutOpen(false);

      let orderTotal = Number(orderRes?.totals?.total ?? 0);
      if (orderId) {
        try {
          const ctx = await crewOrders.getPaymentContext(orderId);
          orderTotal = Number(ctx?.data?.total ?? orderTotal);
        } catch { /* use placeOrder total */ }
      }
      if (!Number.isFinite(orderTotal) || orderTotal <= 0) orderTotal = snapshotTotal;

      if (!Number.isFinite(orderTotal) || orderTotal <= 0) {
        router.back();
        return;
      }

      // Show a short-lived "Order placed" confirmation, then replace order-menu
      // in the stack so back from payment-collect → [tableId].
      const navParams = {
        orderId,
        tableNumber: String(tableId ?? 0),
        ...(isTakeaway ? { channel: 'TAKEAWAY', pickupToken: pickupToken ?? '' } : {}),
        amount: String(orderTotal),
        customerName: guestName ?? '',
        customerPhone: guestPhone,
      };
      setPlaced({ amount: orderTotal });
      navTimerRef.current = setTimeout(() => {
        router.replace({ pathname: '/(staff)/payment-collect', params: navParams });
      }, 1200);
    } catch (e: any) {
      setCoError(e?.message ?? 'Failed to place order. Try again.');
    } finally {
      setCoSubmitting(false);
    }
  };

  // ── Render each item ───────────────────────────────────────────────────────
  const renderItem = ({ item }: { item: MenuItem }) => {
    const qty = cart[item.id] ?? 0;
    const note = cartNotes[item.id] ?? '';
    const hasImage = !!item.imageUrl;
    const price = parseFloat(item.price);
    const origPrice = item.originalPrice ? parseFloat(item.originalPrice) : null;
    const discountPct = origPrice && origPrice > price
      ? Math.round(((origPrice - price) / origPrice) * 100) : 0;
    const noteOpen = !!noteExpanded[item.id];

    const modSummary = (() => {
      const mods = cartModifiers[item.id];
      if (!mods?.length) return null;
      return mods.map(({ groupId, optionId }) => {
        const g = item.modifierGroups?.find(g => g.id === groupId);
        return g?.options.find(o => o.id === optionId)?.name;
      }).filter(Boolean).join(', ') || null;
    })();

    return (
      <View style={styles.itemRow}>
        {/* Image */}
        {hasImage ? (
          <Image source={{ uri: item.imageUrl }} style={styles.itemImg} />
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
            onPress={() => qty > 0 && setNoteExpanded(prev => ({ ...prev, [item.id]: !prev[item.id] }))}
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
              onChangeText={text => setCartNotes(prev => ({ ...prev, [item.id]: text }))}
              returnKeyType="done"
              autoFocus
            />
          )}
        </View>

        {/* Qty control */}
        <View style={styles.qtyWrap}>
          {qty > 0 ? (
            <View style={styles.qtyControl}>
              <TouchableOpacity onPress={() => removeFromCart(item.id)} style={styles.qtyBtn} hitSlop={6}>
                <Ionicons name="remove" size={16} color={QuinckleColors.primary} />
              </TouchableOpacity>
              <Text style={styles.qtyText}>{qty}</Text>
              <TouchableOpacity onPress={() => handleAddPress(item)} style={styles.qtyBtn} hitSlop={6}>
                <Ionicons name="add" size={16} color={QuinckleColors.primary} />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity onPress={() => handleAddPress(item)} style={styles.addBtn} activeOpacity={0.8}>
              <Ionicons name="add" size={15} color={QuinckleColors.primary} />
              <Text style={styles.addBtnText}>Add</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  // ── UI ─────────────────────────────────────────────────────────────────────
  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>

      {/* ── Header ── */}
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

      {/* ── Offer progress nudge ── */}
      {nudgeMounted && lastNudge.current && (
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
      )}

      {/* ── Search + Category dropdown ── */}
      <View style={styles.searchRow}>
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
          <View style={styles.empty}>
            <Ionicons name="search-outline" size={32} color={QuinckleColors.textMuted} />
            <Text style={styles.emptyText}>
              {menuItems.length === 0 ? 'No items available' : 'No items match your search'}
            </Text>
          </View>
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
        {footerMounted && (
          <Animated.View style={[
            styles.footer,
            { paddingBottom: insets.bottom + Spacing.sm },
            {
              opacity: footerAnim,
              transform: [{ translateY: footerAnim.interpolate({ inputRange: [0, 1], outputRange: [56, 0] }) }],
            },
          ]}>
            <View style={styles.footerLeft}>
              <Text style={styles.footerCount}>{cartCount} item{cartCount !== 1 ? 's' : ''}</Text>
              <Text style={styles.footerTotal}>₹{cartTotal.toFixed(0)}</Text>
            </View>
            <TouchableOpacity style={styles.placeBtn} onPress={openCheckout} activeOpacity={0.85}>
              <Text style={styles.placeBtnText}>Place Order</Text>
              <Ionicons name="arrow-forward" size={16} color="#fff" />
            </TouchableOpacity>
          </Animated.View>
        )}
      </KeyboardAvoidingView>

      {/* ── Identity / Checkout modal ── */}
      <Modal
        visible={checkoutOpen}
        transparent
        animationType="slide"
        onRequestClose={() => !coSubmitting && setCheckoutOpen(false)}
      >
        <View style={styles.coBackdrop}>
          <View style={styles.coCard}>
            <Text style={styles.coEyebrow}>Manual Order</Text>
            <Text style={styles.coTitle}>Guest details</Text>
            <Text style={styles.coSub}>Optional — skip to place a walk-in order without linking an account.</Text>

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

            {coFound === true && (
              <View style={styles.foundBadge}><Text style={styles.foundText}>✓ Found on Quinckle</Text></View>
            )}
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
            </View>

            <View style={styles.coFooter}>
              <TouchableOpacity
                style={styles.coCancel}
                onPress={() => setCheckoutOpen(false)}
                disabled={coSubmitting}
                activeOpacity={0.8}
              >
                <Text style={styles.coCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.coConfirm,
                  (coLooking || coSubmitting || (coPhone.length > 0 && coPhone.length < 10)) && { opacity: 0.4 }]}
                onPress={confirmAndPlace}
                disabled={coLooking || coSubmitting || (coPhone.length > 0 && coPhone.length < 10)}
                activeOpacity={0.8}
              >
                <Text style={styles.coConfirmText}>
                  {coSubmitting ? 'Placing…' : coPhone.length === 10 ? 'Place Order & Pay' : 'Place Order'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Modifier sheet ── */}
      <ModifierSheet
        item={modifierItem}
        pending={pendingMods}
        onToggle={handleToggleMod}
        onConfirm={handleConfirmMods}
        onCancel={() => setModifierItem(null)}
      />

      {/* ── Order-placed confirmation (short-lived, before payment collection) ── */}
      {placed && (
        <View style={styles.placedOverlay} pointerEvents="none">
          <View style={styles.placedCard}>
            <View style={styles.placedIcon}>
              <Ionicons name="checkmark" size={34} color="#fff" />
            </View>
            <Text style={styles.placedTitle}>Order placed</Text>
            <Text style={styles.placedSub}>
              {isTakeaway ? (pickupToken ?? 'Takeaway') : `Table T${tableNum}`} · ₹{placed.amount.toFixed(0)}
            </Text>
            <Text style={styles.placedHint}>Opening payment collection…</Text>
          </View>
        </View>
      )}
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
  footerLeft: { flex: 1 },
  footerCount: { ...Typography.micro, color: QuinckleColors.textSecondary },
  footerTotal: { ...Typography.subtitle, color: QuinckleColors.textPrimary, marginTop: 1 },
  placeBtn: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, backgroundColor: QuinckleColors.primary, paddingHorizontal: Spacing.xl, paddingVertical: 13, borderRadius: Radius.md },
  placeBtnText: { ...Typography.bodyStrong, color: '#fff' },

  // Checkout modal
  coBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: Spacing.xl },
  coCard: { width: '100%', maxWidth: 420, backgroundColor: QuinckleColors.surface, borderRadius: Radius.xl, padding: Spacing.lg, borderWidth: 1, borderColor: QuinckleColors.border },
  coEyebrow: { ...Typography.label, color: QuinckleColors.textMuted },
  coTitle: { ...Typography.subtitle, color: QuinckleColors.textPrimary, marginTop: 4 },
  coSub: { ...Typography.micro, color: QuinckleColors.textSecondary, marginTop: 4, marginBottom: 4, lineHeight: 17 },
  coInputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: QuinckleColors.surfaceElevated, borderRadius: Radius.md, borderWidth: 1, borderColor: QuinckleColors.border, height: 48, overflow: 'hidden', marginTop: 16 },
  coCode: { paddingHorizontal: 12, height: '100%', justifyContent: 'center' },
  coCodeText: { ...Typography.body, color: QuinckleColors.textSecondary, fontWeight: '600' },
  coDivider: { width: 1, height: '60%', backgroundColor: QuinckleColors.border },
  coInput: { flex: 1, color: QuinckleColors.textPrimary, fontSize: 15, paddingHorizontal: 12, height: '100%' },
  foundBadge: { marginTop: 8, paddingHorizontal: 10, paddingVertical: 5, backgroundColor: 'rgba(34,197,94,0.12)', borderRadius: Radius.sm, borderWidth: 1, borderColor: 'rgba(34,197,94,0.3)', alignSelf: 'flex-start' },
  foundText: { fontSize: 12, fontWeight: '600', color: QuinckleColors.success },
  notFoundText: { fontSize: 12, color: QuinckleColors.textMuted, marginTop: 6, fontStyle: 'italic' },
  coErrorText: { fontSize: 12, color: QuinckleColors.danger, marginTop: 6 },
  coFooter: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.lg },
  coCancel: { paddingHorizontal: Spacing.md, paddingVertical: 10 },
  coCancelText: { ...Typography.caption, color: QuinckleColors.textSecondary, fontWeight: '600' },
  coConfirm: { backgroundColor: QuinckleColors.success, borderRadius: Radius.md, paddingHorizontal: Spacing.lg, paddingVertical: 10 },
  coConfirmText: { ...Typography.caption, color: '#fff', fontWeight: '700' },

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

  // Order-placed confirmation overlay
  placedOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(9,9,11,0.94)', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  placedCard: { alignItems: 'center', gap: 8, paddingHorizontal: Spacing.xl },
  placedIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: QuinckleColors.success, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  placedTitle: { ...Typography.title, color: QuinckleColors.textPrimary, fontWeight: '800' },
  placedSub: { ...Typography.body, color: QuinckleColors.textSecondary },
  placedHint: { ...Typography.caption, color: QuinckleColors.textTertiary, marginTop: 6 },
});
