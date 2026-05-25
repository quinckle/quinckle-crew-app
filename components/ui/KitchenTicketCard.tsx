/**
 * KitchenTicketCard — polished kitchen ticket for the cook view.
 *
 * Pure visual rework of the previous in-file card. Same behaviour:
 * tap items to toggle prepared, card auto-bumps to READY when all
 * items checked, then the parent slides it into Completed.
 *
 * Visual additions:
 *  - 3px accent strip down the left edge, tinted by progress
 *  - Larger ticket number, primary-tinted table chip
 *  - Monospace elapsed-time chip (recomputed every 20s)
 *  - 4px rounded animated progress bar
 *  - Spring-scale checkbox + haptic feedback on tap
 *  - Animated strike-through fade on prepared items
 *  - Refined READY banner with soft success background
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';

export type KitchenItem = {
  id:                string;
  name:              string;
  modifiersSummary?: string | null;
  isPrepared:        boolean;
};

export type KitchenTicket = {
  id:        string;
  table:     string;
  location:  string;
  placedAt?: string;
  status:    'new' | 'urgent' | 'preparing' | 'ready' | 'bumped';
  items:     KitchenItem[];
};

interface Props {
  ticket:           KitchenTicket;
  index:            number;
  onTogglePrepared: (itemId: string) => void;
  isCompletedTab:   boolean;
}

// Format elapsed time as "0:42" / "06:18" / "1h 24m"
function formatElapsed(placedAt?: string): string {
  if (!placedAt) return '—';
  const ms = Date.now() - new Date(placedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const totalMin = Math.floor(ms / 60_000);
  const sec = Math.floor((ms % 60_000) / 1000);
  if (totalMin < 1) return `0:${String(sec).padStart(2, '0')}`;
  if (totalMin < 60) return `${totalMin}:${String(sec).padStart(2, '0')}`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${m}m`;
}

// Animated item row — owns its own strike-through fade.
function ItemRow({
  item,
  onToggle,
  disabled,
}: {
  item:     KitchenItem;
  onToggle: () => void;
  disabled: boolean;
}) {
  const checkScale  = useRef(new Animated.Value(item.isPrepared ? 1 : 0)).current;
  const strikeOpacity = useRef(new Animated.Value(item.isPrepared ? 1 : 0)).current;

  useEffect(() => {
    // Spring scale on the checkbox tick
    Animated.spring(checkScale, {
      toValue:        item.isPrepared ? 1 : 0,
      friction:       6,
      tension:        180,
      useNativeDriver: true,
    }).start();
    // Fade strike-through in/out
    Animated.timing(strikeOpacity, {
      toValue:    item.isPrepared ? 1 : 0,
      duration:   200,
      easing:     Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [item.isPrepared, checkScale, strikeOpacity]);

  const handlePress = () => {
    if (disabled) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    onToggle();
  };

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.7}
      disabled={disabled}
      style={styles.itemRow}
    >
      <View style={[styles.checkbox, item.isPrepared && styles.checkboxChecked]}>
        <Animated.View style={{ transform: [{ scale: checkScale }] }}>
          <Ionicons name="checkmark" size={13} color="#fff" />
        </Animated.View>
      </View>

      <View style={{ flex: 1 }}>
        <View>
          <Text style={[styles.itemLine, item.isPrepared && styles.itemLineDim]}>
            {item.name}
          </Text>
          {/* Strike-through overlay — animated, anchored to text height */}
          <Animated.View
            pointerEvents="none"
            style={[
              styles.strikeLine,
              { opacity: strikeOpacity },
            ]}
          />
        </View>
        {item.modifiersSummary ? (
          <Text style={styles.itemModifiers}>{item.modifiersSummary}</Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

export function KitchenTicketCard({
  ticket,
  index,
  onTogglePrepared,
  isCompletedTab,
}: Props) {
  const disabled    = ticket.status === 'bumped';
  const total       = ticket.items.length;
  const prepared    = ticket.items.filter((i) => i.isPrepared).length;
  const progress    = total === 0 ? 0 : prepared / total;
  const isReady     = ticket.status === 'ready';

  // Live elapsed timer — recompute every 20s while mounted.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 20_000);
    return () => clearInterval(id);
  }, []);
  const elapsed = useMemo(() => formatElapsed(ticket.placedAt), [ticket.placedAt]);

  // Progress bar — animated width.
  const barProgress = useRef(new Animated.Value(progress)).current;
  useEffect(() => {
    Animated.timing(barProgress, {
      toValue:    progress,
      duration:   320,
      easing:     Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [progress, barProgress]);

  // Entry animation when card mounts into Completed list.
  const entryT = useRef(new Animated.Value(isCompletedTab ? 22 : 0)).current;
  const entryO = useRef(new Animated.Value(isCompletedTab ? 0 : 1)).current;
  useEffect(() => {
    if (!isCompletedTab) return;
    Animated.parallel([
      Animated.timing(entryT, { toValue: 0, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(entryO, { toValue: 1, duration: 320, useNativeDriver: true }),
    ]).start();
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // READY banner: spring in
  const bannerT = useRef(new Animated.Value(isReady ? 0 : 8)).current;
  const bannerO = useRef(new Animated.Value(isReady ? 1 : 0)).current;
  useEffect(() => {
    if (!isReady) return;
    bannerT.setValue(8);
    bannerO.setValue(0);
    Animated.parallel([
      Animated.spring(bannerT, { toValue: 0, friction: 7, tension: 110, useNativeDriver: true }),
      Animated.timing(bannerO, { toValue: 1, duration: 240, useNativeDriver: true }),
    ]).start();
  }, [isReady, bannerT, bannerO]);

  // Accent strip color follows progress.
  const accentColor =
    disabled    ? QuinckleColors.borderStrong
    : isReady   ? QuinckleColors.success
    : prepared === 0 ? QuinckleColors.borderStrong
    : 'rgba(34,197,94,0.55)';

  return (
    <Animated.View
      style={[
        styles.card,
        disabled && styles.cardDim,
        {
          opacity:   entryO,
          transform: [{ translateX: entryT }],
        },
      ]}
    >
      {/* Left accent strip */}
      <View style={[styles.accentStrip, { backgroundColor: accentColor }]} />

      <View style={styles.cardBody}>
        {/* ── Header ───────────────────────────────────────── */}
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <Text style={styles.ticketNumber}>#{index}</Text>
            <View style={styles.tableChip}>
              <Text style={styles.tableChipText}>{ticket.table}</Text>
            </View>
          </View>

          <View style={styles.elapsedChip}>
            <Ionicons name="time-outline" size={11} color={QuinckleColors.textSecondary} />
            <Text style={styles.elapsedText}>{elapsed}</Text>
          </View>
        </View>

        {/* ── Progress bar + count ─────────────────────────── */}
        <View style={styles.progressRow}>
          <View style={styles.progressTrack}>
            <Animated.View
              style={[
                styles.progressFill,
                {
                  width: barProgress.interpolate({
                    inputRange:  [0, 1],
                    outputRange: ['0%', '100%'],
                  }),
                  backgroundColor: isReady ? QuinckleColors.success : QuinckleColors.primary,
                },
              ]}
            />
          </View>
          <Text style={styles.progressLabel}>
            {prepared}/{total}
          </Text>
        </View>

        {/* ── Item list ────────────────────────────────────── */}
        <View style={styles.itemList}>
          {ticket.items.map((entry) => (
            <ItemRow
              key={entry.id}
              item={entry}
              onToggle={() => onTogglePrepared(entry.id)}
              disabled={disabled}
            />
          ))}
        </View>

        {/* ── READY banner ─────────────────────────────────── */}
        {isReady && (
          <Animated.View
            style={[
              styles.readyBanner,
              {
                opacity:   bannerO,
                transform: [{ translateY: bannerT }],
              },
            ]}
          >
            <Ionicons name="checkmark-circle" size={14} color={QuinckleColors.success} />
            <Text style={styles.readyBannerText}>Ready · sending out</Text>
          </Animated.View>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection:  'row',
    backgroundColor: QuinckleColors.surface,
    borderRadius:    Radius.lg,
    borderWidth:     1,
    borderColor:     QuinckleColors.border,
    overflow:        'hidden',
  },
  cardDim: {
    opacity: 0.55,
  },
  accentStrip: {
    width:           3,
    alignSelf:       'stretch',
  },
  cardBody: {
    flex:    1,
    padding: Spacing.lg,
  },

  // ── Header ─────────────────────────────────────────────
  headerRow: {
    flexDirection:  'row',
    justifyContent: 'space-between',
    alignItems:     'center',
    marginBottom:   Spacing.md,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           Spacing.sm,
  },
  ticketNumber: {
    color:          QuinckleColors.textPrimary,
    fontSize:       20,
    fontWeight:     '800',
    letterSpacing:  -0.5,
  },
  tableChip: {
    backgroundColor:  QuinckleColors.primarySoft,
    borderWidth:      1,
    borderColor:      QuinckleColors.primarySoftBorder,
    paddingHorizontal: 8,
    paddingVertical:   2,
    borderRadius:      Radius.sm,
  },
  tableChipText: {
    color:          QuinckleColors.primary,
    fontSize:       12,
    fontWeight:     '700',
    letterSpacing:  0.2,
  },
  elapsedChip: {
    flexDirection:    'row',
    alignItems:       'center',
    gap:              4,
    backgroundColor:  QuinckleColors.surfaceMutedHover,
    borderWidth:      1,
    borderColor:      QuinckleColors.borderSubtle,
    paddingHorizontal: 8,
    paddingVertical:   3,
    borderRadius:      Radius.sm,
  },
  elapsedText: {
    color:        QuinckleColors.textSecondary,
    fontSize:     12,
    fontWeight:   '600',
    fontVariant:  ['tabular-nums'],
    letterSpacing: 0.2,
  },

  // ── Progress ───────────────────────────────────────────
  progressRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           Spacing.sm,
    marginBottom:  Spacing.sm,
  },
  progressTrack: {
    flex:            1,
    height:          4,
    borderRadius:    2,
    backgroundColor: QuinckleColors.borderSubtle,
    overflow:        'hidden',
  },
  progressFill: {
    height:       '100%',
    borderRadius: 2,
  },
  progressLabel: {
    color:        QuinckleColors.textTertiary,
    fontSize:     11,
    fontWeight:   '700',
    fontVariant:  ['tabular-nums'],
    letterSpacing: 0.3,
  },

  // ── Items ──────────────────────────────────────────────
  itemList: {
    gap: 2,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems:    'center',
    gap:           Spacing.sm,
    paddingVertical: 6,
  },
  checkbox: {
    width:        22,
    height:       22,
    borderRadius: 11,
    borderWidth:  1.5,
    borderColor:  QuinckleColors.borderStrong,
    alignItems:   'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: QuinckleColors.success,
    borderColor:     QuinckleColors.success,
  },
  itemLine: {
    color:       QuinckleColors.textPrimary,
    fontSize:    14,
    fontWeight:  '500',
    lineHeight:  19,
  },
  itemLineDim: {
    color: QuinckleColors.textTertiary,
  },
  // Strike-through overlay (animated independently for fade)
  strikeLine: {
    position:        'absolute',
    left:            0,
    right:           0,
    top:             9, // ≈ mid-line of fontSize 14 / lineHeight 19
    height:          1,
    backgroundColor: QuinckleColors.textTertiary,
  },
  itemModifiers: {
    color:        QuinckleColors.textTertiary,
    fontSize:     11,
    fontStyle:    'italic',
    marginTop:    1,
  },

  // ── Ready banner ───────────────────────────────────────
  readyBanner: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    gap:             6,
    paddingVertical: 8,
    marginTop:       Spacing.md,
    borderRadius:    Radius.md,
    backgroundColor: QuinckleColors.successSoft,
    borderWidth:     1,
    borderColor:     QuinckleColors.successBorder,
  },
  readyBannerText: {
    color:          QuinckleColors.success,
    fontSize:       11,
    fontWeight:     '800',
    letterSpacing:  0.5,
    textTransform:  'uppercase',
  },
});
