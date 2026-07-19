/**
 * CartReviewSheet — the "review before you place" order summary.
 *
 * Two presentations, one shared item list:
 *  - Phone / portrait  → slides up as the app's standard BottomSheet.
 *  - Tablet-landscape   → slides in right-to-left as a side panel (POS till).
 *
 * Perf notes: the row is a React.memo'd component fed per-line slices, the list
 * is a FlatList (windowed), and the whole thing only mounts while visible, so
 * an idle cart costs nothing. Callbacks must be identity-stable in the parent.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { QuinckleColors, Radius, Spacing, Typography } from '../../constants/Colors';
import { BottomSheet } from './BottomSheet';

export interface CartLine {
  id: string;
  name: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  modSummary?: string | null;
  note?: string | null;
  imageUrl?: string | null;
}

const { width: SCREEN_W } = Dimensions.get('window');
const DRAWER_WIDTH = Math.min(Math.max(SCREEN_W * 0.42, 380), 460);

// Same R2 thumb-variant convention used across the app for menu media.
const thumbUrl = (url: string) =>
  url.includes('media.quinckle.com') && url.endsWith('.webp') ? `${url}-thumb.webp` : url;

// ── One line row (memoized) ──────────────────────────────────────────────────

const CartRow = React.memo(function CartRow({
  line, onInc, onDec,
}: {
  line: CartLine;
  onInc: (id: string) => void;
  onDec: (id: string) => void;
}) {
  const [imgFailed, setImgFailed] = useState(false);
  const hasImage = !!line.imageUrl;
  return (
    <View style={styles.row}>
      {hasImage ? (
        <Image
          source={{ uri: imgFailed ? line.imageUrl! : thumbUrl(line.imageUrl!) }}
          style={styles.rowImg}
          contentFit="cover"
          cachePolicy="disk"
          transition={0}
          onError={() => setImgFailed(true)}
        />
      ) : (
        <View style={[styles.rowImg, styles.rowImgPlaceholder]}>
          <Ionicons name="fast-food-outline" size={20} color={QuinckleColors.textMuted} />
        </View>
      )}

      <View style={styles.rowInfo}>
        <Text style={styles.rowName} numberOfLines={2}>{line.name}</Text>
        {line.modSummary ? (
          <Text style={styles.rowSub} numberOfLines={1}>{line.modSummary}</Text>
        ) : null}
        {line.note ? (
          <Text style={styles.rowNote} numberOfLines={1}>Note: {line.note}</Text>
        ) : null}
        <Text style={styles.rowUnit}>₹{line.unitPrice.toFixed(0)} each</Text>
      </View>

      <View style={styles.rowRight}>
        <View style={styles.qtyControl}>
          <TouchableOpacity onPress={() => onDec(line.id)} style={styles.qtyBtn} hitSlop={6}>
            <Ionicons name="remove" size={16} color={QuinckleColors.primary} />
          </TouchableOpacity>
          <Text style={styles.qtyText}>{line.qty}</Text>
          <TouchableOpacity onPress={() => onInc(line.id)} style={styles.qtyBtn} hitSlop={6}>
            <Ionicons name="add" size={16} color={QuinckleColors.primary} />
          </TouchableOpacity>
        </View>
        <Text style={styles.rowLineTotal}>₹{line.lineTotal.toFixed(0)}</Text>
      </View>
    </View>
  );
});

// ── Public component ─────────────────────────────────────────────────────────

export interface CartReviewSheetProps {
  visible: boolean;
  onClose: () => void;
  /** true on tablet-landscape → right-side drawer; else bottom sheet. */
  isWide: boolean;
  lines: CartLine[];
  total: number;
  onInc: (id: string) => void;
  onDec: (id: string) => void;
  onCheckout: () => void;
  ctaLabel?: string;
}

export function CartReviewSheet({
  visible, onClose, isWide, lines, total, onInc, onDec, onCheckout, ctaLabel = 'Place Order',
}: CartReviewSheetProps) {
  const insets = useSafeAreaInsets();
  const count = useMemo(() => lines.reduce((a, l) => a + l.qty, 0), [lines]);

  const renderRow = useCallback(
    ({ item }: { item: CartLine }) => <CartRow line={item} onInc={onInc} onDec={onDec} />,
    [onInc, onDec],
  );

  const listBody = (
    <FlatList
      data={lines}
      keyExtractor={l => l.id}
      renderItem={renderRow}
      style={styles.list}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={styles.listContent}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Ionicons name="cart-outline" size={30} color={QuinckleColors.textMuted} />
          <Text style={styles.emptyText}>Your cart is empty</Text>
        </View>
      }
    />
  );

  const footer = (
    <View style={[styles.footer, { paddingBottom: Spacing.lg }]}>
      <View style={styles.footerTotals}>
        <Text style={styles.footerCount}>{count} item{count !== 1 ? 's' : ''}</Text>
        <Text style={styles.footerTotal}>₹{total.toFixed(0)}</Text>
      </View>
      <TouchableOpacity
        style={[styles.cta, lines.length === 0 && { opacity: 0.4 }]}
        onPress={onCheckout}
        disabled={lines.length === 0}
        activeOpacity={0.85}
      >
        <Text style={styles.ctaText}>{ctaLabel}</Text>
        <Ionicons name="arrow-forward" size={16} color="#fff" />
      </TouchableOpacity>
    </View>
  );

  // ── Phone / portrait → bottom sheet ──
  if (!isWide) {
    return (
      <BottomSheet visible={visible} onClose={onClose} title="Order summary" maxHeightRatio={0.8} disableInternalScroll>
        <View style={{ flex: 1 }}>
          {listBody}
          {footer}
        </View>
      </BottomSheet>
    );
  }

  // ── Tablet-landscape → right-to-left drawer ──
  return <RightDrawer visible={visible} onClose={onClose} insetsTop={insets.top} insetsBottom={insets.bottom}>
    <View style={styles.drawerHeader}>
      <Text style={styles.drawerTitle}>Order summary</Text>
      <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={8} activeOpacity={0.7}>
        <Ionicons name="close" size={20} color={QuinckleColors.textSecondary} />
      </TouchableOpacity>
    </View>
    <View style={styles.drawerDivider} />
    {listBody}
    {footer}
  </RightDrawer>;
}

// ── Right-side drawer shell (translateX slide, mirrors SideDrawer) ───────────

function RightDrawer({
  visible, onClose, insetsTop, insetsBottom, children,
}: {
  visible: boolean;
  onClose: () => void;
  insetsTop: number;
  insetsBottom: number;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  const slide = useRef(new Animated.Value(DRAWER_WIDTH)).current;
  const backdrop = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      slide.setValue(DRAWER_WIDTH);
      backdrop.setValue(0);
      setMounted(true);
      Animated.parallel([
        Animated.spring(slide, { toValue: 0, useNativeDriver: true, stiffness: 260, damping: 30, mass: 0.9 }),
        Animated.timing(backdrop, { toValue: 1, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      ]).start();
    } else if (mounted) {
      Animated.parallel([
        Animated.timing(slide, { toValue: DRAWER_WIDTH, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
        Animated.timing(backdrop, { toValue: 0, duration: 200, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      ]).start(({ finished }) => { if (finished) setMounted(false); });
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!mounted) return null;

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.overlay}>
        <Animated.View style={[styles.backdrop, { opacity: backdrop }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>
        <Animated.View
          style={[
            styles.drawer,
            { paddingTop: insetsTop + Spacing.lg, paddingBottom: insetsBottom },
            { transform: [{ translateX: slide }] },
          ]}
        >
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  // List
  list: { flex: 1 },
  listContent: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.md, flexGrow: 1 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: QuinckleColors.borderSubtle,
  },
  rowImg: { width: 52, height: 52, borderRadius: Radius.md, backgroundColor: QuinckleColors.surfaceElevated, flexShrink: 0 },
  rowImgPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  rowInfo: { flex: 1, gap: 2 },
  rowName: { ...Typography.body, color: QuinckleColors.textPrimary, fontWeight: '600', lineHeight: 19 },
  rowSub: { fontSize: 11, color: QuinckleColors.textMuted, fontStyle: 'italic' },
  rowNote: { fontSize: 11, color: QuinckleColors.textMuted },
  rowUnit: { fontSize: 12, color: QuinckleColors.textTertiary, marginTop: 1 },
  rowRight: { alignItems: 'flex-end', gap: 6, flexShrink: 0 },
  qtyControl: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: QuinckleColors.primarySoft, borderRadius: Radius.md,
    borderWidth: 1, borderColor: QuinckleColors.primarySoftBorder, overflow: 'hidden',
  },
  qtyBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  qtyText: { ...Typography.body, color: QuinckleColors.primary, fontWeight: '700', minWidth: 20, textAlign: 'center' },
  rowLineTotal: { ...Typography.body, color: QuinckleColors.textPrimary, fontWeight: '700' },

  // Empty
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.md, paddingVertical: Spacing.huge },
  emptyText: { ...Typography.caption, color: QuinckleColors.textMuted },

  // Footer
  footer: {
    paddingHorizontal: Spacing.xl, paddingTop: Spacing.md,
    borderTopWidth: 1, borderTopColor: QuinckleColors.border,
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: QuinckleColors.surface,
  },
  footerTotals: { flex: 1 },
  footerCount: { ...Typography.micro, color: QuinckleColors.textSecondary },
  footerTotal: { ...Typography.subtitle, color: QuinckleColors.textPrimary, marginTop: 1 },
  cta: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    backgroundColor: QuinckleColors.primary, paddingHorizontal: Spacing.xl, paddingVertical: 13, borderRadius: Radius.md,
  },
  ctaText: { ...Typography.bodyStrong, color: '#fff' },

  // Right drawer
  overlay: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.55)' },
  drawer: {
    width: DRAWER_WIDTH, backgroundColor: QuinckleColors.surface,
    borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: QuinckleColors.border,
  },
  drawerHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl, paddingBottom: Spacing.md,
  },
  drawerTitle: { ...Typography.subtitle, color: QuinckleColors.textPrimary },
  closeBtn: { padding: 4 },
  drawerDivider: { height: StyleSheet.hairlineWidth, backgroundColor: QuinckleColors.border, marginBottom: Spacing.sm },
});
