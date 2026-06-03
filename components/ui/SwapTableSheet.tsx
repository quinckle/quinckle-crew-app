/**
 * SwapTableSheet — bottom sheet for moving a guest to a different table.
 *
 * Matches the partner app's SwapSheet design:
 *   - Spring-animated BottomSheet with drag-to-dismiss
 *   - 3-column grid of available tables
 *   - Pulsing skeleton cells while tables load
 *   - Orange highlight on selected cell
 *   - "Move session" CTA at bottom
 */

import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { BottomSheet } from './BottomSheet';
import { Skeleton } from './Skeleton';
import { crewTables } from '../../services/api';
import type { CrewTable } from '../../services/api';
import { QuinckleColors, Radius, Spacing, Typography } from '../../constants/Colors';

// ── 3-column grid ─────────────────────────────────────────────────────────────

function SwapGrid({ children }: { children: React.ReactNode }) {
  const items = React.Children.toArray(children);
  const rows: React.ReactNode[][] = [];
  for (let i = 0; i < items.length; i += 3) rows.push(items.slice(i, i + 3));
  return (
    <View style={styles.swapGrid}>
      {rows.map((row, ri) => (
        <View key={ri} style={styles.swapRow}>
          {row}
          {row.length < 3 && Array.from({ length: 3 - row.length }).map((_, pi) => (
            <View key={pi} style={styles.swapCellGhost} />
          ))}
        </View>
      ))}
    </View>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  visible: boolean;
  /** DB id of the table currently being viewed (excluded from targets). */
  currentTableDbId: string;
  /** Display number e.g. "05" — shown in the sheet subtitle. */
  currentTableNum: string;
  onClose: () => void;
  onSwap: (result: { targetId: string; targetNumber: number }) => void;
  /** Whether a swap is in-flight (shows spinner text on confirm button). */
  submitting?: boolean;
}

export function SwapTableSheet({
  visible,
  currentTableDbId,
  currentTableNum,
  onClose,
  onSwap,
  submitting = false,
}: Props) {
  const [tables, setTables] = useState<CrewTable[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    setSelected(null);
    crewTables.list()
      .then(res => {
        const raw: CrewTable[] = (res as any)?.tables ?? [];
        setTables(raw.filter(t => t.status === 'available'));
      })
      .catch(() => setTables([]))
      .finally(() => setLoading(false));
  }, [visible]);

  const targets = tables.filter(t => t.table_id !== currentTableDbId);

  const handleConfirm = () => {
    if (!selected) return;
    const t = targets.find(x => x.table_id === selected);
    if (t) onSwap({ targetId: t.table_id, targetNumber: t.table_number });
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Swap table">
      <Text style={styles.sub}>
        Move T{currentTableNum} session to an available table
      </Text>

      {loading ? (
        // 9 ghost skeleton cells while fetching
        <SwapGrid>
          {Array.from({ length: 9 }).map((_, i) => (
            <View key={i} style={styles.swapCell}>
              <Skeleton width={36} height={18} radius={6} style={{ marginBottom: 4 }} />
              <Skeleton width={44} height={11} radius={4} />
            </View>
          ))}
        </SwapGrid>
      ) : targets.length === 0 ? (
        <Text style={styles.empty}>No available tables right now</Text>
      ) : (
        <SwapGrid>
          {targets.map(t => (
            <TouchableOpacity
              key={t.table_id}
              style={[styles.swapCell, selected === t.table_id && styles.swapCellActive]}
              onPress={() => setSelected(t.table_id)}
              activeOpacity={0.75}
            >
              <Text style={[styles.swapCellNumber, selected === t.table_id && { color: QuinckleColors.primary }]}>
                T{String(t.table_number).padStart(2, '0')}
              </Text>
              <Text style={styles.swapCellCap}>{t.capacity} seats</Text>
            </TouchableOpacity>
          ))}
        </SwapGrid>
      )}

      <TouchableOpacity
        style={[styles.confirmBtn, (!selected || submitting) && { opacity: 0.4 }]}
        disabled={!selected || submitting}
        onPress={handleConfirm}
        activeOpacity={0.85}
      >
        <Text style={styles.confirmText}>
          {submitting ? 'Moving…' : 'Move session'}
        </Text>
      </TouchableOpacity>
    </BottomSheet>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  sub: {
    ...Typography.caption,
    color: QuinckleColors.textMuted,
    paddingHorizontal: Spacing.xl,
    marginBottom: Spacing.lg,
  },
  empty: {
    ...Typography.body,
    color: QuinckleColors.textMuted,
    textAlign: 'center',
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.xl,
  },
  swapGrid: {
    paddingHorizontal: Spacing.xl,
    marginBottom: Spacing.lg,
    gap: Spacing.sm,
  },
  swapRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  swapCell: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: Radius.lg,
    backgroundColor: QuinckleColors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  swapCellGhost: {
    flex: 1,
    aspectRatio: 1,
  },
  swapCellActive: {
    backgroundColor: QuinckleColors.primarySoft,
    borderWidth: 1.5,
    borderColor: QuinckleColors.primary,
  },
  swapCellNumber: {
    ...Typography.subtitle,
    color: QuinckleColors.textPrimary,
  },
  swapCellCap: {
    ...Typography.micro,
    color: QuinckleColors.textMuted,
  },
  confirmBtn: {
    backgroundColor: QuinckleColors.primary,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.lg,
    alignItems: 'center',
    marginHorizontal: Spacing.xl,
    marginTop: Spacing.sm,
    marginBottom: Spacing.md,
  },
  confirmText: {
    ...Typography.bodyStrong,
    color: '#fff',
  },
});
