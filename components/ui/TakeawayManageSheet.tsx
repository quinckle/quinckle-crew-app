/**
 * TakeawayManageSheet — long-press action sheet for a takeaway order.
 *
 * Two modes:
 *   • choose — pick "Remove an item" or "Delete whole order" (inline confirm).
 *   • items  — each line has a trash icon at the right; tapping it plays a
 *              strike-through animation, then the row collapses away (siblings
 *              glide up) before the delete is persisted.
 *
 * Animations use RN's built-in Animated + LayoutAnimation (Reanimated is not
 * wired up in this project), so there is zero worklet/babel config risk.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { QuinckleColors, Radius, Spacing, Typography } from '../../constants/Colors';
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
  /** Persist a whole-order delete. Resolve on success, reject on failure. */
  onDeleteWholeOrder: () => Promise<void>;
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
  const [textW, setTextW] = useState(0);
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
        toValue: textW,
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
    <View style={styles.itemRow}>
      <View style={styles.itemTextWrap}>
        <Animated.Text
          style={[styles.itemText, { opacity: textOpacity }]}
          onLayout={(e) => setTextW(e.nativeEvent.layout.width)}
          numberOfLines={2}
        >
          <Text style={styles.itemQty}>{item.qty}× </Text>
          {item.name}
          {item.modifiers ? <Text style={styles.itemMods}>  {item.modifiers}</Text> : null}
        </Animated.Text>
        <Animated.View style={[styles.strike, { width: strikeW }]} pointerEvents="none" />
      </View>
      <TouchableOpacity
        onPress={runDelete}
        disabled={busy || disabled}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        activeOpacity={0.6}
        style={styles.trashBtn}
      >
        <Animated.View style={{ transform: [{ scale: iconScale }] }}>
          <Ionicons name="trash-outline" size={20} color={QuinckleColors.danger} />
        </Animated.View>
      </TouchableOpacity>
    </View>
  );
}

export function TakeawayManageSheet({ order, onClose, onDeleteItem, onDeleteWholeOrder, errorMessageFor }: Props) {
  const [mode, setMode] = useState<'choose' | 'items'>('choose');
  const [items, setItems] = useState<Item[]>([]);
  const [confirmWhole, setConfirmWhole] = useState(false);
  const [wholeBusy, setWholeBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset the sheet's local state whenever a different order is opened.
  useEffect(() => {
    setMode('choose');
    setItems(order?.items ?? []);
    setConfirmWhole(false);
    setWholeBusy(false);
    setError(null);
  }, [order?.orderId]);

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

  const handleDeleteWhole = () => {
    setError(null);
    setWholeBusy(true);
    void (async () => {
      try {
        await onDeleteWholeOrder();
        onClose();
      } catch (err: any) {
        setWholeBusy(false);
        setConfirmWhole(false);
        setError(errorMessageFor(err));
      }
    })();
  };

  return (
    <BottomSheet visible={!!order} onClose={onClose} title={title}>
      <View style={styles.body}>
        {mode === 'choose' ? (
          <>
            <TouchableOpacity style={styles.option} onPress={() => setMode('items')} activeOpacity={0.85}>
              <View style={styles.optionIcon}>
                <Ionicons name="pricetags-outline" size={20} color={QuinckleColors.textSecondary} />
              </View>
              <View style={styles.optionTextWrap}>
                <Text style={styles.optionLabel}>Remove an item</Text>
                <Text style={styles.optionSub}>Delete one line and recalculate the total</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={QuinckleColors.textTertiary} />
            </TouchableOpacity>

            {!confirmWhole ? (
              <TouchableOpacity
                style={[styles.option, styles.optionDanger]}
                onPress={() => setConfirmWhole(true)}
                activeOpacity={0.85}
              >
                <View style={[styles.optionIcon, styles.optionIconDanger]}>
                  <Ionicons name="trash-outline" size={20} color={QuinckleColors.danger} />
                </View>
                <View style={styles.optionTextWrap}>
                  <Text style={[styles.optionLabel, { color: QuinckleColors.danger }]}>Delete whole order</Text>
                  <Text style={styles.optionSub}>Cancel every item in this order</Text>
                </View>
              </TouchableOpacity>
            ) : (
              <View style={[styles.option, styles.optionDanger, styles.confirmRow]}>
                <Text style={styles.confirmText}>Delete this entire order?</Text>
                <View style={styles.confirmBtns}>
                  <TouchableOpacity
                    style={styles.confirmCancel}
                    onPress={() => setConfirmWhole(false)}
                    disabled={wholeBusy}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.confirmCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.confirmDelete}
                    onPress={handleDeleteWhole}
                    disabled={wholeBusy}
                    activeOpacity={0.8}
                  >
                    {wholeBusy ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.confirmDeleteText}>Delete</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </>
        ) : (
          <>
            <TouchableOpacity style={styles.backRow} onPress={() => setMode('choose')} activeOpacity={0.7}>
              <Ionicons name="chevron-back" size={18} color={QuinckleColors.textSecondary} />
              <Text style={styles.backText}>Remove an item</Text>
            </TouchableOpacity>

            <View style={styles.itemList}>
              {items.map((it) => (
                <DeletableRow key={it.itemId} item={it} onStruck={handleStruck} disabled={wholeBusy} />
              ))}
              {items.length === 0 && (
                <Text style={styles.emptyText}>No items left.</Text>
              )}
            </View>
          </>
        )}

        {error && <Text style={styles.errorText}>{error}</Text>}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.sm,
    gap: Spacing.md,
  },
  // ── choose mode ──
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: QuinckleColors.surfaceElevated,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    padding: Spacing.lg,
  },
  optionDanger: {
    backgroundColor: QuinckleColors.dangerSoft,
    borderColor: QuinckleColors.dangerBorder,
  },
  optionIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    backgroundColor: QuinckleColors.surfaceMutedHover,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionIconDanger: {
    backgroundColor: 'rgba(239,68,68,0.14)',
  },
  optionTextWrap: {
    flex: 1,
    gap: 2,
  },
  optionLabel: {
    ...Typography.bodyStrong,
    color: QuinckleColors.textPrimary,
  },
  optionSub: {
    ...Typography.caption,
    color: QuinckleColors.textSecondary,
  },
  // ── inline whole-order confirm ──
  confirmRow: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: Spacing.md,
  },
  confirmText: {
    ...Typography.bodyStrong,
    color: QuinckleColors.textPrimary,
  },
  confirmBtns: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  confirmCancel: {
    flex: 1,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    borderRadius: Radius.sm,
    paddingVertical: 11,
    alignItems: 'center',
  },
  confirmCancelText: {
    ...Typography.bodyStrong,
    color: QuinckleColors.textSecondary,
  },
  confirmDelete: {
    flex: 1,
    backgroundColor: QuinckleColors.danger,
    borderRadius: Radius.sm,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmDeleteText: {
    ...Typography.bodyStrong,
    color: '#fff',
  },
  // ── items mode ──
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 2,
  },
  backText: {
    ...Typography.bodyStrong,
    color: QuinckleColors.textSecondary,
  },
  itemList: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    backgroundColor: QuinckleColors.surfaceElevated,
    overflow: 'hidden',
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: 13,
    paddingHorizontal: Spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: QuinckleColors.border,
  },
  itemTextWrap: {
    flex: 1,
    justifyContent: 'center',
  },
  itemText: {
    ...Typography.body,
    color: QuinckleColors.textPrimary,
  },
  itemQty: {
    color: QuinckleColors.textSecondary,
    fontWeight: '700',
  },
  itemMods: {
    color: QuinckleColors.textTertiary,
    fontSize: 13,
  },
  strike: {
    position: 'absolute',
    left: 0,
    top: '50%',
    marginTop: -1,
    height: 2,
    borderRadius: 1,
    backgroundColor: QuinckleColors.danger,
  },
  trashBtn: {
    padding: 4,
  },
  emptyText: {
    ...Typography.caption,
    color: QuinckleColors.textTertiary,
    textAlign: 'center',
    padding: Spacing.lg,
  },
  errorText: {
    ...Typography.caption,
    color: QuinckleColors.danger,
    textAlign: 'center',
  },
});
