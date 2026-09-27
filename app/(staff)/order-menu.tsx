/**
 * order-menu.tsx — Full-screen manual order screen for crew staff.
 *
 * Navigated to from [tableId].tsx via router.push.
 * Handles the complete flow: menu → cart → identity → payment.
 *
 * Features:
 *  - Category dropdown next to search bar (not a chips row)
 *  - Full-bleed photo tiles: name/price on a scrim over the item photo,
 *    veg/non-veg icon, real & discounted price, discount % badge
 *  - Collapsible per-item note input
 *  - KeyboardAvoidingView so search bar never hides behind keyboard
 *  - Modifier bottom sheet (BottomSheet component)
 *  - Identity modal → CollectionSheet for payment
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  FlatList,
  KeyboardAvoidingView,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  UIManager,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useResponsive } from '../../hooks/useResponsive';
import { useAuth } from '../../context/AuthContext';
import { useTableSessionStart, waitForTableSession, retryTableSession, startTableSession } from '../../services/tableSessionStart';
import { useTakeawaySessionStart, waitForTakeawaySession, retryTakeawaySession, startTakeawaySession } from '../../services/takeawaySessionStart';
import { signalOrderPlaced } from '../../services/orderPlacedSignal';
import { QuinckleColors, Radius, Spacing, Typography } from '../../constants/Colors';
import { normalizeChannel, isOffPremise, channelLabel } from '../../constants/channel';
import {
  crewSessions, crewOrders, crewDiners, crewMemberships, restaurantApi, crewOffers, crewPayments,
  type CollectSplitMethod,
} from '../../services/api';
import type { MenuItem, ModifierGroup, CrewOffer, CrewOrderPreview } from '../../services/api';
import { BottomSheet } from '../../components/ui/BottomSheet';
import { AdjustBillForm } from './adjust-bill';
import { CenteredModal } from '../../components/ui/CenteredModal';
import { CartReviewSheet, type CartLine } from '../../components/ui/CartReviewSheet';
import { GuestSheet } from '../../components/ui/GuestSheet';
import { SplitPaymentSheet } from '../../components/ui/SplitPaymentSheet';
import { DuePaymentSheet, type DuePaymentDetails } from '../../components/ui/DuePaymentSheet';
import { UpiPaymentSheet } from '../../components/ui/UpiPaymentSheet';
import { OrderSummaryIcon, CustomerIcon } from '../../components/ui/OrderBarIcons';
import { Skeleton } from '../../components/ui/Skeleton';
import { readCache, writeCache, cacheKeys } from '../../services/dataCache';
import { isDesktop } from '../../services/platform';

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

// ── Menu item row ─────────────────────────────────────────────────────────────

// media.quinckle.com uploads have Sharp-generated R2 variants (same convention
// as the diner web themes): `<base>.webp-thumb.webp` is the 400px thumb —
// enough for a ~170dp tile at 2-3x DPR. Legacy uploads without variants fall
// back to the base URL via onError.
const menuThumbUrl = (url: string) =>
  url.includes('media.quinckle.com') && url.endsWith('.webp') ? `${url}-thumb.webp` : url;

// One tile for every width — phone gets two columns, wider screens more.
// The photo IS the card: it fills the tile and the name/price sit on a scrim
// over its bottom edge, so a grid of food reads as food and not as a grid of
// buttons. Tapping anywhere adds one (items with options open the options
// sheet, same as before); the - qty + control appears on the scrim once
// something is in the order. Items with no photo keep the same tile shape and
// fall back to a watermark glyph, so rows never go ragged.
// Memoized: every prop is a per-card slice and every callback is identity-
// stable in the parent, so a tap re-renders only the card that changed.
const MenuItemCard = React.memo(function MenuItemCard({
  item, qty, note, onAdd, onRemove, onEditNote,
}: {
  item: MenuItem;
  qty: number;
  note: string;
  onAdd: (item: MenuItem) => void;
  onRemove: (itemId: string) => void;
  onEditNote: (itemId: string) => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const hasImage = !!item.imageUrl;
  const price = parseFloat(item.price);
  const origPrice = item.originalPrice ? parseFloat(item.originalPrice) : null;
  const discountPct = origPrice && origPrice > price
    ? Math.round(((origPrice - price) / origPrice) * 100) : 0;
  const hasMods = (item.modifierGroups?.length ?? 0) > 0;

  const add = () => {
    void Haptics.selectionAsync();
    onAdd(item);
  };

  // Tap feedback runs on transform and opacity ONLY. Nothing here may change the
  // card's box: the tile is a flex:1 item in a wrapping grid, and the old
  // selected state (borderWidth 1 → 2) made it ~2px bigger and reflowed every
  // card around it. Selection is now a colour change plus an overlay ring.
  const flash = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(1)).current;
  const prevQty = useRef(qty);
  useEffect(() => {
    if (qty > prevQty.current) {
      const native = Platform.OS !== 'web';
      flash.setValue(1);
      Animated.timing(flash, { toValue: 0, duration: 340, easing: Easing.out(Easing.quad), useNativeDriver: native }).start();
      pop.setValue(1.45);
      Animated.spring(pop, { toValue: 1, friction: 4, tension: 220, useNativeDriver: native }).start();
    }
    prevQty.current = qty;
  }, [qty, flash, pop]);

  return (
    <Pressable
      onPress={add}
      style={({ pressed }) => [cardStyles.card, qty > 0 && cardStyles.cardActive, pressed && cardStyles.cardPressed]}
      accessibilityRole="button"
      accessibilityLabel={`Add ${item.name}, ₹${price.toFixed(0)}${qty > 0 ? `, ${qty} in order` : ''}`}
    >
      {hasImage ? (
        <>
          <Image
            source={{ uri: imgFailed ? item.imageUrl! : menuThumbUrl(item.imageUrl!) }}
            style={cardStyles.img}
            contentFit="cover"
            cachePolicy="disk"
            transition={0}
            onError={() => setImgFailed(true)}
          />
          {/* Keeps the name legible over a bright photo without dimming the dish. */}
          <LinearGradient
            colors={['transparent', 'rgba(10,10,11,0.55)', 'rgba(10,10,11,0.94)']}
            locations={[0, 0.45, 1]}
            style={cardStyles.scrim}
            pointerEvents="none"
          />
        </>
      ) : (
        <View style={cardStyles.watermark} pointerEvents="none">
          <Ionicons name="fast-food-outline" size={34} color={QuinckleColors.textMuted} />
        </View>
      )}

      {/* Selected ring, drawn over the tile so it takes no space. */}
      {qty > 0 && <View style={cardStyles.ring} pointerEvents="none" />}
      {/* One warm pulse each time an item is added. */}
      <Animated.View style={[cardStyles.flash, { opacity: flash }]} pointerEvents="none" />

      {discountPct > 0 && (
        <View style={cardStyles.discountBadge}>
          <Text style={cardStyles.discountText}>{discountPct}% OFF</Text>
        </View>
      )}
      {/* How many are in the order, readable from across the grid. */}
      {qty > 0 && (
        <Animated.View style={[cardStyles.qtyBadge, { transform: [{ scale: pop }] }]}>
          <Text style={cardStyles.qtyBadgeText}>{qty}</Text>
        </Animated.View>
      )}

      <View style={cardStyles.info}>
        <View style={cardStyles.nameRow}>
          <VegIcon isVeg={item.isVeg} />
          <Text style={cardStyles.name} numberOfLines={2}>{item.name}</Text>
        </View>
        <View style={cardStyles.priceRow}>
          <Text style={cardStyles.price}>₹{price.toFixed(0)}</Text>
          {origPrice && discountPct > 0 && (
            <Text style={cardStyles.originalPrice}>₹{origPrice.toFixed(0)}</Text>
          )}
          {hasMods && <Text style={cardStyles.optionsLabel}>+ options</Text>}
        </View>
        {!!note && <Text style={cardStyles.note} numberOfLines={1}>{note}</Text>}

        {/* Only once something is in the order — an empty tile stays all photo.
            The buttons take their own presses, so - never also adds. */}
        {qty > 0 && (
          <View style={cardStyles.controls}>
            <View style={cardStyles.qtyControl}>
              <TouchableOpacity onPress={() => onRemove(item.id)} style={cardStyles.qtyBtn} hitSlop={6} accessibilityLabel={`One less ${item.name}`}>
                <Ionicons name="remove" size={17} color={QuinckleColors.primary} />
              </TouchableOpacity>
              <Text style={cardStyles.qtyText}>{qty}</Text>
              <TouchableOpacity onPress={add} style={cardStyles.qtyBtn} hitSlop={6} accessibilityLabel={`One more ${item.name}`}>
                <Ionicons name="add" size={17} color={QuinckleColors.primary} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              onPress={() => onEditNote(item.id)}
              style={[cardStyles.noteBtn, !!note && cardStyles.noteBtnOn]}
              hitSlop={4}
              accessibilityLabel={note ? `Edit note for ${item.name}` : `Add note for ${item.name}`}
            >
              <Ionicons name="create-outline" size={15} color={note ? '#fff' : QuinckleColors.textSecondary} />
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Pressable>
  );
});

function CardSkeleton() {
  // Darker than the tile so the pulsing block reads against it.
  return (
    <View style={[cardStyles.card, { backgroundColor: QuinckleColors.surface }]}>
      <Skeleton radius={0} style={StyleSheet.absoluteFillObject} />
    </View>
  );
}

const cardStyles = StyleSheet.create({
  // Portrait tile: tall enough for the photo to carry the card, short enough
  // that two rows still fit on a phone screen.
  card: {
    flex: 1,
    aspectRatio: 0.82,
    backgroundColor: QuinckleColors.surfaceElevated,
    borderRadius: Radius.lg,
    // Same width in every state (see MenuItemCard). flex:1 splits the row using
    // each item's border, so a card whose border differs ends up a different size.
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    minWidth: 0,
    overflow: 'hidden',
    justifyContent: 'flex-end',
    ...(Platform.OS === 'web'
      ? ({ transitionProperty: 'transform, border-color', transitionDuration: '120ms', transitionTimingFunction: 'ease-out' } as any)
      : null),
  },
  // Colour only — never a width.
  cardActive: { borderColor: QuinckleColors.primary },
  // Press-down: a transform, so it moves nothing else. Springs back on release.
  cardPressed: { transform: [{ scale: 0.965 }] },
  // Inside the 1px border, so together they read as a 2px edge without growing it.
  ring: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1,
    borderColor: QuinckleColors.primary,
    borderRadius: Radius.lg - 1,
    backgroundColor: 'rgba(243,93,59,0.07)',
  },
  flash: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(243,93,59,0.30)' },
  img: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '62%' },
  // Centred in the whole tile (not just the top, image-scrim region) — a no-
  // photo item has no bottom scrim to anchor against, so the top-58% box the
  // photo case uses left the glyph stranded near the top with a dead gap
  // above the name/price. The name/price block is short enough that it never
  // reaches the middle of the tile, so a full-tile centre never collides.
  watermark: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  discountBadge: {
    position: 'absolute', top: 7, left: 7,
    backgroundColor: QuinckleColors.success, borderRadius: Radius.pill,
    paddingHorizontal: 7, paddingVertical: 3,
  },
  discountText: { fontSize: 10, fontWeight: '700', color: '#0A0A0B' },
  qtyBadge: {
    position: 'absolute', top: 7, right: 7, minWidth: 26, height: 26, paddingHorizontal: 7,
    borderRadius: 13, backgroundColor: QuinckleColors.primary, alignItems: 'center', justifyContent: 'center',
  },
  qtyBadgeText: { color: '#fff', fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },
  info: { padding: Spacing.sm + 2, gap: 4 },
  nameRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 5 },
  name: { flex: 1, ...Typography.caption, color: '#FAFAFA', fontWeight: '600', lineHeight: 16 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 5, flexWrap: 'wrap' },
  price: { fontSize: 15, fontWeight: '700', color: '#FAFAFA', letterSpacing: -0.3 },
  originalPrice: { fontSize: 11, color: 'rgba(255,255,255,0.55)', textDecorationLine: 'line-through' },
  optionsLabel: { fontSize: 10, fontWeight: '600', color: QuinckleColors.primaryLight },
  note: { fontSize: 11, color: 'rgba(255,255,255,0.6)', fontStyle: 'italic' },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  qtyControl: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: 'rgba(10,10,11,0.72)', borderRadius: Radius.md,
    borderWidth: 1, borderColor: QuinckleColors.primarySoftBorder, height: 32, overflow: 'hidden',
  },
  qtyBtn: { width: 34, height: '100%', alignItems: 'center', justifyContent: 'center' },
  qtyText: { fontSize: 14, color: QuinckleColors.primary, fontWeight: '700', minWidth: 16, textAlign: 'center' },
  noteBtn: {
    width: 32, height: 32, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: QuinckleColors.borderStrong, backgroundColor: 'rgba(10,10,11,0.72)',
  },
  // A note is already on this item: solid orange, so it reads from across the grid.
  noteBtnOn: { backgroundColor: QuinckleColors.primary, borderColor: QuinckleColors.primary },
});

// ── Item note modal ───────────────────────────────────────────────────────────
// A centred card: the dish (photo + name) top-left, close top-right, the note
// below, and a Save button. The text is a DRAFT — only Save writes it to the
// cart, so the cross, the backdrop and Escape all discard an edit. (The old
// bottom sheet wrote every keystroke straight into the cart.)

const NOTE_MAX = 200;
const NOTE_MARK_SIZE = 14;   // VegIcon's box
const NOTE_MARK_GAP = 6;
const NOTE_NAME_LINE = 20;

function NoteModal({ wide, visible, item, initial, onSave, onClose }: {
  /** Wide layouts (desktop, tablet landscape) get a centred modal; phones keep a bottom sheet. */
  wide: boolean;
  visible: boolean;
  item: MenuItem | null;
  initial: string;
  onSave: (text: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [imgFailed, setImgFailed] = useState(false);

  // Start from the saved note each time the modal opens.
  useEffect(() => { if (visible) setDraft(initial); }, [visible, initial]);
  useEffect(() => { setImgFailed(false); }, [item?.id]);

  if (!item) return null;
  const price = parseFloat(item.price);
  const save = () => onSave(draft.trim());

  const content = (
      <View style={noteStyles.body}>
        <View style={noteStyles.header}>
          <View style={noteStyles.thumb}>
            {item.imageUrl ? (
              <Image
                source={{ uri: imgFailed ? item.imageUrl : menuThumbUrl(item.imageUrl) }}
                style={StyleSheet.absoluteFillObject}
                contentFit="cover"
                cachePolicy="disk"
                transition={0}
                onError={() => setImgFailed(true)}
              />
            ) : (
              <Ionicons name="fast-food-outline" size={22} color={QuinckleColors.textMuted} />
            )}
          </View>
          <View style={noteStyles.headText}>
            <View style={noteStyles.nameRow}>
              <View style={noteStyles.vegMark}><VegIcon isVeg={item.isVeg} /></View>
              <Text style={noteStyles.name} numberOfLines={2}>{item.name}</Text>
            </View>
            <Text style={noteStyles.price}>₹{price.toFixed(0)}</Text>
          </View>
          <Pressable onPress={onClose} style={noteStyles.close} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close note">
            <Ionicons name="close" size={18} color={QuinckleColors.textSecondary} />
          </Pressable>
        </View>

        <View style={noteStyles.labelRow}>
          <Text style={noteStyles.label}>NOTE FOR THE KITCHEN</Text>
          <Text style={noteStyles.count}>{draft.length}/{NOTE_MAX}</Text>
        </View>
        <TextInput
          style={noteStyles.input}
          placeholder="e.g. no onions, extra spicy…"
          placeholderTextColor={QuinckleColors.textMuted}
          value={draft}
          onChangeText={setDraft}
          multiline
          maxLength={NOTE_MAX}
          autoFocus
          // Enter saves (Shift+Enter is a new line) — a note is a line or two,
          // and on a till the keyboard is the fast path.
          onKeyPress={(e: any) => {
            if (Platform.OS === 'web' && e.nativeEvent?.key === 'Enter' && !e.nativeEvent?.shiftKey) {
              e.preventDefault?.();
              save();
            }
          }}
        />

        <TouchableOpacity style={noteStyles.save} onPress={save} activeOpacity={0.85} accessibilityRole="button">
          <Text style={noteStyles.saveText}>Save note</Text>
        </TouchableOpacity>
      </View>
  );

  return wide ? (
    <CenteredModal visible={visible} onClose={onClose} maxWidth={460} backdropColor="rgba(0,0,0,0.84)">{content}</CenteredModal>
  ) : (
    <BottomSheet visible={visible} onClose={onClose}>{content}</BottomSheet>
  );
}

const noteStyles = StyleSheet.create({
  body: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.lg },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.lg },
  thumb: {
    width: 52, height: 52, borderRadius: 26, overflow: 'hidden',
    backgroundColor: QuinckleColors.surfaceElevated, borderWidth: 1, borderColor: QuinckleColors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  headText: { flex: 1, minWidth: 0, gap: 3 },
  nameRow: { flexDirection: 'row', alignItems: 'flex-start', gap: NOTE_MARK_GAP },
  // The 14px marker centred on the name's first line (20px line height).
  vegMark: { width: NOTE_MARK_SIZE, height: NOTE_NAME_LINE, alignItems: 'center', justifyContent: 'center' },
  name: { flex: 1, color: QuinckleColors.textPrimary, fontSize: 15, fontWeight: '600', lineHeight: NOTE_NAME_LINE },
  // Flush left, under the veg marker.
  price: { color: QuinckleColors.textTertiary, fontSize: 13, fontWeight: '600' },
  close: {
    width: 30, height: 30, borderRadius: 15, alignSelf: 'flex-start',
    alignItems: 'center', justifyContent: 'center', backgroundColor: QuinckleColors.surfaceMuted,
  },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.sm },
  label: { ...Typography.label, color: QuinckleColors.textTertiary },
  input: {
    minHeight: 96, maxHeight: 180, textAlignVertical: 'top',
    backgroundColor: QuinckleColors.surfaceElevated, borderRadius: Radius.md,
    borderWidth: 1, borderColor: QuinckleColors.border,
    paddingHorizontal: Spacing.md, paddingVertical: 12,
    color: QuinckleColors.textPrimary, fontSize: 15, lineHeight: 21,
    marginBottom: Spacing.lg,
  },
  count: { color: QuinckleColors.textMuted, fontSize: 11, fontVariant: ['tabular-nums'] },
  save: {
    height: 48, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center',
    backgroundColor: QuinckleColors.primary,
  },
  saveText: { color: '#fff', fontSize: 15, fontWeight: '700' },
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

// Same icons as payment-collect.tsx's "How are they paying?" row — a preset
// picked here is a shortcut into that same choice, not a second vocabulary.
// One accent (primary orange) for all of them, on/off, the same soft-pill
// language footerIconBtn already uses two rows down — so the whole capsule
// reads as one design, not five methods each arguing for their own color.
const PAYMENT_METHODS: { key: 'PENDING' | 'CASH' | 'UPI' | 'SPLIT' | 'DUE'; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'PENDING', label: 'Pending', icon: 'ellipsis-horizontal-circle-outline' },
  { key: 'CASH', label: 'Cash', icon: 'cash-outline' },
  { key: 'UPI', label: 'UPI', icon: 'qr-code-outline' },
  { key: 'SPLIT', label: 'Split', icon: 'git-compare-outline' },
  { key: 'DUE', label: 'Due', icon: 'time-outline' },
];

export default function OrderMenuScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { staffInfo } = useAuth();
  const { isWide, width, height } = useResponsive();

  // Grid columns for the wide POS layout — target ~200dp per card in the space
  // left of the category rail, clamped so cards never get comically wide/thin.
  // Off the wide layout (phones, tablet portrait) the grid has the full width:
  // two cards on a phone, three or four on a tablet held upright.
  const gridColumns = useMemo(() => {
    const avail = isWide ? width - RAIL_WIDTH - Spacing.xl * 2 : width - Spacing.lg * 2;
    const target = isWide ? 200 : 170;
    return Math.max(2, Math.min(isWide ? 5 : 4, Math.floor(avail / target)));
  }, [width, isWide]);

  const {
    tableId,
    tableNum: paramTableNum,
    tableDbId,
    sessionId: paramSessionId,
    pendingStart,
    customerPhone: paramPhone,
    customerName: paramName,
    channel: paramChannel,
    pickupToken: paramPickupToken,
    zoneName: paramZoneName,
  } = useLocalSearchParams<{
    tableId: string;
    tableNum: string;
    tableDbId: string;
    sessionId: string;
    /** '1' when opened straight from the table grid, before the session exists. */
    pendingStart?: string;
    customerPhone: string;
    customerName: string;
    channel: string;
    pickupToken: string;
    zoneName?: string;
  }>();

  // Off-premise covers TAKEAWAY *and* DELIVERY — both are tableless and both
  // take the packed-food price. `channel` is kept exact where it matters (the
  // menu fetch below), because a delivery order must load the DELIVERY menu.
  // Computed before the background-start hooks below, which need to know
  // which kind of pending start `pendingStart === '1'` refers to.
  const channel = normalizeChannel(paramChannel);
  const isTakeaway = isOffPremise(channel);
  const orderLabel = channelLabel(channel);
  const tableNum = paramTableNum ?? String(tableId ?? '').padStart(2, '0');

  // A table opened straight from the grid arrives with no session yet: it is
  // being created in the background (services/tableSessionStart.ts). Browsing
  // the menu and building a cart never needed it — only the bill preview and
  // placing the order do — so the screen opens at once and picks the id up here.
  const bgStart = useTableSessionStart(pendingStart === '1' && !isTakeaway ? tableDbId : undefined);
  // A takeaway order opened from the '+' button arrives the same way — see
  // services/takeawaySessionStart.ts and index.tsx's startTakeawayOrder.
  const bgTakeawayStart = useTakeawaySessionStart(pendingStart === '1' && isTakeaway);
  const sessionId = paramSessionId
    || (bgStart?.phase === 'ready' ? bgStart.sessionId : '')
    || (bgTakeawayStart?.phase === 'ready' ? bgTakeawayStart.sessionId : '');

  // The route survives a reload but the in-memory record of the start does not.
  // If we were opened pending and nothing is being tracked, begin (or adopt, for
  // a table) the session now, so the screen recovers instead of stranding the cart.
  useEffect(() => {
    if (pendingStart !== '1' || paramSessionId) return;
    if (isTakeaway) {
      if (!bgTakeawayStart) void startTakeawaySession().catch(() => {});
    } else if (tableDbId && !bgStart) {
      void startTableSession(tableDbId).catch(() => {});
    }
  }, [pendingStart, isTakeaway, tableDbId, paramSessionId, bgStart, bgTakeawayStart]);

  // Starts from the route (DELIVERY always arrives already tokened) or from a
  // page reload after placing. A fresh takeaway session has none yet — the
  // backend mints one the moment its first order actually lands (see
  // takeaway.routes.ts / crew/orders.service.ts) — confirmAndPlace below reads
  // that fresh token off placeOrder's response and stores it here.
  const [pickupToken, setPickupToken] = useState(paramPickupToken || null);

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
  const [reviewOpen, setReviewOpen] = useState(false);

  // ── Modifiers ──────────────────────────────────────────────────────────────
  const [modifierItem, setModifierItem] = useState<MenuItem | null>(null);
  const [pendingMods, setPendingMods] = useState<Record<string, string[]>>({});

  // ── Footer animation refs (effect wired after cartCount is declared below) ──
  const footerAnim = useRef(new Animated.Value(0)).current;
  const [footerMounted, setFooterMounted] = useState(false);

  // ── Customer (name + phone, edited in the GuestSheet) / placing ────────────
  const [contactOpen, setContactOpen] = useState(false);
  const [coPhone, setCoPhone] = useState('');
  const [coName, setCoName] = useState('');
  const [coLooking, setCoLooking] = useState(false);
  const [coFound, setCoFound] = useState<boolean | null>(null);
  const [coLookupFailed, setCoLookupFailed] = useState(false);
  const [coVisits, setCoVisits] = useState<number | null>(null);
  const [coMember, setCoMember] = useState<boolean | null>(null);
  const [coSubmitting, setCoSubmitting] = useState(false);
  const [coError, setCoError] = useState<string | null>(null);

  // Takeaway is often paid right at the counter when the order is placed —
  // unlike dine-in, which always collects after. 'PENDING' is today's
  // behaviour: land on payment-collect and choose there — the only one of the
  // five that still opens that screen. Cash/UPI/Split/Due are all resolved
  // right here instead: Cash needs nothing more (the chip alone is the
  // choice), UPI opens a sheet for the QR, Split/Due open a sheet for the
  // numbers a real order doesn't exist to hang them on yet — and whichever
  // was chosen, confirmAndPlace calls crewPayments.collectPayment directly
  // the moment the order exists (the same call payment-collect.tsx's own
  // modes make), never that screen.
  const [paymentMethod, setPaymentMethod] = useState<'PENDING' | 'CASH' | 'UPI' | 'SPLIT' | 'DUE'>('PENDING');
  const [upiSheetOpen, setUpiSheetOpen] = useState(false);
  const [splitSheetOpen, setSplitSheetOpen] = useState(false);
  const [splitDetails, setSplitDetails] = useState<{ cash: number; upi: number } | null>(null);
  const [dueSheetOpen, setDueSheetOpen] = useState(false);
  const [dueDetails, setDueDetails] = useState<DuePaymentDetails | null>(null);

  // Keep session customer for pre-fill
  const [sessionCustomerPhone, setSessionCustomerPhone] = useState(paramPhone || null);
  const [sessionCustomerName, setSessionCustomerName] = useState(paramName || null);

  // ── Load menu + offers on mount — stale-while-revalidate ──────────────────
  // The cached copy paints instantly (no skeleton on repeat opens); the fresh
  // fetch always runs and replaces it, so the list is at most one open stale.
  useEffect(() => {
    const rid = staffInfo?.restaurantId;
    if (!rid) return;
    // DINE_IN uses the CREW catalogue (dine-in items + staff special charges);
    // off-premise channels use their own, so a delivery order gets exactly the
    // items the owner marked deliverable.
    const menuChannel = isTakeaway ? channel : 'CREW';
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
    readCache<any[]>(cacheKeys.crewOrderMenu(rid, menuChannel)).then(cats => {
      if (!cancelled && !freshLanded && cats?.length) applyMenu(cats);
    });

    // 'CREW' → dine-in menu + crew-only special charges (e.g. birthday fees)
    // that diners never see but staff can add to a bill.
    // Takeaway sessions get the TAKEAWAY menu so per-channel availability is
    // respected (CREW-only special charges stay dine-in).
    restaurantApi.getMenu(rid, menuChannel)
      .then(res => {
        const cats: any[] = (res as any)?.data ?? [];
        writeCache(cacheKeys.crewOrderMenu(rid, menuChannel), cats);
        if (cancelled) return;
        freshLanded = true;
        applyMenu(cats);
      })
      .catch(() => { if (!cancelled) setIsMenuLoading(false); });

    return () => { cancelled = true; };
  }, [staffInfo?.restaurantId, isTakeaway, channel]);

  // ── Offers — its own effect, on purpose ────────────────────────────────────
  // This used to share the effect above. The session id can now arrive AFTER
  // mount (table opened from the grid), and re-running the shared effect would
  // refetch the menu and flash its skeleton. Offers may safely re-run: with the
  // id they also return the session's prior subtotal for the progress nudge.
  useEffect(() => {
    const rid = staffInfo?.restaurantId;
    if (!rid) return;
    let cancelled = false;

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
  }, [staffInfo?.restaurantId, sessionId]);

  // ── Cart helpers — identity-stable so MenuItemCard's React.memo holds ──────
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

  // Notes live in a sheet now — a two-column card has no room for an inline
  // field. The pencil on a card that's in the order opens it.
  const [noteItemId, setNoteItemId] = useState<string | null>(null);
  const handleEditNote = useCallback((itemId: string) => setNoteItemId(itemId), []);

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

  // The table's saved customer (from the params) pre-fills the sheet once, so
  // opening it shows who the bill is already attached to.
  useEffect(() => {
    if (!sessionCustomerPhone) return;
    const digits = sessionCustomerPhone.replace(/\D/g, '').slice(-10);
    if (digits.length !== 10) return;
    setCoPhone(digits);
    setCoName(sessionCustomerName ?? '');
    setCoFound(true);
    void lookupGuest(digits, { keepName: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The exact payload placeOrder sends — the bill preview posts the same one,
  // so the projection is priced from what will actually be ordered.
  const buildOrderItems = useCallback(() => Object.entries(cart).map(([item_id, qty]) => {
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
  }), [cart, cartModifiers, cartNotes, menuItems]);

  // Projected bill for the order summary: this order plus what the session
  // already owes (dine-in: the table's running bill; takeaway: any charges an
  // Adjust Bill trip has added), CGST/SGST split, priced by the server with
  // the same code that places the order. Nothing is computed here. Debounced,
  // and a late answer for an older cart never overwrites a newer one.
  const [billPreview, setBillPreview] = useState<CrewOrderPreview | null>(null);
  const [billPreviewState, setBillPreviewState] = useState<'idle' | 'loading' | 'error'>('idle');
  const previewSeq = useRef(0);
  const showBillPreview = !!sessionId;
  // Adjust Bill (container charges, tip) is a session-level change the preview
  // can't see until it re-runs — bumped from its onSaved below.
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);
  useEffect(() => {
    if (!reviewOpen || !showBillPreview) return;
    const items = buildOrderItems();
    if (items.length === 0) { setBillPreview(null); return; }
    const seq = ++previewSeq.current;
    setBillPreviewState('loading');
    const t = setTimeout(() => {
      crewOrders.previewOrder(sessionId!, items)
        .then((res) => {
          if (seq !== previewSeq.current) return;
          setBillPreview(res.data);
          setBillPreviewState('idle');
        })
        .catch(() => { if (seq === previewSeq.current) setBillPreviewState('error'); });
    }, 300);
    return () => clearTimeout(t);
  }, [reviewOpen, showBillPreview, sessionId, buildOrderItems, previewRefreshKey]);

  const confirmAndPlace = async () => {
    const phone = coPhone.replace(/\D/g, '');
    if (phone.length > 0 && phone.length !== 10) {
      setCoError('Enter a valid 10-digit number, or leave blank for a walk-in guest.');
      setContactOpen(true);
      return;
    }
    const items = buildOrderItems();
    if (items.length === 0) { setCoError('Cart is empty.'); return; }
    const waitingOnStart = !sessionId && pendingStart === '1' && (isTakeaway || !!tableDbId);
    if (!sessionId && !waitingOnStart) { setCoError('No active session. Go back and try again.'); return; }

    const snapshotTotal = cartTotal;
    const snapshotCount = cartCount;
    const guestPhone = phone.length === 10 ? phone : '';
    const guestName = coName.trim() || null;

    setCoSubmitting(true);
    setCoError(null);
    try {
      // Normally ready long before Place is pressed. If not, wait for it here —
      // the button is already showing its spinner — rather than failing.
      const sid = sessionId || (isTakeaway ? (await waitForTakeawaySession()).sessionId : await waitForTableSession(tableDbId!));
      if (guestPhone) {
        crewSessions.saveCustomer(sid, guestPhone, guestName).catch(() => {});
        setSessionCustomerPhone(guestPhone);
        if (guestName) setSessionCustomerName(guestName);
      }

      const orderRes = await crewOrders.placeOrder(sid, items);
      const orderId = orderRes?.order_id ?? '';
      // The one moment a fresh takeaway session learns its token — see
      // takeaway.routes.ts / crew/orders.service.ts's placeOrder.
      const freshPickupToken = orderRes?.pickup_token ?? null;
      if (freshPickupToken) setPickupToken(freshPickupToken);

      setCart({});
      setCartNotes({});
      setCartModifiers({});

      // placeOrder already returns the full payable total (tax included) —
      // payment-collect re-fetches its own context anyway, so no extra
      // round trip here.
      let orderTotal = Number(orderRes?.total ?? 0);
      if (!Number.isFinite(orderTotal) || orderTotal <= 0) orderTotal = snapshotTotal;

      if (!Number.isFinite(orderTotal) || orderTotal <= 0) {
        router.back();
        return;
      }

      // Leave order-menu immediately — the confirmation is a toast that drops
      // in on the destination screen (see SuccessToast), not a card this
      // screen holds up first. Takeaway has no table screen to return to, so
      // it always goes to payment-collect directly.
      const placedAmount = String(orderTotal);
      const placedCount = String(snapshotCount);

      // Cash/UPI/Split/Due were all resolved on the pill BEFORE placing (see
      // PAYMENT_METHODS and the three sheets above) — collect right here with
      // the same call payment-collect.tsx's own modes make, and NEVER open
      // that screen for any of them: not on success, not on a failed collect
      // either — the order is already placed either way, so there is nothing
      // left for that screen to do except ask the question again. A failed
      // collect stays visible instead as an alert plus a toast staff can act
      // on (Dues / cash-collection), not a silent retry. Only 'PENDING' — no
      // method chosen — still lands there, same as always.
      if (isTakeaway && paymentMethod !== 'PENDING') {
        const splits: { method: CollectSplitMethod; amount: number }[] = [];
        let dueOptions: { customerPhone: string; customerName?: string | null } | null = null;
        if (paymentMethod === 'CASH') {
          splits.push({ method: 'CASH', amount: orderTotal });
        } else if (paymentMethod === 'UPI') {
          splits.push({ method: 'UPI_DIRECT', amount: orderTotal });
        } else if (paymentMethod === 'SPLIT' && splitDetails) {
          splits.push({ method: 'CASH', amount: splitDetails.cash });
          splits.push({ method: 'UPI_DIRECT', amount: splitDetails.upi });
        } else if (paymentMethod === 'DUE' && dueDetails) {
          if (dueDetails.paidNow > 0) splits.push({ method: dueDetails.paidMethod, amount: dueDetails.paidNow });
          splits.push({ method: 'DUE', amount: Math.max(0, orderTotal - dueDetails.paidNow) });
          dueOptions = { customerPhone: dueDetails.phone, customerName: dueDetails.name || null };
        }

        const successLabel = paymentMethod === 'DUE' ? 'Recorded on khata'
          : paymentMethod === 'SPLIT' ? 'Split payment collected'
          : paymentMethod === 'UPI' ? 'UPI collected'
          : 'Cash collected';
        let collectedLabel = successLabel;
        if (splits.length > 0 && orderId && staffInfo?.id) {
          try {
            const sig = splits.map((s) => `${s.method}:${s.amount.toFixed(2)}`).join('|');
            await crewPayments.collectPayment(orderId, staffInfo.id, splits, `crew-collect:${orderId}:${sig}`, null, dueOptions);
          } catch (e: any) {
            collectedLabel = 'Payment not recorded — collect manually';
            Alert.alert(
              'Order placed, payment not recorded',
              `${e?.message ?? 'Could not record the payment automatically.'} Find the order in Takeaway and collect it from there.`,
            );
          }
        } else {
          collectedLabel = 'Payment not recorded — collect manually';
        }

        router.replace({
          pathname: '/(staff)',
          // `replace` to a route that's already lower in the stack mounts a
          // FRESH instance rather than popping back to the existing one (see
          // the [tableId] dismissTo comment below for the same quirk) — so
          // the dashboard's activeTab resets to its 'tables' default. Tell it
          // to land on Takeaway instead of leaving the crew looking at the
          // table floor for the order they just placed.
          params: { placedAmount, placedCount, collectedLabel, tab: 'takeaway', selectOrderId: orderId },
        });
        return;
      }

      if (isTakeaway) {
        // Only reached with 'PENDING' now — every other method returned
        // above — so this is "pay later". On the Electron desktop shell the
        // takeaway board's own panel now has a proper Collect Payment sheet
        // (see index.tsx's takeawayCollectTarget), so land there instead of
        // forcing the phone's full-screen payment-collect immediately after
        // every single order — the crew can collect from the panel whenever
        // the order's actually ready.
        if (isDesktop()) {
          router.replace({
            pathname: '/(staff)',
            params: { placedAmount, placedCount, tab: 'takeaway', selectOrderId: orderId },
          });
          return;
        }
        router.replace({
          pathname: '/(staff)/payment-collect',
          params: {
            orderId,
            tableNumber: String(tableId ?? 0),
            channel,
            pickupToken: freshPickupToken ?? pickupToken ?? '',
            amount: String(orderTotal),
            customerName: guestName ?? '',
            customerPhone: guestPhone,
            placedAmount,
            placedCount,
          },
        });
      } else if (isWide) {
        // Desktop: order-menu is always pushed straight from the table grid
        // now (an available table's CTA, or "Add items" on the grid's own
        // side panel) — there is no [tableId] route screen underneath it to
        // dismiss to. The grid is, so a plain pop reveals it with the panel
        // already pointed at this table; it picks up the fresh session/order
        // on its own next refresh (loadTables already runs once the
        // background session-start settles).
        //
        // pendingStart === '1' only on the "was free, first order" path —
        // mark it so the panel plays the order-placed curtain instead of
        // just swapping the placeholder for the bill. "Add items" on a table
        // already showing its bill has nothing to reveal, so it's skipped.
        if (pendingStart === '1' && tableDbId) signalOrderPlaced(tableDbId);
        router.back();
      } else {
        // Dine-in returns to [tableId] with the bill breakdown forced open —
        // so the crew reviews exactly what was ordered — instead of jumping
        // straight to payment collection.
        //
        // dismissTo (not replace) pops back to the [tableId] instance already
        // in the stack — the one we were pushed from — updating its params.
        // Using replace here mounted a *second* [tableId] on top of the
        // original, which is why the crew had to hit Back twice to reach the
        // table floor.
        router.dismissTo({
          pathname: '/(staff)/[tableId]',
          params: {
            tableId: String(tableId ?? 0),
            sessionId: sid,
            tableDbId: tableDbId ?? '',
            zoneName: paramZoneName ?? '',
            openBill: '1',
            placedAmount,
            placedCount,
          },
        });
      }
    } catch (e: any) {
      setCoError(e?.message ?? 'Failed to place order. Try again.');
    } finally {
      setCoSubmitting(false);
    }
  };

  // Container charges, tip, party size — the same form the takeaway board
  // opens full-screen on an already-placed order (index.tsx's openAdjustBill),
  // but here it opens AS ITS OWN BOTTOM SHEET, stacked on top of the still-open
  // order summary sheet (both are plain absolutely-positioned overlays, not
  // native Modals, so mounting one after the other in the tree is enough for
  // it to paint on top) — not a screen that replaces it. Charges live on the
  // SESSION, not the order, so setting one now is exactly what makes the
  // projected bill underneath right the moment this order does land.
  // `dismissible={false}` for the same reason [tableId].tsx's desktop command
  // rail sets it on this same embedded form: a part-typed bill has no business
  // being thrown away by a stray swipe.
  const [adjustBillBusy, setAdjustBillBusy] = useState(false);
  const [adjustSheetOpen, setAdjustSheetOpen] = useState(false);
  const [adjustSessionId, setAdjustSessionId] = useState('');
  const openAdjustBillFromMenu = async () => {
    if (adjustBillBusy) return;
    setAdjustBillBusy(true);
    try {
      const sid = sessionId || (isTakeaway ? (await waitForTakeawaySession()).sessionId : await waitForTableSession(tableDbId!));
      setAdjustSessionId(sid);
      setAdjustSheetOpen(true);
    } catch (e: any) {
      setCoError(e?.message ?? 'Could not open Adjust Bill. Try again.');
    } finally {
      setAdjustBillBusy(false);
    }
  };
  const closeAdjustBillFromMenu = () => setAdjustSheetOpen(false);

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

  // Grid card renderer — phone and tablet alike.
  const renderCard = useCallback(({ item }: { item: MenuItem }) => {
    if ((item as any).__filler) return <View style={{ flex: 1 }} />;
    return (
      <MenuItemCard
        item={item}
        qty={cart[item.id] ?? 0}
        note={cartNotes[item.id] ?? ''}
        onAdd={handleAddPress}
        onRemove={removeFromCart}
        onEditNote={handleEditNote}
      />
    );
  }, [cart, cartNotes, handleAddPress, removeFromCart, handleEditNote]);

  const noteItem = noteItemId ? menuItems.find(m => m.id === noteItemId) ?? null : null;
  // Keep the last item around so the modal can play its close animation after
  // noteItemId has already been cleared.
  const lastNoteItem = useRef<MenuItem | null>(null);
  if (noteItem) lastNoteItem.current = noteItem;
  const noteSheetJsx = (
    <NoteModal
      wide={isWide}
      visible={!!noteItem}
      item={noteItem ?? lastNoteItem.current}
      initial={noteItemId ? cartNotes[noteItemId] ?? '' : ''}
      onSave={(text) => { if (noteItemId) handleChangeNote(noteItemId, text); setNoteItemId(null); }}
      onClose={() => setNoteItemId(null)}
    />
  );

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

  // A floating pill, not a docked bar: it hovers over the bottom of the menu and
  // the grid scrolls underneath it. The wrapper spans the width but ignores
  // touches (box-none), so only the pill itself takes them.
  const footerJsx = footerMounted && (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.footer,
        { bottom: insets.bottom + Spacing.lg },
        {
          opacity: footerAnim,
          transform: [{ translateY: footerAnim.interpolate({ inputRange: [0, 1], outputRange: [56, 0] }) }],
        },
      ]}
    >
      {/* A failed placement surfaces here — the guest sheet shows its own
          copy of the error, so this only appears while that sheet is closed. */}
      {coError && !contactOpen ? (
        <TouchableOpacity style={styles.footerError} onPress={() => setCoError(null)} activeOpacity={0.85}>
          <Ionicons name="alert-circle" size={14} color={QuinckleColors.danger} />
          <Text style={styles.footerErrorText} numberOfLines={2}>{coError}</Text>
        </TouchableOpacity>
      ) : null}
      <View style={styles.footerPill}>
        {isTakeaway && (
          <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.paymentChipRow}
          >
            {PAYMENT_METHODS.map((m) => {
              const on = paymentMethod === m.key;
              // Split/Due need real numbers before they mean anything — the
              // chip opens the sheet that captures them (re-opens it, already
              // filled in, to edit) rather than selecting blind.
              const label =
                m.key === 'SPLIT' && splitDetails ? `Split · ₹${splitDetails.cash}+₹${splitDetails.upi}`
                : m.key === 'DUE' && dueDetails ? `Due · ₹${Math.max(0, cartTotal - dueDetails.paidNow)}`
                : m.label;
              return (
                <TouchableOpacity
                  key={m.key}
                  style={[styles.paymentChip, on && styles.paymentChipOn]}
                  onPress={() => {
                    if (m.key === 'UPI') setUpiSheetOpen(true);
                    else if (m.key === 'SPLIT') setSplitSheetOpen(true);
                    else if (m.key === 'DUE') setDueSheetOpen(true);
                    else setPaymentMethod(m.key);
                  }}
                  activeOpacity={0.75}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                >
                  <Ionicons name={m.icon} size={13} color={on ? '#fff' : QuinckleColors.primary} />
                  <Text style={[styles.paymentChipText, on && styles.paymentChipTextOn]}>{label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <View style={styles.paymentChipDivider} />
          </>
        )}
        <View style={styles.footerMainRow}>
        <View style={styles.footerLeft}>
          {/* The two icon buttons sit side by side as a pair, then the running
              total — rather than the total splitting them. */}
          <View style={styles.footerIconPair}>
            <TouchableOpacity
              style={styles.footerIconBtn}
              onPress={() => setReviewOpen(true)}
              activeOpacity={0.7}
              accessibilityLabel="Review order summary"
            >
              <OrderSummaryIcon size={18} color={QuinckleColors.primary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.footerIconBtn}
              onPress={() => setContactOpen(true)}
              activeOpacity={0.7}
              accessibilityLabel="Customer name and phone"
            >
              <CustomerIcon size={22} color={QuinckleColors.primary} />
              {(coPhone || coName.trim()) ? <View style={styles.footerIconDot} /> : null}
            </TouchableOpacity>
          </View>
          <TouchableOpacity
            onPress={() => setReviewOpen(true)}
            activeOpacity={0.7}
            accessibilityLabel="Review order summary"
          >
            <Text style={styles.footerCount}>{cartCount} item{cartCount !== 1 ? 's' : ''}</Text>
            <Text style={styles.footerTotal}>₹{cartTotal.toFixed(0)}</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={[styles.placeBtn, coSubmitting && { opacity: 0.7 }]}
          onPress={confirmAndPlace}
          disabled={coSubmitting}
          activeOpacity={0.85}
        >
          {coSubmitting
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={styles.placeBtnText}>Place Order</Text>}
        </TouchableOpacity>
        </View>
      </View>
    </Animated.View>
  );

  // Built here, rendered INSIDE CartReviewSheet's own drawer/sheet container
  // (via adjustBillContent below) so it's confined to that panel's width on
  // tablet-landscape instead of a screen-wide overlay spilling out past it.
  const adjustBillSheetJsx = (
    <BottomSheet
      visible={adjustSheetOpen}
      onClose={closeAdjustBillFromMenu}
      dismissible={false}
      disableInternalScroll
      maxHeightRatio={0.88}
    >
      <AdjustBillForm
        embedded
        // pendingStart === '1' is already this screen's own signal for "this
        // session was just created, before its first order" (both the table
        // and takeaway background-starts use it) — exactly when Discount and
        // Tip can't be saved yet (see AdjustBillForm's own doc comment).
        preOrder={pendingStart === '1'}
        sessionId={adjustSessionId}
        subtitle={isTakeaway ? `New ${orderLabel} order` : `Table T${tableNum}`}
        billTotal={billPreview?.projected.total ?? cartTotal}
        onClose={closeAdjustBillFromMenu}
        onSaved={() => setPreviewRefreshKey((k) => k + 1)}
      />
    </BottomSheet>
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
      onCheckout={() => { setReviewOpen(false); void confirmAndPlace(); }}
      onAdjust={() => { void openAdjustBillFromMenu(); }}
      bill={showBillPreview ? { data: billPreview, state: billPreviewState } : undefined}
      adjustBillContent={adjustBillSheetJsx}
    />
  );

  const guestSheetJsx = (
    <GuestSheet
      visible={contactOpen}
      onClose={() => setContactOpen(false)}
      isWide={isWide}
      phone={coPhone}
      name={coName}
      onPhoneChange={(v) => { setCoError(null); void onCoPhoneChange(v); }}
      onNameChange={setCoName}
      looking={coLooking}
      found={coFound}
      lookupFailed={coLookupFailed}
      visits={coVisits}
      member={coMember}
      error={coError}
    />
  );

  const upiPaymentSheetJsx = (
    <UpiPaymentSheet
      visible={upiSheetOpen}
      onClose={() => setUpiSheetOpen(false)}
      isWide={isWide}
      total={cartTotal}
      restaurantId={staffInfo?.restaurantId}
      onConfirm={() => setPaymentMethod('UPI')}
    />
  );

  const splitPaymentSheetJsx = (
    <SplitPaymentSheet
      visible={splitSheetOpen}
      onClose={() => setSplitSheetOpen(false)}
      isWide={isWide}
      total={cartTotal}
      initialCash={splitDetails?.cash ?? null}
      onConfirm={(cash, upi) => { setSplitDetails({ cash, upi }); setPaymentMethod('SPLIT'); }}
    />
  );

  const duePaymentSheetJsx = (
    <DuePaymentSheet
      visible={dueSheetOpen}
      onClose={() => setDueSheetOpen(false)}
      isWide={isWide}
      total={cartTotal}
      initial={dueDetails}
      fallbackPhone={coPhone}
      fallbackName={coName}
      onConfirm={(details) => { setDueDetails(details); setPaymentMethod('DUE'); }}
    />
  );

  const headerJsx = (
    <>
    <View style={styles.header}>
      <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.7}>
        <Ionicons name="chevron-back" size={20} color={QuinckleColors.textPrimary} />
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text style={styles.headerTitle}>{isTakeaway ? `New ${orderLabel} Order` : 'Add Items'}</Text>
        <Text style={[styles.headerSub, isTakeaway && { color: QuinckleColors.primary, fontWeight: '700' }]}>
          {isTakeaway
            // No token yet reads as just "TAKEAWAY" — pickupToken stays null
            // until the first order actually places (see confirmAndPlace).
            ? `${orderLabel.toUpperCase()}${pickupToken ? ` · ${pickupToken}` : ''}`
            : `Table T${tableNum}${bgStart?.phase === 'starting' ? ' · Opening…' : ''}`}
        </Text>
      </View>
      {cartCount > 0 && (
        <View style={styles.cartBadge}>
          <Text style={styles.cartBadgeText}>{cartCount} item{cartCount !== 1 ? 's' : ''}</Text>
        </View>
      )}
    </View>
    {bgStart?.phase === 'failed' && (
      <View style={styles.startFailBanner}>
        <Ionicons name="alert-circle" size={16} color={QuinckleColors.danger} />
        <Text style={styles.startFailText} numberOfLines={2}>
          Could not open Table T{tableNum}. {bgStart.message}
        </Text>
        <TouchableOpacity
          onPress={() => { void retryTableSession(tableDbId!).catch(() => {}); }}
          style={styles.startFailRetry}
          activeOpacity={0.8}
        >
          <Text style={styles.startFailRetryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    )}
    {bgTakeawayStart?.phase === 'failed' && (
      <View style={styles.startFailBanner}>
        <Ionicons name="alert-circle" size={16} color={QuinckleColors.danger} />
        <Text style={styles.startFailText} numberOfLines={2}>
          Could not start the order. {bgTakeawayStart.message}
        </Text>
        <TouchableOpacity
          onPress={() => { void retryTakeawaySession().catch(() => {}); }}
          style={styles.startFailRetry}
          activeOpacity={0.8}
        >
          <Text style={styles.startFailRetryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    )}
    </>
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

        {/* ── Cart review (right-side drawer on tablet-landscape) — carries
            the Adjust Bill sheet inside its own drawer, see adjustBillContent ── */}
        {cartReviewJsx}
        {guestSheetJsx}
        {upiPaymentSheetJsx}
        {splitPaymentSheetJsx}
        {duePaymentSheetJsx}
        {noteSheetJsx}
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

      {/* ── Category dropdown modal ──
          A venue can have 40+ categories, so the sheet is capped at 70% of the
          window and the list scrolls inside it. The backdrop sits behind the
          menu (rather than wrapping it) so taps on the menu's own padding
          don't dismiss it and the list keeps its scroll gestures. */}
      <Modal visible={catDropOpen} transparent animationType="fade" onRequestClose={() => setCatDropOpen(false)}>
        <View style={styles.dropBackdrop}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setCatDropOpen(false)}
          />
          <View style={[styles.dropMenu, { maxHeight: Math.max(240, height * 0.7) }]}>
            <View style={styles.dropHeader}>
              <Text style={styles.dropTitle}>Category</Text>
              <TouchableOpacity onPress={() => setCatDropOpen(false)} hitSlop={10}>
                <Ionicons name="close" size={18} color={QuinckleColors.textMuted} />
              </TouchableOpacity>
            </View>
            <ScrollView
              style={styles.dropScroll}
              contentContainerStyle={styles.dropScrollContent}
              showsVerticalScrollIndicator
              bounces={false}
              keyboardShouldPersistTaps="handled"
            >
              {menuCategories.map(cat => (
                <TouchableOpacity
                  key={cat}
                  style={[styles.dropItem, activeCategory === cat && styles.dropItemActive]}
                  onPress={() => { setActiveCategory(cat); setCatDropOpen(false); }}
                  activeOpacity={0.75}
                >
                  <Text
                    style={[styles.dropItemText, activeCategory === cat && styles.dropItemTextActive]}
                    numberOfLines={2}
                  >
                    {cat}
                  </Text>
                  {activeCategory === cat && (
                    <Ionicons name="checkmark" size={15} color={QuinckleColors.primary} />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── List (KeyboardAvoidingView keeps footer visible when keyboard opens) ── */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={0}
      >
        {isMenuLoading ? (
          <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={styles.gridSkeleton}>
            {Array.from({ length: gridColumns * 3 }).map((_, i) => (
              <View key={i} style={{ width: `${100 / gridColumns - 3}%` }}><CardSkeleton /></View>
            ))}
          </ScrollView>
        ) : filteredItems.length === 0 ? (
          emptyJsx
        ) : (
          <FlatList
            key={`grid-${gridColumns}`}
            data={gridData}
            keyExtractor={item => item.id}
            renderItem={renderCard}
            numColumns={gridColumns}
            columnWrapperStyle={{ gap: Spacing.sm + 2 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={gridColumns * 4}
            windowSize={7}
            contentContainerStyle={{
              paddingHorizontal: Spacing.lg,
              paddingTop: Spacing.sm,
              gap: Spacing.sm + 2,
              paddingBottom: footerMounted ? 100 : Spacing.xxl,
            }}
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

      {/* ── Cart review (bottom sheet on phone) — carries the Adjust Bill
          sheet inside its own body, see adjustBillContent ── */}
      {cartReviewJsx}
        {guestSheetJsx}
        {upiPaymentSheetJsx}
        {splitPaymentSheetJsx}
        {duePaymentSheetJsx}
      {noteSheetJsx}

    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // The table's session failed to start in the background. Sits under the header
  // so the cart stays usable while the crew retries.
  startFailBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    marginHorizontal: Spacing.lg, marginBottom: Spacing.sm,
    paddingVertical: Spacing.sm, paddingHorizontal: Spacing.md,
    borderRadius: Radius.md, borderWidth: 1, borderColor: 'rgba(239,68,68,0.3)',
    backgroundColor: 'rgba(239,68,68,0.08)',
  },
  startFailText: { flex: 1, color: QuinckleColors.textPrimary, fontSize: 13 },
  startFailRetry: {
    paddingVertical: 6, paddingHorizontal: 12, borderRadius: Radius.sm,
    backgroundColor: QuinckleColors.primary,
  },
  startFailRetryText: { color: '#fff', fontSize: 13, fontWeight: '700' },

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
  dropMenu: { width: '85%', maxWidth: 460, backgroundColor: QuinckleColors.surface, borderRadius: Radius.xl, borderWidth: 1, borderColor: QuinckleColors.border, overflow: 'hidden' },
  dropHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.xl, paddingVertical: Spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: QuinckleColors.borderSubtle },
  dropTitle: { ...Typography.label, color: QuinckleColors.textMuted },
  // flexShrink lets the list give way to the menu's maxHeight instead of
  // overflowing it (RN children don't shrink by default).
  dropScroll: { flexGrow: 0, flexShrink: 1 },
  dropScrollContent: { paddingVertical: Spacing.sm },
  dropItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md, borderRadius: Radius.md, marginHorizontal: Spacing.sm },
  dropItemActive: { backgroundColor: QuinckleColors.primarySoft },
  dropItemText: { ...Typography.body, color: QuinckleColors.textSecondary, flexShrink: 1 },
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
  gridSkeleton: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: Spacing.sm + 2, paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm },
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
  // Floating pill. `footer` is the full-width, touch-through wrapper that
  // positions it; `footerPill` is the visible capsule, centred and capped in width.
  footer: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: Spacing.lg },
  footerPill: {
    // Wider than the row alone needs — the payment-method chips (takeaway
    // only) push this from a single-line pill to a two-row capsule, so it
    // gets the extra width to keep the chips from wrapping on anything but
    // the narrowest phones.
    width: '100%', maxWidth: 640,
    flexDirection: 'column',
    paddingVertical: 8, paddingLeft: 10, paddingRight: 8,
    borderRadius: Radius.xl,
    backgroundColor: QuinckleColors.surfaceElevated,
    borderWidth: 1, borderColor: QuinckleColors.borderStrong,
    ...(Platform.OS === 'web'
      ? ({ boxShadow: '0 12px 32px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.4)' } as any)
      : { shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.5, shadowRadius: 20, elevation: 14 }),
  },
  footerMainRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingTop: 6 },
  // One soft-orange language for the whole capsule: at rest a chip reads
  // exactly like footerIconBtn two rows down (primarySoft fill, primary
  // icon/text); selected just deepens to solid primary. No per-method colour
  // — five different accents on one small pill was the "not looking good".
  paymentChipRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 2 },
  paymentChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 11, paddingVertical: 7,
    borderRadius: Radius.pill,
    borderWidth: 1, borderColor: QuinckleColors.primarySoftBorder,
    backgroundColor: QuinckleColors.primarySoft,
  },
  paymentChipOn: {
    backgroundColor: QuinckleColors.primary,
    borderColor: QuinckleColors.primary,
  },
  paymentChipText: { fontSize: 11, fontWeight: '700', color: QuinckleColors.primary },
  paymentChipTextOn: { color: '#fff' },
  paymentChipDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: QuinckleColors.border,
    marginTop: 8, marginHorizontal: 2,
  },
  footerLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  footerIconPair: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  footerIconBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: QuinckleColors.primarySoft, borderWidth: 1, borderColor: QuinckleColors.primarySoftBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  // Says "a customer is attached" without opening the sheet.
  footerIconDot: {
    position: 'absolute', top: -1, right: -1, width: 9, height: 9, borderRadius: 5,
    backgroundColor: QuinckleColors.success, borderWidth: 1.5, borderColor: QuinckleColors.surfaceElevated,
  },
  footerError: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, maxWidth: 520,
    marginBottom: Spacing.sm, paddingVertical: 8, paddingHorizontal: 12, borderRadius: Radius.pill,
    backgroundColor: QuinckleColors.surfaceElevated, borderWidth: 1, borderColor: QuinckleColors.danger,
  },
  footerErrorText: { ...Typography.caption, color: QuinckleColors.danger, flexShrink: 1 },
  footerCount: { ...Typography.micro, color: QuinckleColors.textSecondary },
  footerTotal: { ...Typography.subtitle, color: QuinckleColors.textPrimary, marginTop: 1 },
  placeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, backgroundColor: QuinckleColors.primary, paddingHorizontal: Spacing.xl, height: 46, borderRadius: Radius.pill },
  placeBtnText: { ...Typography.bodyStrong, color: '#fff' },

  // Guest details screen

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
});
