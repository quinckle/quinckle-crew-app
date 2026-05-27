/**
 * KitchenTicketCard — simplified kitchen view.
 *
 * Shows the order ticket with read-only item list and a single Bump button.
 * Bumping removes the card from the active queue — it does NOT affect the
 * staff's ability to serve items. No checkboxes, no status pipeline.
 *
 * Completed-tab cards are shown dimmed with no Bump button.
 */

import React, { useEffect, useRef } from 'react';
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
};

export type KitchenTicket = {
  id:        string;
  table:     string;
  location:  string;
  placedAt?: string;
  status:    'new' | 'bumped';
  items:     KitchenItem[];
};

interface Props {
  ticket:           KitchenTicket;
  index:            number;
  onBump?:          () => void;   // undefined on completed tab
  isCompletedTab:   boolean;
  onReprint?:       () => void;
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

export function KitchenTicketCard({
  ticket,
  index,
  onBump,
  isCompletedTab,
  onReprint,
}: Props) {
  // Entry animation for completed tab
  const entryT = useRef(new Animated.Value(isCompletedTab ? 22 : 0)).current;
  const entryO = useRef(new Animated.Value(isCompletedTab ? 0 : 1)).current;
  useEffect(() => {
    if (!isCompletedTab) return;
    Animated.parallel([
      Animated.timing(entryT, { toValue: 0, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(entryO, { toValue: 1, duration: 320, useNativeDriver: true }),
    ]).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live elapsed timer
  const [, setTick] = React.useState(0);
  useEffect(() => {
    if (isCompletedTab) return; // no need to tick on completed cards
    const id = setInterval(() => setTick((t) => t + 1), 20_000);
    return () => clearInterval(id);
  }, [isCompletedTab]);

  const elapsed = formatElapsed(ticket.placedAt);

  const accentColor = isCompletedTab ? QuinckleColors.borderStrong : QuinckleColors.primary;

  return (
    <Animated.View
      style={[
        styles.card,
        isCompletedTab && styles.cardDim,
        { opacity: entryO, transform: [{ translateX: entryT }] },
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

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={styles.elapsedChip}>
              <Ionicons name="time-outline" size={11} color={QuinckleColors.textSecondary} />
              <Text style={styles.elapsedText}>{elapsed}</Text>
            </View>
            {onReprint && (
              <TouchableOpacity
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  onReprint();
                }}
                hitSlop={8}
                style={styles.reprintBtn}
              >
                <Ionicons name="print-outline" size={14} color={QuinckleColors.textSecondary} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* ── Item list (read-only) ─────────────────────────── */}
        <View style={styles.itemList}>
          {ticket.items.map((entry) => (
            <View key={entry.id} style={styles.itemRow}>
              <Ionicons name="ellipse" size={5} color={QuinckleColors.textTertiary} style={{ marginTop: 6 }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.itemLine}>{entry.name}</Text>
                {entry.modifiersSummary ? (
                  <Text style={styles.itemModifiers}>{entry.modifiersSummary}</Text>
                ) : null}
              </View>
            </View>
          ))}
        </View>

        {/* ── Bump button (active tab only) ─────────────────── */}
        {!isCompletedTab && onBump && (
          <TouchableOpacity
            style={styles.bumpBtn}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              onBump();
            }}
            activeOpacity={0.75}
          >
            <Ionicons name="checkmark-done" size={14} color={QuinckleColors.success} />
            <Text style={styles.bumpBtnText}>Bump</Text>
          </TouchableOpacity>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection:   'row',
    backgroundColor: QuinckleColors.surface,
    borderRadius:    Radius.lg,
    borderWidth:     1,
    borderColor:     QuinckleColors.border,
    overflow:        'hidden',
  },
  cardDim: {
    opacity: 0.5,
  },
  accentStrip: {
    width:      3,
    alignSelf:  'stretch',
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
    color:         QuinckleColors.textPrimary,
    fontSize:      20,
    fontWeight:    '800',
    letterSpacing: -0.5,
  },
  tableChip: {
    backgroundColor:   QuinckleColors.primarySoft,
    borderWidth:       1,
    borderColor:       QuinckleColors.primarySoftBorder,
    paddingHorizontal: 8,
    paddingVertical:   2,
    borderRadius:      Radius.sm,
  },
  tableChipText: {
    color:         QuinckleColors.primary,
    fontSize:      12,
    fontWeight:    '700',
    letterSpacing: 0.2,
  },
  elapsedChip: {
    flexDirection:     'row',
    alignItems:        'center',
    gap:               4,
    backgroundColor:   QuinckleColors.surfaceMutedHover,
    borderWidth:       1,
    borderColor:       QuinckleColors.borderSubtle,
    paddingHorizontal: 8,
    paddingVertical:   3,
    borderRadius:      Radius.sm,
  },
  elapsedText: {
    color:         QuinckleColors.textSecondary,
    fontSize:      12,
    fontWeight:    '600',
    fontVariant:   ['tabular-nums'],
    letterSpacing: 0.2,
  },
  reprintBtn: {
    width:           26,
    height:          26,
    borderRadius:    Radius.sm,
    backgroundColor: QuinckleColors.surfaceMutedHover,
    borderWidth:     1,
    borderColor:     QuinckleColors.borderSubtle,
    alignItems:      'center',
    justifyContent:  'center',
  },

  // ── Items ──────────────────────────────────────────────
  itemList: {
    gap: 2,
    marginBottom: Spacing.md,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems:    'flex-start',
    gap:           Spacing.sm,
    paddingVertical: 3,
  },
  itemLine: {
    color:      QuinckleColors.textPrimary,
    fontSize:   14,
    fontWeight: '500',
    lineHeight: 19,
  },
  itemModifiers: {
    color:      QuinckleColors.textTertiary,
    fontSize:   11,
    fontStyle:  'italic',
    marginTop:  1,
  },

  // ── Bump button ────────────────────────────────────────
  bumpBtn: {
    flexDirection:   'row',
    alignItems:      'center',
    justifyContent:  'center',
    gap:             6,
    paddingVertical: 8,
    borderRadius:    Radius.md,
    backgroundColor: QuinckleColors.successSoft,
    borderWidth:     1,
    borderColor:     QuinckleColors.successBorder,
  },
  bumpBtnText: {
    color:         QuinckleColors.success,
    fontSize:      13,
    fontWeight:    '700',
    letterSpacing: 0.3,
  },
});
