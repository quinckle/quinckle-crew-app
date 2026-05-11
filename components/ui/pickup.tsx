import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  LayoutAnimation,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  UIManager,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Swipeable } from 'react-native-gesture-handler';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export const PICKUP_LAYOUT_PRESET = {
  duration: 320,
  create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
  update: { type: LayoutAnimation.Types.spring, springDamping: 0.85 },
  delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
};

export type PickupItemData = {
  id: string;
  name: string;
  qty: number;
  orderedAt: string;
  isServed: boolean;
};

export type PickupOrderData = {
  id: string;
  tableNo: string;
  items: PickupItemData[];
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
    backgroundColor: QuinckleColors.primary,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: QuinckleColors.primary,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
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
    color: '#fff',
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
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  badgeText: {
    color: QuinckleColors.textTertiary,
    fontSize: 11,
    fontWeight: '700',
  },
  badgeTextActive: {
    color: '#fff',
  },
});

/* ───────────── Tick row ───────────── */

type ItemRowProps = {
  item: PickupItemData;
  onToggle: () => void;
  disabled?: boolean;
};

function PickupItemRow({ item, onToggle, disabled }: ItemRowProps) {
  const tickScale = useRef(new Animated.Value(1)).current;
  const fillProgress = useRef(new Animated.Value(item.isServed ? 1 : 0)).current;
  const rowOpacity = useRef(new Animated.Value(item.isServed ? 0.5 : 1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fillProgress, {
        toValue: item.isServed ? 1 : 0,
        duration: 220,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }),
      Animated.timing(rowOpacity, {
        toValue: item.isServed ? 0.5 : 1,
        duration: 220,
        useNativeDriver: false,
      }),
    ]).start();
  }, [item.isServed, fillProgress, rowOpacity]);

  const handlePress = () => {
    if (disabled) return;
    Animated.sequence([
      Animated.timing(tickScale, {
        toValue: 0.85,
        duration: 80,
        useNativeDriver: false,
      }),
      Animated.spring(tickScale, {
        toValue: 1.08,
        friction: 4,
        tension: 140,
        useNativeDriver: false,
      }),
      Animated.spring(tickScale, {
        toValue: 1,
        friction: 5,
        tension: 120,
        useNativeDriver: false,
      }),
    ]).start();
    onToggle();
  };

  const fillBg = fillProgress.interpolate({
    inputRange: [0, 1],
    outputRange: ['rgba(34,197,94,0)', QuinckleColors.success],
  });
  const tickBorder = fillProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [QuinckleColors.primary, QuinckleColors.success],
  });

  return (
    <TouchableOpacity activeOpacity={0.85} onPress={handlePress} disabled={disabled}>
      <Animated.View style={[rowStyles.row, { opacity: rowOpacity }]}>
        <View style={rowStyles.left}>
          <Text style={[rowStyles.qty, item.isServed && rowStyles.qtyServed]}>{item.qty}×</Text>
          <View style={{ flex: 1 }}>
            <Text
              style={[rowStyles.name, item.isServed && rowStyles.nameServed]}
              numberOfLines={1}
            >
              {item.name}
            </Text>
            <Text style={rowStyles.time}>ordered {item.orderedAt}</Text>
          </View>
        </View>
        <Animated.View
          style={[
            rowStyles.tick,
            {
              backgroundColor: fillBg,
              borderColor: tickBorder,
              transform: [{ scale: tickScale }],
            },
          ]}
        >
          <Animated.View style={{ opacity: fillProgress }}>
            <Ionicons name="checkmark" size={14} color="#fff" />
          </Animated.View>
        </Animated.View>
      </Animated.View>
    </TouchableOpacity>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.sm,
    backgroundColor: QuinckleColors.surfaceMuted,
    borderWidth: 1,
    borderColor: QuinckleColors.borderSubtle,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    flex: 1,
  },
  qty: {
    color: QuinckleColors.primary,
    fontSize: 15,
    fontWeight: '700',
  },
  qtyServed: {
    color: QuinckleColors.textTertiary,
  },
  name: {
    color: QuinckleColors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  nameServed: {
    color: QuinckleColors.textTertiary,
    textDecorationLine: 'line-through',
  },
  time: {
    color: QuinckleColors.textTertiary,
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
  },
  tick: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
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

const COMPLETION_HOLD_MS = 650;
const CARD_SLIDE_OUT_MS = 320;

export function PickupCard({
  order,
  isCompleting,
  onToggleItem,
  onCompletionFinished,
  onReopen,
}: CardProps) {
  const isCompleted = !!order.completedAt;

  const cardX = useRef(new Animated.Value(0)).current;
  const cardOpacity = useRef(new Animated.Value(1)).current;
  const pillY = useRef(new Animated.Value(-24)).current;
  const pillOpacity = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isCompleting) {
      cardX.setValue(0);
      cardOpacity.setValue(1);

      Animated.parallel([
        Animated.spring(pillY, {
          toValue: 0,
          friction: 6,
          tension: 110,
          useNativeDriver: true,
        }),
        Animated.timing(pillOpacity, {
          toValue: 1,
          duration: 220,
          useNativeDriver: true,
        }),
        Animated.timing(glow, {
          toValue: 1,
          duration: 260,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: false,
        }),
      ]).start();

      const t = setTimeout(() => {
        Animated.parallel([
          Animated.timing(cardX, {
            toValue: 360,
            duration: CARD_SLIDE_OUT_MS,
            easing: Easing.in(Easing.cubic),
            useNativeDriver: false,
          }),
          Animated.timing(cardOpacity, {
            toValue: 0,
            duration: CARD_SLIDE_OUT_MS - 40,
            useNativeDriver: false,
          }),
        ]).start(({ finished }) => {
          if (finished) onCompletionFinished();
        });
      }, COMPLETION_HOLD_MS);

      return () => clearTimeout(t);
    } else {
      Animated.parallel([
        Animated.timing(pillY, {
          toValue: -24,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(pillOpacity, {
          toValue: 0,
          duration: 160,
          useNativeDriver: true,
        }),
        Animated.timing(glow, {
          toValue: 0,
          duration: 240,
          useNativeDriver: false,
        }),
        Animated.spring(cardX, {
          toValue: 0,
          useNativeDriver: false,
          friction: 8,
          tension: 100,
        }),
        Animated.timing(cardOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: false,
        }),
      ]).start();
    }
  }, [isCompleting, cardOpacity, cardX, glow, onCompletionFinished, pillOpacity, pillY]);

  const borderColor = glow.interpolate({
    inputRange: [0, 1],
    outputRange: [QuinckleColors.border, QuinckleColors.successBorder],
  });

  const remaining = order.items.filter((i) => !i.isServed).length;

  const cardInner = (
    <Animated.View
      style={[
        cardStyles.card,
        isCompleted && cardStyles.cardCompleted,
        {
          transform: [{ translateX: cardX }],
          opacity: cardOpacity,
          borderColor,
        },
      ]}
    >
      {isCompleting && (
        <Animated.View
          style={[
            cardStyles.completePill,
            { transform: [{ translateY: pillY }], opacity: pillOpacity },
          ]}
        >
          <Ionicons name="checkmark-circle" size={14} color="#fff" />
          <Text style={cardStyles.completePillText}>Order Complete</Text>
        </Animated.View>
      )}

      <View style={cardStyles.header}>
        <View style={cardStyles.tableBadge}>
          <Text style={cardStyles.tableBadgeText}>{order.tableNo}</Text>
        </View>
        {isCompleted ? (
          <View style={cardStyles.completedCorner}>
            <Ionicons name="checkmark-circle" size={12} color={QuinckleColors.success} />
            <Text style={cardStyles.completedCornerText}>
              Completed · {order.completedAt}
            </Text>
          </View>
        ) : (
          <Text style={cardStyles.pendingText}>
            {remaining === 0 ? 'All served' : `${remaining} of ${order.items.length} pending`}
          </Text>
        )}
      </View>

      <View style={cardStyles.itemList}>
        {order.items.map((it) => (
          <PickupItemRow
            key={it.id}
            item={it}
            onToggle={() => onToggleItem(it.id)}
            disabled={isCompleting}
          />
        ))}
      </View>
    </Animated.View>
  );

  if (isCompleted && onReopen) {
    return (
      <Swipeable
        renderRightActions={() => (
          <View style={cardStyles.swipeAction}>
            <Ionicons name="arrow-undo" size={18} color="#fff" />
            <Text style={cardStyles.swipeActionText}>Reopen</Text>
          </View>
        )}
        overshootRight={false}
        onSwipeableOpen={onReopen}
        containerStyle={cardStyles.swipeWrap}
      >
        {cardInner}
      </Swipeable>
    );
  }

  return cardInner;
}

const cardStyles = StyleSheet.create({
  swipeWrap: {
    marginBottom: Spacing.md,
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  card: {
    backgroundColor: QuinckleColors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
    borderWidth: 1,
    overflow: 'hidden',
  },
  cardCompleted: {
    backgroundColor: QuinckleColors.surfaceMuted,
    opacity: 0.92,
  },
  completePill: {
    position: 'absolute',
    top: Spacing.sm,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    backgroundColor: QuinckleColors.success,
    shadowColor: QuinckleColors.success,
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
    zIndex: 10,
  },
  completePillText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.2,
  },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  tableBadge: {
    backgroundColor: QuinckleColors.primarySoft,
    borderWidth: 1,
    borderColor: QuinckleColors.primarySoftBorder,
    paddingHorizontal: Spacing.md,
    paddingVertical: 5,
    borderRadius: Radius.sm,
  },
  tableBadgeText: {
    color: QuinckleColors.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  pendingText: {
    color: QuinckleColors.textTertiary,
    fontSize: 12,
    fontWeight: '500',
  },
  completedCorner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: QuinckleColors.successSoft,
    borderWidth: 1,
    borderColor: QuinckleColors.successBorder,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: Radius.pill,
  },
  completedCornerText: {
    color: QuinckleColors.success,
    fontSize: 11,
    fontWeight: '600',
  },

  itemList: {
    gap: Spacing.sm,
  },

  swipeAction: {
    width: 92,
    backgroundColor: QuinckleColors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 4,
  },
  swipeActionText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
});
