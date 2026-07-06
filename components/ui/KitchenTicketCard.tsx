/**
 * KitchenTicketCard — simplified kitchen view.
 *
 * Shows the order ticket with a read-only item list. No manual actions —
 * the card disappears automatically when the waiter marks all items served.
 * Completed-tab cards (status SERVED) are shown dimmed.
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
import { LinearGradient } from 'expo-linear-gradient';
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
  status:    'new' | 'completed';
  channel?:  'DINE_IN' | 'TAKEAWAY';
  pickupToken?: string | null;
  sessionRef?: string | null;
  items:     KitchenItem[];
};

interface Props {
  ticket:         KitchenTicket;
  index:          number;
  isCompletedTab: boolean;
  onReprint?:     () => void;
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

  // Live elapsed timer (active cards only)
  const [, setTick] = React.useState(0);
  useEffect(() => {
    if (isCompletedTab) return;
    const id = setInterval(() => setTick((t) => t + 1), 20_000);
    return () => clearInterval(id);
  }, [isCompletedTab]);

  const elapsed = formatElapsed(ticket.placedAt);
  const accentColor = isCompletedTab ? QuinckleColors.borderStrong : QuinckleColors.primary;

  const gradColors: [string, string, string, string, string] = [
    'transparent',
    `${accentColor}55`,
    accentColor,
    `${accentColor}55`,
    'transparent',
  ];

  return (
    <View style={[styles.cardOuter, isCompletedTab && styles.cardDim]}>
      <LinearGradient
        colors={gradColors}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
    <Animated.View
      style={[
        styles.card,
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
            {!isCompletedTab && (
              <View style={styles.elapsedChip}>
                <Ionicons name="time-outline" size={11} color={QuinckleColors.textSecondary} />
                <Text style={styles.elapsedText}>{elapsed}</Text>
              </View>
            )}
            {isCompletedTab && (
              <View style={[styles.elapsedChip, styles.servedChip]}>
                <Ionicons name="checkmark-circle-outline" size={11} color={QuinckleColors.success} />
                <Text style={[styles.elapsedText, { color: QuinckleColors.success }]}>Served</Text>
              </View>
            )}
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
      </View>
    </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  cardOuter: {
    borderRadius: Radius.lg + 1.5,
    padding:      1.5,
    overflow:     'hidden',
  },
  card: {
    flexDirection:   'row',
    backgroundColor: QuinckleColors.surface,
    borderRadius:    Radius.lg,
    overflow:        'hidden',
  },
  cardDim: {
    opacity: 0.45,
  },
  accentStrip: {
    width:     3,
    alignSelf: 'stretch',
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
  servedChip: {
    backgroundColor: QuinckleColors.successSoft,
    borderColor:     QuinckleColors.successBorder,
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
  },
  itemRow: {
    flexDirection:  'row',
    alignItems:     'flex-start',
    gap:            Spacing.sm,
    paddingVertical: 3,
  },
  itemLine: {
    color:      QuinckleColors.textPrimary,
    fontSize:   14,
    fontWeight: '500',
    lineHeight: 19,
  },
  itemModifiers: {
    color:     QuinckleColors.textTertiary,
    fontSize:  11,
    fontStyle: 'italic',
    marginTop: 1,
  },
});
