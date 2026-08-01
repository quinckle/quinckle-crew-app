/**
 * TakeawayManageSheet — long-press action sheet for a takeaway order.
 * Visually mirrors the table "Manage Table" sheet (flat rows, icon chips,
 * subtle dividers).
 *
 * Three modes:
 *   • choose — "Remove an item" (→ items mode) or "Delete whole order"
 *              (closes + confirms via the parent's reason sheet, like "Free table").
 *   • items  — each line has a trash icon at the right.
 *   • reason — why the line is going. Rendered inline as a mode rather than as
 *              a second BottomSheet on top: stacked sheets would double the
 *              backdrop and fight over the drag-to-dismiss gesture.
 *
 * Tapping a line's trash goes to `reason`; picking one returns to `items` and
 * arms that row, which plays its strike-through, collapses away (siblings glide
 * up), and only then persists the delete.
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
import { ReasonPicker } from './ReasonSheet';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';
import type { CancelReason } from '../../constants/adjustmentReasons';
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
  onDeleteItem: (itemId: string, reason: CancelReason) => Promise<void>;
  /** Ask the parent to close + confirm the whole-order delete (ThemedDialog flow). */
  onDeleteWholeOrder: () => void;
  /** Map a thrown API error to a crew-facing message. */
  errorMessageFor: (err: any) => string;
}

// ── One deletable line: strike-through, then let the parent collapse it away ──
function DeletableRow({
  item,
  armed,
  onRequestDelete,
  onStruck,
  disabled,
}: {
  item: Item;
  /** Flips true once the crew has picked a reason — plays the strike, then persists. */
  armed: boolean;
  onRequestDelete: (item: Item) => void;
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

  // The reason step runs before the animation now: tapping the trash asks the
  // parent for a reason, and the row only strikes through once one is picked.
  //
  // Returning from the reason mode REMOUNTS this row already armed, so the
  // effect can land before onLayout has measured the title. Striking to a
  // titleW of 0 would play an invisible animation, so wait for the measurement
  // — with a short fallback, because a row that never animates is a row that
  // never deletes. runDelete's `busy` guard makes the double path harmless.
  useEffect(() => {
    if (!armed) return;
    if (titleW > 0) { runDelete(); return; }
    const t = setTimeout(runDelete, 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armed, titleW]);

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
        onPress={() => onRequestDelete(item)}
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
  const [mode, setMode] = useState<'choose' | 'items' | 'reason'>('choose');
  const [items, setItems] = useState<Item[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** Line awaiting a reason (mode 'reason'). */
  const [reasonFor, setReasonFor] = useState<Item | null>(null);
  /** Line whose reason is picked — arms its row to strike through and persist. */
  const [pending, setPending] = useState<{ item: Item; reason: CancelReason } | null>(null);

  // Reset the sheet's local state whenever a different order is opened.
  useEffect(() => {
    setMode('choose');
    setItems(order?.items ?? []);
    setError(null);
    setReasonFor(null);
    setPending(null);
  }, [order?.orderId, order?.items]);

  const title = useMemo(() => {
    if (!order) return 'Manage order';
    return order.pickupToken ? `Order ${order.pickupToken}` : 'Manage order';
  }, [order]);

  // Called once a row's strike-through finishes: collapse it out, then persist.
  const handleStruck = (item: Item) => {
    setError(null);
    const reason = pending?.reason;
    // Armed only ever follows a reason pick, so this should not happen; bail
    // rather than send a reasonless void and quietly poison the ledger.
    if (!reason) return;
    const idx = items.findIndex((i) => i.itemId === item.itemId);
    const wasLast = items.length <= 1;

    LayoutAnimation.configureNext(COLLAPSE_ANIM);
    setItems((prev) => prev.filter((i) => i.itemId !== item.itemId));
    setPending(null);

    void (async () => {
      try {
        await onDeleteItem(item.itemId, reason);
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
        ) : mode === 'reason' ? (
          <ReasonPicker
            subject={reasonFor ? `${reasonFor.qty}× ${reasonFor.name}` : null}
            note="This line will be removed and the total recalculated."
            confirmLabel="Remove item"
            cancelLabel="Back"
            resetKey={reasonFor?.itemId ?? null}
            onConfirm={(reason) => {
              if (!reasonFor) return;
              setPending({ item: reasonFor, reason });
              setReasonFor(null);
              setMode('items');
            }}
            onCancel={() => { setReasonFor(null); setMode('items'); }}
          />
        ) : (
          <>
            <TouchableOpacity style={styles.backRow} onPress={() => setMode('choose')} activeOpacity={0.7}>
              <Ionicons name="chevron-back" size={17} color={QuinckleColors.textSecondary} />
              <Text style={styles.backText}>Remove an item</Text>
            </TouchableOpacity>

            {items.map((it, i) => (
              <React.Fragment key={it.itemId}>
                {i > 0 && <View style={styles.divider} />}
                <DeletableRow
                  item={it}
                  armed={pending?.item.itemId === it.itemId}
                  onRequestDelete={(item) => { setReasonFor(item); setMode('reason'); }}
                  onStruck={handleStruck}
                  disabled={false}
                />
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
