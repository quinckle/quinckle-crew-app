/**
 * GroupPickerSheet — bottom sheet + freeing hub for shared-seating tables.
 *
 * Shown when a table hosts (or can host) more than one party. From here crew can:
 *   - tap a group card         → open that group's bill
 *   - swipe a group card left  → Free just that party (with Undo)
 *   - "Free whole table"       → clear every party at once (with Undo)
 *   - "Seat new group"         → start a separate walk-in party
 *
 * Freeing is optimistic + reversible (an Undo snackbar owns the reversal), so
 * these actions don't gate behind a confirm dialog. Matches the SwapTableSheet /
 * MergeTableSheet design language.
 */

import React, { useRef } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
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
  /** Free a single party (swipe-left action on its card). */
  onFreeGroup: (group: PickerGroup) => void;
  /** Free every party on the table at once. */
  onFreeTable: () => void;
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
  onFreeGroup,
  onFreeTable,
}: Props) {
  // Track open Swipeables so freeing one auto-closes its row (it's leaving the
  // list anyway, but this avoids a flash of the red action on the outgoing card).
  const rowRefs = useRef<Record<string, Swipeable | null>>({});
  const multi = groups.length > 1;

  return (
    <BottomSheet visible={visible} onClose={onClose} title={`Table T${tableNum}`}>
      <Text style={styles.sub}>
        {multi
          ? `${groups.length} groups sharing this table · swipe a group to free it`
          : 'One group at this table'}
      </Text>

      <View style={styles.list}>
        {groups.map((g) => {
          const unpaid = !g.payment_settled && (Number(g.bill_total) || 0) > 0;
          return (
            <Swipeable
              key={g.session_id}
              ref={(r) => { rowRefs.current[g.session_id] = r; }}
              friction={2}
              rightThreshold={40}
              overshootRight={false}
              enabled={!submitting}
              renderRightActions={() => (
                <View style={styles.freeAction}>
                  <Ionicons name="exit-outline" size={18} color="#fff" />
                  <Text style={styles.freeActionText}>Free</Text>
                </View>
              )}
              onSwipeableOpen={() => {
                rowRefs.current[g.session_id]?.close();
                onFreeGroup(g);
              }}
            >
              <TouchableOpacity
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
                  ) : unpaid ? (
                    <Text style={styles.unpaidHint}>unpaid</Text>
                  ) : (
                    <Ionicons name="chevron-forward" size={14} color={QuinckleColors.textTertiary} />
                  )}
                </View>
              </TouchableOpacity>
            </Swipeable>
          );
        })}

        {multi && (
          <TouchableOpacity
            style={[styles.freeTableBtn, submitting && { opacity: 0.5 }]}
            onPress={onFreeTable}
            disabled={submitting}
            activeOpacity={0.8}
          >
            <Ionicons name="exit-outline" size={16} color={QuinckleColors.danger} />
            <View style={{ flex: 1 }}>
              <Text style={styles.freeTableTitle}>Free whole table</Text>
              <Text style={styles.freeTableMeta}>Clears all {groups.length} groups · uncollected moves to Outstanding</Text>
            </View>
          </TouchableOpacity>
        )}

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
  freeAction: {
    backgroundColor: QuinckleColors.danger,
    borderRadius: Radius.lg,
    justifyContent: 'center',
    alignItems: 'center',
    width: 84,
    marginLeft: Spacing.sm,
    gap: 2,
  },
  freeActionText: {
    ...Typography.micro,
    color: '#fff',
    fontWeight: '700',
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
  unpaidHint: {
    ...Typography.micro,
    color: QuinckleColors.warning,
  },
  freeTableBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: QuinckleColors.dangerBorder,
    backgroundColor: QuinckleColors.dangerSoft,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
  },
  freeTableTitle: {
    ...Typography.bodyStrong,
    color: QuinckleColors.danger,
  },
  freeTableMeta: {
    ...Typography.micro,
    color: QuinckleColors.textMuted,
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
