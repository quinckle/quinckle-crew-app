/**
 * TakeawayManageSheet — long-press action sheet for a takeaway order.
 * Visually mirrors the table "Manage Table" sheet (flat rows, icon chips,
 * subtle dividers).
 *
 * Two modes:
 *   • choose — "Remove an item" (→ items mode) or "Delete whole order"
 *              (closes + confirms via the parent's ThemedDialog, like "Free table").
 *   • items  — each line has a trash icon at the right; tapping it plays a
 *              strike-through animation, then the row collapses away (siblings
 *              glide up) before the delete is persisted.
 *
 * Animations use RN's built-in Animated + LayoutAnimation (Reanimated is not
 * wired up in this project), so there is zero worklet/babel config risk.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  LayoutAnimation,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  UIManager,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { BottomSheet } from './BottomSheet';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';
import type { TakeawayOrder } from '../../services/api';

// LayoutAnimation needs this opt-in on old-arch Android; harmless no-op on Fabric.
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type Item = TakeawayOrder['items'][number];

const COLLAPSE_ANIM = {
  duration: 240,
  update: { type: LayoutAnimation.Types.easeInEaseOut },
  delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
  create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
};

interface Props {
  order: TakeawayOrder | null;
  onClose: () => void;
  /** Persist a single-line delete. Resolve on success, reject with {code,message} on failure. */
  onDeleteItem: (itemId: string) => Promise<void>;
  /** Ask the parent to close + confirm the whole-order delete (ThemedDialog flow). */
  onDeleteWholeOrder: () => void;
  /** Map a thrown API error to a crew-facing message. */
  errorMessageFor: (err: any) => string;
}

// ── One deletable line: strike-through, then let the parent collapse it away ──
function DeletableRow({
  item,
  onStruck,
  disabled,
}: {
  item: Item;
  onStruck: (item: Item) => void;
  disabled: boolean;
}) {
  const [titleW, setTitleW] = useState(0);
  const strikeW = useRef(new Animated.Value(0)).current;
  const textOpacity = useRef(new Animated.Value(1)).current;
  const iconScale = useRef(new Animated.Value(1)).current;
  const [busy, setBusy] = useState(false);

  const runDelete = () => {
    if (busy || disabled) return;
    setBusy(true);
    void Haptics.selectionAsync();
    Animated.sequence([
      Animated.timing(iconScale, { toValue: 0.8, duration: 90, useNativeDriver: true }),
      Animated.timing(iconScale, { toValue: 1, duration: 90, useNativeDriver: true }),
    ]).start();
    Animated.parallel([
      Animated.timing(strikeW, {
        toValue: titleW,
        duration: 230,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(textOpacity, {
        toValue: 0.4,
        duration: 230,
        useNativeDriver: true,
      }),
    ]).start(() => onStruck(item));
  };

  return (
    <View style={styles.row}>
      <Animated.View style={[styles.rowTextWrap, { opacity: textOpacity }]}>
        <View style={styles.titleWrap}>
          <Text style={styles.rowTitle} numberOfLines={1} onLayout={(e) => setTitleW(e.nativeEvent.layout.width)}>
            <Text style={styles.qty}>{item.qty}× </Text>
            {item.name}
          </Text>
          <Animated.View style={[styles.strike, { width: strikeW }]} pointerEvents="none" />
        </View>
        {item.modifiers ? <Text style={styles.rowSub} numberOfLines={1}>{item.modifiers}</Text> : null}
      </Animated.View>
      <TouchableOpacity
        onPress={runDelete}
        disabled={busy || disabled}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        activeOpacity={0.6}
        style={styles.trashBtn}
      >
        <Animated.View style={{ transform: [{ scale: iconScale }] }}>
          <Ionicons name="trash-outline" size={19} color={QuinckleColors.danger} />
        </Animated.View>
      </TouchableOpacity>
    </View>
  );
}

export function TakeawayManageSheet({ order, onClose, onDeleteItem, onDeleteWholeOrder, errorMessageFor }: Props) {
  const [mode, setMode] = useState<'choose' | 'items'>('choose');
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Reset the sheet's local state whenever a different order is opened.
  useEffect(() => {
    setMode('choose');
    setItems(order?.items ?? []);
    setError(null);
  }, [order?.orderId, order?.items]);

  const title = useMemo(() => {
    if (!order) return 'Manage order';
    return order.pickupToken ? `Order ${order.pickupToken}` : 'Manage order';
  }, [order]);

  // Called once a row's strike-through finishes: collapse it out, then persist.
  const handleStruck = (item: Item) => {
    setError(null);
    const idx = items.findIndex((i) => i.itemId === item.itemId);
    const wasLast = items.length <= 1;

    LayoutAnimation.configureNext(COLLAPSE_ANIM);
    setItems((prev) => prev.filter((i) => i.itemId !== item.itemId));

    void (async () => {
      try {
        await onDeleteItem(item.itemId);
        // Removing the final line cancels the whole order server-side.
        if (wasLast) onClose();
      } catch (err: any) {
        // Revert: slot the line back where it was.
        LayoutAnimation.configureNext(COLLAPSE_ANIM);
        setItems((prev) => {
          const next = [...prev];
          next.splice(Math.max(0, idx), 0, item);
          return next;
        });
        setError(errorMessageFor(err));
      }
    })();
  };

  return (
    <BottomSheet visible={!!order} onClose={onClose} title={title}>
      <View style={styles.body}>
        {mode === 'choose' ? (
          <>
            <TouchableOpacity style={styles.row} onPress={() => setMode('items')} activeOpacity={0.7}>
              <View style={styles.icon}>
                <Ionicons name="pricetags-outline" size={19} color={QuinckleColors.textPrimary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>Remove an item</Text>
                <Text style={styles.rowSub}>Delete one line and recalculate the total</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={QuinckleColors.textTertiary} />
            </TouchableOpacity>

            <View style={styles.divider} />

            <TouchableOpacity style={styles.row} onPress={onDeleteWholeOrder} activeOpacity={0.7}>
              <View style={[styles.icon, styles.iconDanger]}>
                <Ionicons name="trash-outline" size={19} color={QuinckleColors.danger} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, { color: QuinckleColors.danger }]}>Delete whole order</Text>
                <Text style={styles.rowSub}>Cancel every item in this order</Text>
              </View>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <TouchableOpacity style={styles.backRow} onPress={() => setMode('choose')} activeOpacity={0.7}>
              <Ionicons name="chevron-back" size={17} color={QuinckleColors.textSecondary} />
              <Text style={styles.backText}>Remove an item</Text>
            </TouchableOpacity>

            {items.map((it, i) => (
              <React.Fragment key={it.itemId}>
                {i > 0 && <View style={styles.divider} />}
                <DeletableRow item={it} onStruck={handleStruck} disabled={false} />
              </React.Fragment>
            ))}
            {items.length === 0 && <Text style={styles.emptyText}>No items left.</Text>}
          </>
        )}

        {error && <Text style={styles.errorText}>{error}</Text>}
      </View>
    </BottomSheet>
  );
}

// Mirrors the table "Manage Table" sheet styles for a consistent look.
const styles = StyleSheet.create({
  body: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.md, gap: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    backgroundColor: QuinckleColors.surfaceMutedHover,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconDanger: { backgroundColor: QuinckleColors.dangerSoft },
  rowTextWrap: { flex: 1, justifyContent: 'center' },
  titleWrap: { alignSelf: 'flex-start', justifyContent: 'center' },
  rowTitle: { color: QuinckleColors.textPrimary, fontSize: 15, fontWeight: '600' },
  qty: { color: QuinckleColors.textSecondary, fontWeight: '700' },
  rowSub: { color: QuinckleColors.textTertiary, fontSize: 12, marginTop: 2 },
  divider: { height: 1, backgroundColor: QuinckleColors.surfaceMuted, marginVertical: 2 },
  strike: {
    position: 'absolute',
    left: 0,
    top: '50%',
    marginTop: -1,
    height: 2,
    borderRadius: 1,
    backgroundColor: QuinckleColors.danger,
  },
  trashBtn: { padding: 4 },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8, paddingHorizontal: 4 },
  backText: { color: QuinckleColors.textSecondary, fontSize: 15, fontWeight: '600' },
  emptyText: { color: QuinckleColors.textTertiary, fontSize: 12, textAlign: 'center', paddingVertical: Spacing.lg },
  errorText: { color: QuinckleColors.danger, fontSize: 12, textAlign: 'center', marginTop: Spacing.sm },
});
