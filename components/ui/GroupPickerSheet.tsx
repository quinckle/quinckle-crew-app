/**
 * GroupPickerSheet — bottom sheet for shared-seating tables.
 *
 * Shown when a table hosts (or can host) more than one party. One tap on a
 * group card opens that group's bill; the outlined action at the bottom seats
 * a separate walk-in party with its own bill. Matches the SwapTableSheet /
 * MergeTableSheet design language: spring BottomSheet, dark cards, orange
 * accents.
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheet } from './BottomSheet';
import { QuinckleColors, Radius, Spacing, Typography } from '../../constants/Colors';

export interface PickerGroup {
  session_id: string;
  party_slot: number;
  label: string;
  occupied_since?: string | null;
  customer_name?: string | null;
  bill_total?: number;
  items_total?: number;
  payment_settled?: boolean;
}

interface Props {
  visible: boolean;
  /** Display number, e.g. "06". */
  tableNum: string;
  groups: PickerGroup[];
  /** Show the "seat new group" action (toggle on + under the party cap). */
  canAddParty: boolean;
  /** Disables all actions while a new party is being created. */
  submitting?: boolean;
  onClose: () => void;
  onOpenGroup: (group: PickerGroup) => void;
  onSeatNewGroup: () => void;
}

function timeOf(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function GroupPickerSheet({
  visible,
  tableNum,
  groups,
  canAddParty,
  submitting = false,
  onClose,
  onOpenGroup,
  onSeatNewGroup,
}: Props) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title={`Table T${tableNum}`}>
      <Text style={styles.sub}>
        {groups.length > 1
          ? `${groups.length} groups are sharing this table`
          : 'One group at this table'}
      </Text>

      <View style={styles.list}>
        {groups.map((g) => (
          <TouchableOpacity
            key={g.session_id}
            style={styles.card}
            onPress={() => onOpenGroup(g)}
            disabled={submitting}
            activeOpacity={0.75}
          >
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{g.label}</Text>
            </View>

            <View style={styles.cardBody}>
              <Text style={styles.cardTitle} numberOfLines={1}>
                {g.customer_name?.trim() || `Group ${g.party_slot}`}
              </Text>
              <Text style={styles.cardMeta} numberOfLines={1}>
                {g.occupied_since ? `since ${timeOf(g.occupied_since)}` : 'active'}
                {typeof g.items_total === 'number' && g.items_total > 0
                  ? `  ·  ${g.items_total} item${g.items_total === 1 ? '' : 's'}`
                  : ''}
              </Text>
            </View>

            <View style={styles.cardRight}>
              <Text style={styles.cardAmount}>₹{Math.round(Number(g.bill_total) || 0).toLocaleString()}</Text>
              {g.payment_settled ? (
                <View style={styles.paidChip}>
                  <Text style={styles.paidChipText}>Paid</Text>
                </View>
              ) : (
                <Ionicons name="chevron-forward" size={14} color={QuinckleColors.textTertiary} />
              )}
            </View>
          </TouchableOpacity>
        ))}

        {canAddParty && (
          <TouchableOpacity
            style={[styles.addBtn, submitting && { opacity: 0.5 }]}
            onPress={onSeatNewGroup}
            disabled={submitting}
            activeOpacity={0.8}
          >
            <Ionicons name="person-add-outline" size={16} color={QuinckleColors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.addTitle}>{submitting ? 'Seating…' : 'Seat new group'}</Text>
              <Text style={styles.addMeta}>Separate order and bill for a different party</Text>
            </View>
          </TouchableOpacity>
        )}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sub: {
    ...Typography.caption,
    color: QuinckleColors.textMuted,
    paddingHorizontal: Spacing.xl,
    marginBottom: Spacing.lg,
  },
  list: {
    paddingHorizontal: Spacing.xl,
    marginBottom: Spacing.xl,
    gap: Spacing.sm,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: QuinckleColors.surfaceElevated,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  badge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: QuinckleColors.primarySoft,
    borderWidth: 1,
    borderColor: QuinckleColors.primarySoftBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    ...Typography.caption,
    fontWeight: '700',
    color: QuinckleColors.primary,
  },
  cardBody: {
    flex: 1,
    gap: 2,
  },
  cardTitle: {
    ...Typography.bodyStrong,
    color: QuinckleColors.textPrimary,
  },
  cardMeta: {
    ...Typography.micro,
    color: QuinckleColors.textMuted,
  },
  cardRight: {
    alignItems: 'flex-end',
    gap: 4,
  },
  cardAmount: {
    ...Typography.bodyStrong,
    color: QuinckleColors.textPrimary,
  },
  paidChip: {
    backgroundColor: QuinckleColors.successSoft,
    borderWidth: 1,
    borderColor: QuinckleColors.successBorder,
    borderRadius: Radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  paidChipText: {
    ...Typography.micro,
    color: QuinckleColors.success,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: QuinckleColors.primarySoftBorder,
    borderStyle: 'dashed',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    marginTop: Spacing.xs,
  },
  addTitle: {
    ...Typography.bodyStrong,
    color: QuinckleColors.primary,
  },
  addMeta: {
    ...Typography.micro,
    color: QuinckleColors.textMuted,
  },
});
