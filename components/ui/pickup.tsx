import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// Gentle reflow used when cards enter/leave Active or Completed lists.
export const PICKUP_LAYOUT_PRESET = {
  duration: 280,
  create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
  update: { type: LayoutAnimation.Types.easeInEaseOut },
  delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
};

export type PickupItemData = {
  id: string;
  name: string;
  qty: number;
  orderedAt: string;
  isServed: boolean;
  isReady: boolean;
};

export type PickupOrderData = {
  id: string;
  tableNo: string;
  items: PickupItemData[];
  /** ISO timestamp when the order was finished. Drives Active/Completed split. */
  completedAt?: string;
};

/* ───────────── Segmented control ───────────── */

type SegmentedItem = { key: string; label: string; count?: number };
type SegmentedProps = {
  items: SegmentedItem[];
  active: string;
  onChange: (key: string) => void;
};

export function PickupSegmented({ items, active, onChange }: SegmentedProps) {
  const activeIndex = Math.max(0, items.findIndex((i) => i.key === active));
  const [trackWidth, setTrackWidth] = useState(0);
  const segWidth = trackWidth > 0 ? (trackWidth - 8) / items.length : 0;
  const indicatorX = useRef(new Animated.Value(activeIndex * segWidth)).current;

  useEffect(() => {
    if (segWidth === 0) return;
    Animated.spring(indicatorX, {
      toValue: activeIndex * segWidth,
      useNativeDriver: true,
      friction: 11,
      tension: 90,
    }).start();
  }, [activeIndex, segWidth, indicatorX]);

  return (
    <View
      style={segStyles.track}
      onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
    >
      {segWidth > 0 && (
        <Animated.View
          style={[
            segStyles.indicator,
            { width: segWidth, transform: [{ translateX: indicatorX }] },
          ]}
        />
      )}
      {items.map((it) => {
        const isActive = it.key === active;
        return (
          <Pressable
            key={it.key}
            style={segStyles.btn}
            onPress={() => onChange(it.key)}
            android_ripple={{ color: 'rgba(255,255,255,0.06)', borderless: false }}
          >
            <Text style={[segStyles.text, isActive && segStyles.textActive]}>{it.label}</Text>
            {typeof it.count === 'number' && it.count > 0 && (
              <View style={[segStyles.badge, isActive && segStyles.badgeActive]}>
                <Text style={[segStyles.badgeText, isActive && segStyles.badgeTextActive]}>
                  {it.count}
                </Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const segStyles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    backgroundColor: QuinckleColors.surfaceMuted,
    borderRadius: Radius.md,
    padding: 4,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    position: 'relative',
  },
  indicator: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    left: 4,
    backgroundColor: QuinckleColors.surfaceMutedHover,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: QuinckleColors.borderStrong,
  },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: Radius.sm,
  },
  text: {
    color: QuinckleColors.textTertiary,
    fontSize: 13,
    fontWeight: '600',
  },
  textActive: {
    color: QuinckleColors.textPrimary,
  },
  badge: {
    minWidth: 20,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: Radius.pill,
    backgroundColor: QuinckleColors.surfaceMutedHover,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeActive: {
    backgroundColor: QuinckleColors.surface,
  },
  badgeText: {
    color: QuinckleColors.textTertiary,
    fontSize: 11,
    fontWeight: '700',
  },
  badgeTextActive: {
    color: QuinckleColors.textPrimary,
  },
});

/* ───────────── Item row ───────────── */

type ItemRowProps = {
  item: PickupItemData;
  onToggle: () => void;
  disabled?: boolean;
  isCompleted?: boolean;
};

function PickupItemRow({ item, onToggle, disabled, isCompleted }: ItemRowProps) {
  // Three calm states:
  //   served  → filled check, collapsed, line-through
  //   ready   → empty check, bold text, green dot, tap-row enabled
  //   pending → empty check, faded text, kitchen dot, untappable
  const tappable = item.isReady && !item.isServed && !disabled && !isCompleted;

  const handlePress = () => {
    if (!tappable) return;
    Haptics.selectionAsync().catch(() => {});
    onToggle();
  };

  return (
    <Pressable
      onPress={handlePress}
      disabled={!tappable}
      android_ripple={tappable ? { color: 'rgba(255,255,255,0.05)' } : undefined}
      style={[rowStyles.row, item.isServed && rowStyles.rowServed]}
    >
      <View style={[
        rowStyles.checkbox,
        item.isServed && rowStyles.checkboxFilled,
        item.isReady && !item.isServed && rowStyles.checkboxReady,
      ]}>
        {item.isServed && <Ionicons name="checkmark" size={12} color="#fff" />}
      </View>

      <Text style={[
        rowStyles.qty,
        item.isServed && rowStyles.textMuted,
        !item.isReady && !item.isServed && rowStyles.textMuted,
      ]}>
        {item.qty}×
      </Text>

      <Text
        numberOfLines={1}
        style={[
          rowStyles.name,
          item.isServed && rowStyles.nameServed,
          !item.isReady && !item.isServed && rowStyles.textMuted,
        ]}
      >
        {item.name}
      </Text>

      {!item.isServed && (
        <View style={rowStyles.statusDotWrap}>
          <View style={[
            rowStyles.statusDot,
            { backgroundColor: item.isReady ? QuinckleColors.success : QuinckleColors.textTertiary },
          ]} />
        </View>
      )}
    </Pressable>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: 10,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.sm,
  },
  rowServed: {
    paddingVertical: 6,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: QuinckleColors.borderStrong,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxReady: {
    borderColor: QuinckleColors.success,
  },
  checkboxFilled: {
    backgroundColor: QuinckleColors.success,
    borderColor: QuinckleColors.success,
  },
  qty: {
    color: QuinckleColors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
    minWidth: 24,
  },
  name: {
    flex: 1,
    color: QuinckleColors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  nameServed: {
    textDecorationLine: 'line-through',
    color: QuinckleColors.textTertiary,
    fontWeight: '500',
  },
  textMuted: {
    color: QuinckleColors.textTertiary,
  },
  statusDotWrap: {
    paddingHorizontal: 4,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
});

/* ───────────── Pickup card ───────────── */

type CardProps = {
  order: PickupOrderData;
  isCompleting: boolean;
  onToggleItem: (itemId: string) => void;
  onCompletionFinished: () => void;
  onReopen?: () => void;
};

const COMPLETION_HOLD_MS = 700;   // hold in Active list with calm state shown
const UNDO_WINDOW_MS = 60_000;

export function PickupCard({
  order,
  isCompleting,
  onToggleItem,
  onCompletionFinished,
  onReopen,
}: CardProps) {
  const isCompleted = !!order.completedAt;
  const items = order.items;

  // Cross-fade between active/completed visual treatment + list slot.
  const opacity = useRef(new Animated.Value(1)).current;
  const accentPulse = useRef(new Animated.Value(0)).current;
  const calmness = useRef(new Animated.Value(isCompleted ? 1 : 0)).current; // 0 = active surface, 1 = muted

  // 60s Undo timer for fresh completions
  const [undoVisible, setUndoVisible] = useState(false);
  useEffect(() => {
    if (!isCompleted || !order.completedAt || !onReopen) {
      setUndoVisible(false);
      return;
    }
    const completedTs = Date.parse(order.completedAt);
    if (isNaN(completedTs)) return;
    const elapsed = Date.now() - completedTs;
    if (elapsed >= UNDO_WINDOW_MS) {
      setUndoVisible(false);
      return;
    }
    setUndoVisible(true);
    const t = setTimeout(() => setUndoVisible(false), UNDO_WINDOW_MS - elapsed);
    return () => clearTimeout(t);
  }, [isCompleted, order.completedAt, onReopen]);

  // Completion celebration: calm in place, single accent pulse, then signal
  // parent to flip completedAt (which moves the card to Completed list via
  // LayoutAnimation cross-fade). No flying objects.
  useEffect(() => {
    if (!isCompleting) return;
    Animated.timing(calmness, {
      toValue: 1,
      duration: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
    Animated.sequence([
      Animated.timing(accentPulse, {
        toValue: 1,
        duration: 280,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }),
      Animated.timing(accentPulse, {
        toValue: 0,
        duration: 380,
        easing: Easing.in(Easing.quad),
        useNativeDriver: false,
      }),
    ]).start();

    const t = setTimeout(() => onCompletionFinished(), COMPLETION_HOLD_MS);
    return () => clearTimeout(t);
  }, [isCompleting, accentPulse, calmness, onCompletionFinished]);

  // When the card transitions to completed (post-celebration), keep the
  // muted-surface look already set by `calmness`. When a completed card is
  // reopened, calm back down.
  useEffect(() => {
    Animated.timing(calmness, {
      toValue: isCompleted ? 1 : 0,
      duration: 240,
      useNativeDriver: false,
    }).start();
  }, [isCompleted, calmness]);

  // Accent strip color: encodes most-advanced item state. Driven by the
  // current items so a partial-ready ticket gets a green-tinted strip, etc.
  const accentBase = useMemo(() => {
    if (isCompleted) return QuinckleColors.textTertiary;
    const someServed = items.some(i => i.isServed);
    const allReady = items.every(i => i.isReady || i.isServed);
    const someReady = items.some(i => i.isReady && !i.isServed);
    if (allReady && !someServed) return QuinckleColors.success;
    if (allReady && someServed) return QuinckleColors.success;
    if (someReady) return 'rgba(34,197,94,0.55)';
    return QuinckleColors.textTertiary;
  }, [items, isCompleted]);

  const accentColor = accentPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [accentBase, QuinckleColors.success],
  });

  const cardBackground = calmness.interpolate({
    inputRange: [0, 1],
    outputRange: [QuinckleColors.surface, QuinckleColors.surfaceMuted],
  });

  // Single status phrase
  const remaining = items.filter(i => !i.isServed).length;
  const readyButNotServed = items.filter(i => i.isReady && !i.isServed).length;
  const totalCount = items.length;
  let statusPhrase: string;
  if (isCompleted) {
    statusPhrase = `Completed${order.completedAt ? ` · ${formatClock(order.completedAt)}` : ''}`;
  } else if (remaining === 0) {
    statusPhrase = 'All served';
  } else if (readyButNotServed > 0 && readyButNotServed < remaining) {
    statusPhrase = `${readyButNotServed} of ${totalCount} ready to plate`;
  } else if (readyButNotServed === remaining) {
    statusPhrase = `All ready · ${remaining} pending pickup`;
  } else {
    statusPhrase = `Preparing · ${remaining} of ${totalCount} pending`;
  }

  const orderedAt = items[0]?.orderedAt;

  return (
    <Animated.View
      style={[
        cardStyles.card,
        {
          opacity,
          backgroundColor: cardBackground,
        },
      ]}
    >
      <Animated.View style={[cardStyles.accentStrip, { backgroundColor: accentColor }]} />

      <View style={cardStyles.body}>
        <View style={cardStyles.header}>
          <View style={cardStyles.headerLeft}>
            <Text style={cardStyles.tableNo}>{order.tableNo}</Text>
            <Text style={cardStyles.metaLine}>
              {orderedAt ? `Ordered ${orderedAt}` : `${totalCount} item${totalCount === 1 ? '' : 's'}`}
              {orderedAt ? ` · ${totalCount} item${totalCount === 1 ? '' : 's'}` : ''}
            </Text>
            <Text style={[
              cardStyles.statusPhrase,
              isCompleted && cardStyles.statusPhraseMuted,
            ]}>
              {statusPhrase}
            </Text>
          </View>

          {isCompleted && undoVisible && onReopen && (
            <Pressable
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                onReopen();
              }}
              hitSlop={8}
              style={cardStyles.undoBtn}
            >
              <Ionicons name="arrow-undo" size={13} color={QuinckleColors.textSecondary} />
              <Text style={cardStyles.undoText}>Undo</Text>
            </Pressable>
          )}
        </View>

        <View style={cardStyles.itemList}>
          {items.map((it) => (
            <PickupItemRow
              key={it.id}
              item={it}
              onToggle={() => onToggleItem(it.id)}
              disabled={isCompleting}
              isCompleted={isCompleted}
            />
          ))}
        </View>
      </View>
    </Animated.View>
  );
}

function formatClock(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const cardStyles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    borderRadius: Radius.lg,
    marginBottom: Spacing.md,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    overflow: 'hidden',
  },
  accentStrip: {
    width: 4,
  },
  body: {
    flex: 1,
    padding: Spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
    gap: Spacing.sm,
  },
  headerLeft: {
    flex: 1,
    gap: 2,
  },
  tableNo: {
    color: QuinckleColors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  metaLine: {
    color: QuinckleColors.textTertiary,
    fontSize: 11,
    fontWeight: '500',
  },
  statusPhrase: {
    color: QuinckleColors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 4,
  },
  statusPhraseMuted: {
    color: QuinckleColors.textTertiary,
  },
  undoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radius.sm,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: QuinckleColors.borderSubtle,
  },
  undoText: {
    color: QuinckleColors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  itemList: {
    gap: 2,
  },
});
