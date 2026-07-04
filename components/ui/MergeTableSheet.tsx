/**
 * MergeTableSheet — bottom sheet for merging this table's bill into another
 * OCCUPIED table, producing one unified check.
 *
 * Mirrors SwapTableSheet, with two deliberate differences:
 *   - The target grid shows OCCUPIED tables (swap shows AVAILABLE ones) — you
 *     merge into a table that already has a running session.
 *   - The current table is the one that gets absorbed + freed; the selected
 *     target survives and keeps its bill ref.
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

function MergeGrid({ children }: { children: React.ReactNode }) {
  const items = React.Children.toArray(children);
  const rows: React.ReactNode[][] = [];
  for (let i = 0; i < items.length; i += 3) rows.push(items.slice(i, i + 3));
  return (
    <View style={styles.grid}>
      {rows.map((row, ri) => (
        <View key={ri} style={styles.row}>
          {row}
          {row.length < 3 && Array.from({ length: 3 - row.length }).map((_, pi) => (
            <View key={pi} style={styles.cellGhost} />
          ))}
        </View>
      ))}
    </View>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  visible: boolean;
  /** DB id of the table being merged away (excluded from targets). */
  currentTableDbId: string;
  /** Display number e.g. "05" — shown in the sheet subtitle. */
  currentTableNum: string;
  onClose: () => void;
  /** Selected target is the surviving primary that keeps the unified bill. */
  onMerge: (result: { targetId: string; targetNumber: number }) => void;
  /** Whether a merge is in-flight (shows spinner text on confirm button). */
  submitting?: boolean;
}

export function MergeTableSheet({
  visible,
  currentTableDbId,
  currentTableNum,
  onClose,
  onMerge,
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
        // Only occupied tables can receive a merge — they have a live session.
        setTables(raw.filter(t => t.status === 'occupied'));
      })
      .catch(() => setTables([]))
      .finally(() => setLoading(false));
  }, [visible]);

  const targets = tables.filter(t => t.table_id !== currentTableDbId);

  const handleConfirm = () => {
    if (!selected) return;
    const t = targets.find(x => x.table_id === selected);
    if (t) onMerge({ targetId: t.table_id, targetNumber: t.table_number });
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Merge bill">
      <Text style={styles.sub}>
        Merge T{currentTableNum} into another table — orders + any collected
        payment join that table's bill, and T{currentTableNum} is freed.
      </Text>

      {loading ? (
        <MergeGrid>
          {Array.from({ length: 9 }).map((_, i) => (
            <View key={i} style={styles.cell}>
              <Skeleton width={36} height={18} radius={6} style={{ marginBottom: 4 }} />
              <Skeleton width={44} height={11} radius={4} />
            </View>
          ))}
        </MergeGrid>
      ) : targets.length === 0 ? (
        <Text style={styles.empty}>No other occupied tables to merge into</Text>
      ) : (
        <MergeGrid>
          {targets.map(t => (
            <TouchableOpacity
              key={t.table_id}
              style={[styles.cell, selected === t.table_id && styles.cellActive]}
              onPress={() => setSelected(t.table_id)}
              activeOpacity={0.75}
            >
              <Text style={[styles.cellNumber, selected === t.table_id && { color: QuinckleColors.primary }]}>
                T{String(t.table_number).padStart(2, '0')}
              </Text>
              <Text style={styles.cellCap}>
                {t.bill_total != null ? `₹${Math.round(t.bill_total)}` : `${t.capacity} seats`}
              </Text>
            </TouchableOpacity>
          ))}
        </MergeGrid>
      )}

      <TouchableOpacity
        style={[styles.confirmBtn, (!selected || submitting) && { opacity: 0.4 }]}
        disabled={!selected || submitting}
        onPress={handleConfirm}
        activeOpacity={0.85}
      >
        <Text style={styles.confirmText}>
          {submitting ? 'Merging…' : 'Merge bills'}
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
  grid: {
    paddingHorizontal: Spacing.xl,
    marginBottom: Spacing.lg,
    gap: Spacing.sm,
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  cell: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: Radius.lg,
    backgroundColor: QuinckleColors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  cellGhost: {
    flex: 1,
    aspectRatio: 1,
  },
  cellActive: {
    backgroundColor: QuinckleColors.primarySoft,
    borderWidth: 1.5,
    borderColor: QuinckleColors.primary,
  },
  cellNumber: {
    ...Typography.subtitle,
    color: QuinckleColors.textPrimary,
  },
  cellCap: {
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
