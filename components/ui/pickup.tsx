import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  LayoutAnimation,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// Buttery reflow used when cards enter/leave Active or Completed lists.
// `update` uses a soft spring so the cards beneath a just-completed card
// glide upward into the empty slot instead of snapping. Delete fades quickly
// so the empty slot opens up while the spring is still settling — the eye
// reads it as "card melts away → neighbors flow up to fill in."
export const PICKUP_LAYOUT_PRESET = {
  duration: 460,
  create: {
    type: LayoutAnimation.Types.easeOut,
    property: LayoutAnimation.Properties.opacity,
  },
  update: {
    type: LayoutAnimation.Types.spring,
    springDamping: 0.78,
  },
  delete: {
    duration: 240,
    type: LayoutAnimation.Types.easeIn,
    property: LayoutAnimation.Properties.opacity,
  },
};

export type PickupItemData = {
  id: string;
  name: string;
  qty: number;
  /**
   * Units of `qty` already handed to the guest. A steward often carries out 2
   * of a 4× line and comes back for the rest, so a line is not all-or-nothing.
   * isServed === (servedQty >= qty).
   */
  servedQty: number;
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
  onToggle: (nextQty: number) => void;
  disabled?: boolean;
  isCompleted?: boolean;
};

function PickupItemRow({ item, onToggle, disabled, isCompleted }: ItemRowProps) {
  // Four calm states:
  //   served  → filled check, collapsed, line-through
  //   partial → half-filled check, "2/4×", still tappable for the rest
  //   ready   → empty check, bold text, green dot, tap-row enabled
  //   pending → empty check, faded text, kitchen dot, untappable
  const tappable = item.isReady && !item.isServed && !disabled && !isCompleted;
  const servedQty = Math.max(0, Math.min(item.qty, item.servedQty));
  const isPartial = !item.isServed && servedQty > 0;
  // Hold-to-serve-the-rest only earns its place when there IS a rest.
  const holdable = tappable && item.qty - servedQty > 1;

  // One tap hands over one more unit. A 1× line therefore behaves exactly as
  // it always has: single tap, done.
  const handlePress = () => {
    if (!tappable) return;
    Haptics.selectionAsync().catch(() => {});
    onToggle(servedQty + 1);
  };

  const handleLongPress = () => {
    if (!holdable) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    onToggle(item.qty);
  };

  return (
    <Pressable
      onPress={handlePress}
      onLongPress={handleLongPress}
      delayLongPress={350}
      disabled={!tappable}
      android_ripple={tappable ? { color: 'rgba(255,255,255,0.05)' } : undefined}
      style={[rowStyles.row, item.isServed && rowStyles.rowServed]}
    >
      <View style={[
        rowStyles.checkbox,
        item.isServed && rowStyles.checkboxFilled,
        (item.isReady || isPartial) && !item.isServed && rowStyles.checkboxReady,
      ]}>
        {item.isServed && <Ionicons name="checkmark" size={12} color="#fff" />}
        {isPartial && <View style={rowStyles.checkboxPartialFill} />}
      </View>

      <Text style={[
        rowStyles.qty,
        isPartial && rowStyles.qtyPartial,
        item.isServed && rowStyles.textMuted,
        !item.isReady && !item.isServed && rowStyles.textMuted,
      ]}>
        {isPartial ? `${servedQty}/${item.qty}×` : `${item.qty}×`}
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
  // Part of the line is out. Reads as "started, not finished" at a glance,
  // without the finality of the filled checkmark.
  checkboxPartialFill: {
    width: 8,
    height: 8,
    borderRadius: 2,
    backgroundColor: QuinckleColors.success,
  },
  qty: {
    color: QuinckleColors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
    minWidth: 24,
  },
  qtyPartial: {
    color: QuinckleColors.success,
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
  onToggleItem: (itemId: string, nextQty: number) => void;
  onCompletionFinished: () => void;
  onReopen?: () => void;
  /**
   * Desktop grid (index.tsx's Orders tab): a fixed tile size instead of the
   * phone's natural full-width, height-to-content card — every ticket the
   * same size, none stretched to fill its row/column. The item list becomes
   * internally scrollable to fit whatever's left under the header, rather
   * than the card growing past its fixed height for a long ticket. Omit both
   * for the original behaviour.
   */
  fixedWidth?: number;
  fixedHeight?: number;
};

const SWEEP_DURATION_MS = 480;     // green wipe left → right
const SWEEP_HOLD_MS = 320;         // full-coverage hold so "COMPLETED" reads
const COMPLETION_TOTAL_MS = SWEEP_DURATION_MS + SWEEP_HOLD_MS;
const ENTRY_RECENT_MS = 1500;      // play entry animation on completed cards mounted within this window
const UNDO_WINDOW_MS = 60_000;

export function PickupCard({
  order,
  isCompleting,
  onToggleItem,
  onCompletionFinished,
  onReopen,
  fixedWidth,
  fixedHeight,
}: CardProps) {
  const isFixedSize = fixedWidth != null && fixedHeight != null;
  const isCompleted = !!order.completedAt;
  const items = order.items;

  // Card-level animated values
  const calmness = useRef(new Animated.Value(isCompleted ? 1 : 0)).current; // 0 = active surface, 1 = muted
  const sweepProgress = useRef(new Animated.Value(0)).current;              // 0 = no overlay, 1 = full sweep covered
  const badgePop = useRef(new Animated.Value(0)).current;                   // COMPLETED badge scale+opacity
  const entryTranslate = useRef(new Animated.Value(0)).current;             // slide-in when card mounts into Completed list
  const entryOpacity = useRef(new Animated.Value(1)).current;

  // Measure the card so the sweep overlay knows how far to translate.
  const [cardWidth, setCardWidth] = useState(0);

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

  // Mount-time entry animation on cards that just landed in the Completed
  // list. Detected by a fresh completedAt timestamp.
  useEffect(() => {
    if (!isCompleted || !order.completedAt) return;
    const ts = Date.parse(order.completedAt);
    if (isNaN(ts)) return;
    const age = Date.now() - ts;
    if (age > ENTRY_RECENT_MS) return;
    entryTranslate.setValue(28);
    entryOpacity.setValue(0);
    Animated.parallel([
      Animated.timing(entryTranslate, {
        toValue: 0,
        duration: 320,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(entryOpacity, {
        toValue: 1,
        duration: 320,
        useNativeDriver: true,
      }),
    ]).start();
    // run-once on mount only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Completion celebration: green sweep wipes across left→right, "COMPLETED"
  // badge pops in mid-sweep, brief full-coverage hold, then signal parent to
  // flip completedAt (which removes this card from Active via LayoutAnimation
  // cross-fade; a fresh instance mounts in Completed with the entry slide).
  useEffect(() => {
    if (!isCompleting) return;

    Animated.timing(calmness, {
      toValue: 1,
      duration: SWEEP_DURATION_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();

    Animated.timing(sweepProgress, {
      toValue: 1,
      duration: SWEEP_DURATION_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();

    Animated.sequence([
      Animated.delay(Math.round(SWEEP_DURATION_MS * 0.45)),
      Animated.spring(badgePop, {
        toValue: 1,
        friction: 6,
        tension: 130,
        useNativeDriver: true,
      }),
    ]).start();

    const t = setTimeout(() => onCompletionFinished(), COMPLETION_TOTAL_MS);
    return () => clearTimeout(t);
  }, [isCompleting, calmness, sweepProgress, badgePop, onCompletionFinished]);

  // Reopened completed card → calm back down + clear sweep overlay state
  useEffect(() => {
    if (isCompleted || isCompleting) return;
    Animated.timing(calmness, {
      toValue: 0,
      duration: 240,
      useNativeDriver: false,
    }).start();
    sweepProgress.setValue(0);
    badgePop.setValue(0);
  }, [isCompleted, isCompleting, calmness, sweepProgress, badgePop]);

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

  const cardBackground = calmness.interpolate({
    inputRange: [0, 1],
    outputRange: [QuinckleColors.surface, QuinckleColors.surfaceMuted],
  });

  const sweepTranslateX = sweepProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [-(cardWidth || 1), 0],
  });

  const badgeScale = badgePop.interpolate({
    inputRange: [0, 1],
    outputRange: [0.6, 1],
  });

  // Single status phrase — simplified for direct-serve flow (no kitchen gate).
  // Counted in UNITS, not lines: with partial ticking a 4× line can be half
  // out, and "1 of 2 served" would be a lie about how much food is still owed.
  const totalCount = items.length;
  const unitsTotal = items.reduce((n, i) => n + i.qty, 0);
  const unitsServed = items.reduce((n, i) => n + Math.min(i.qty, i.servedQty), 0);
  const remaining = unitsTotal - unitsServed;
  let statusPhrase: string;
  if (isCompleted) {
    statusPhrase = `Completed${order.completedAt ? ` · ${formatClock(order.completedAt)}` : ''}`;
  } else if (remaining === 0) {
    statusPhrase = 'All served';
  } else if (unitsServed > 0) {
    statusPhrase = `${unitsServed} of ${unitsTotal} served · ${remaining} remaining`;
  } else {
    statusPhrase = `${remaining} item${remaining === 1 ? '' : 's'} · tap to serve`;
  }

  const orderedAt = items[0]?.orderedAt;

  const gradColors: [string, string, string, string, string] = [
    'transparent',
    `${accentBase}55`,
    accentBase,
    `${accentBase}55`,
    'transparent',
  ];

  const itemRows = items.map((it) => (
    <PickupItemRow
      key={it.id}
      item={it}
      onToggle={(nextQty) => onToggleItem(it.id, nextQty)}
      disabled={isCompleting}
      isCompleted={isCompleted}
    />
  ));

  return (
    <View style={[cardStyles.cardOuter, isFixedSize && { width: fixedWidth }]}>
      <LinearGradient
        colors={gradColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
    <Animated.View
      onLayout={(e) => setCardWidth(e.nativeEvent.layout.width)}
      style={[
        cardStyles.card,
        isFixedSize && { height: fixedHeight },
        {
          backgroundColor: cardBackground,
          opacity: entryOpacity,
          transform: [{ translateX: entryTranslate }],
        },
      ]}
    >
      <View style={[cardStyles.accentStrip, { backgroundColor: accentBase }]} />

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

        {/* Fixed tile: the list gets whatever's left under the header and
            scrolls internally, so a long ticket never grows the tile past
            its fixed height — every card in the grid stays the same size. */}
        {isFixedSize ? (
          <ScrollView style={cardStyles.itemListScroll} showsVerticalScrollIndicator={false}>
            <View style={cardStyles.itemList}>{itemRows}</View>
          </ScrollView>
        ) : (
          <View style={cardStyles.itemList}>{itemRows}</View>
        )}
      </View>

      {/* Green sweep overlay — fills left → right when the order completes,
          then holds long enough to show "COMPLETED" before the card slides
          out to the Completed tab. */}
      {isCompleting && cardWidth > 0 && (
        <Animated.View
          pointerEvents="none"
          style={[
            cardStyles.sweepOverlay,
            {
              width: cardWidth,
              transform: [{ translateX: sweepTranslateX }],
            },
          ]}
        >
          <Animated.View
            style={[
              cardStyles.sweepBadge,
              {
                opacity: badgePop,
                transform: [{ scale: badgeScale }],
              },
            ]}
          >
            <Ionicons name="checkmark-circle" size={20} color="#fff" />
            <Text style={cardStyles.sweepBadgeText}>Completed</Text>
          </Animated.View>
        </Animated.View>
      )}
    </Animated.View>
    </View>
  );
}

function formatClock(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const cardStyles = StyleSheet.create({
  cardOuter: {
    borderRadius: Radius.lg + 1.5,
    padding: 1.5,
    overflow: 'hidden',
    marginBottom: Spacing.md,
  },
  card: {
    flexDirection: 'row',
    borderRadius: Radius.lg,
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
  // Fixed-tile grid only — `body` is already bounded (card has a fixed
  // height, and stretches to it via the row's default alignItems), so
  // flex:1 here just claims whatever's left under the header.
  itemListScroll: {
    flex: 1,
  },
  sweepOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    backgroundColor: QuinckleColors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sweepBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sweepBadgeText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
});
