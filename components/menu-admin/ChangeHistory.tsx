/**
 * "Who changed this?" — the menu change log for one item or combo.
 *
 * Every edit lands here whoever made it: the owner from the partner app or the
 * web dashboard, or a staffer from this app. The owner/staff badge and the name
 * come from the server, never from this device.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { QuinckleColors, Radius, Spacing, Typography } from '@/constants/Colors';
import { adminHistory, type MenuChange } from '@/services/menuAdmin';

const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  title: 'Name',
  description: 'Description',
  price: 'Price',
  originalPrice: 'Compare-at price',
  takeawayPrice: 'Takeaway price',
  category: 'Category',
  isVeg: 'Veg',
  spiceLevel: 'Spice',
  imageUrl: 'Photo',
  channels: 'Sold on',
  taxRatePercent: 'GST rate',
  taxCategory: 'Tax category',
  hsnSac: 'HSN/SAC',
  scheduleEnabled: 'Schedule',
  availabilityWindows: 'Time windows',
  scheduleChannels: 'Schedule applies to',
  validFrom: 'Starts',
  validUntil: 'Ends',
  blackoutDates: 'Blackout dates',
  lastOrderCutoffMin: 'Last-order cutoff',
  clipToVenueHours: 'Only during opening hours',
  hideWhenUnavailable: 'Hide when unavailable',
  dailyQtyCap: 'Daily limit',
  isAvailable: 'Available',
  unavailableUntil: 'Back at',
  tag: 'Tag',
  items: 'Items',
  isActive: 'Active',
  availableDays: 'Days',
  windowStartMinute: 'Window start',
  windowEndMinute: 'Window end',
  dailyCap: 'Daily cap',
  dailyCapMode: 'Daily cap counts',
  lifetimeCap: 'Lifetime cap',
  minSelections: 'Min picks',
  maxSelections: 'Max picks',
  hasImages: 'Option photos',
  priceAdjustment: 'Price change',
  isDefault: 'Default',
};

const MONEY_FIELDS = new Set(['price', 'originalPrice', 'takeawayPrice', 'priceAdjustment']);

const ACTION_LABELS: Record<string, string> = {
  CREATED: 'Added',
  UPDATED: 'Edited',
  DELETED: 'Deleted',
  AVAILABILITY: 'Availability',
  REORDERED: 'Reordered',
  RENAMED: 'Renamed',
};

function formatValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'imageUrl') return 'photo';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (MONEY_FIELDS.has(field) && typeof value === 'number') return `₹${value}`;
  if (Array.isArray(value)) return value.length ? value.map((v) => (typeof v === 'object' ? '…' : String(v))).join(', ') : '—';
  if (typeof value === 'object') return '…';
  if (field === 'validFrom' || field === 'validUntil' || field === 'unavailableUntil') {
    const d = new Date(String(value));
    if (!Number.isNaN(d.getTime())) return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  }
  return String(value);
}

function when(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

/** One line per changed field, for UPDATED / AVAILABILITY / RENAMED rows. */
function fieldLines(change: MenuChange): { label: string; from: string; to: string }[] {
  if (!Array.isArray(change.changes)) return [];
  return (change.changes as { field: string; from: unknown; to: unknown }[]).map((c) => ({
    label: FIELD_LABELS[c.field] ?? c.field,
    from: c.field === 'imageUrl' ? (c.from ? 'photo' : 'none') : formatValue(c.field, c.from),
    to: c.field === 'imageUrl' ? (c.to ? 'new photo' : 'removed') : formatValue(c.field, c.to),
  }));
}

export function ChangeHistory({
  filter,
  showEntity = false,
}: {
  filter: { itemId?: string; comboId?: string };
  /** Whole-menu feed: name the item/combo on every row, not just modifiers. */
  showEntity?: boolean;
}) {
  const [rows, setRows] = useState<MenuChange[]>([]);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { itemId, comboId } = filter;
  const load = useCallback(async (before: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const res = await adminHistory.list({ itemId, comboId, before });
      setRows((prev) => (before ? [...prev, ...res.data] : res.data));
      setNextBefore(res.nextBefore);
    } catch (e: any) {
      setError(e?.message ?? 'Could not load history');
    } finally {
      setLoading(false);
    }
  }, [itemId, comboId]);

  useEffect(() => { void load(null); }, [load]);

  return (
    <View style={styles.wrap}>
      <View style={styles.headRow}>
        <Ionicons name="time-outline" size={16} color={QuinckleColors.textSecondary} />
        <Text style={styles.heading}>Change history</Text>
      </View>

      {rows.length === 0 && !loading && !error && (
        <Text style={styles.empty}>No changes recorded yet.</Text>
      )}
      {error && (
        <TouchableOpacity onPress={() => load(null)} activeOpacity={0.7}>
          <Text style={styles.error}>{error} · Tap to retry</Text>
        </TouchableOpacity>
      )}

      {rows.map((row) => {
        const lines = fieldLines(row);
        const isOwner = row.actorType === 'OWNER';
        return (
          <View key={row.id} style={styles.row}>
            <View style={styles.rowTop}>
              <Text style={styles.actor} numberOfLines={1}>{row.actorName}</Text>
              <View style={[styles.badge, isOwner ? styles.badgeOwner : styles.badgeStaff]}>
                <Text style={[styles.badgeText, { color: isOwner ? QuinckleColors.primary : QuinckleColors.info }]}>
                  {isOwner ? 'Owner' : row.actorRole ? `Staff · ${row.actorRole}` : 'Staff'}
                </Text>
              </View>
              <Text style={styles.time}>{when(row.createdAt)}</Text>
            </View>
            <Text style={[styles.action, row.action === 'DELETED' && { color: QuinckleColors.danger }]}>
              {ACTION_LABELS[row.action] ?? row.action}
              {showEntity || row.entityType === 'MODIFIER_GROUP' || row.entityType === 'MODIFIER_OPTION' ? ` · ${row.entityName}` : ''}
            </Text>
            {lines.map((l, i) => (
              <Text key={i} style={styles.line}>
                <Text style={styles.lineLabel}>{l.label}: </Text>
                {l.from} <Text style={styles.arrow}>→</Text> {l.to}
              </Text>
            ))}
          </View>
        );
      })}

      {loading && <ActivityIndicator style={{ marginVertical: Spacing.sm }} color={QuinckleColors.primary} />}
      {!loading && nextBefore && (
        <TouchableOpacity style={styles.more} onPress={() => load(nextBefore)} activeOpacity={0.7}>
          <Text style={styles.moreText}>Show older changes</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: Spacing.lg,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    backgroundColor: QuinckleColors.surface,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: Spacing.sm },
  heading: { ...Typography.bodyStrong, color: QuinckleColors.textPrimary },
  empty: { ...Typography.caption, color: QuinckleColors.textMuted },
  error: { ...Typography.caption, color: QuinckleColors.danger },
  row: {
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: QuinckleColors.borderSubtle,
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actor: { ...Typography.bodyStrong, color: QuinckleColors.textPrimary, flexShrink: 1 },
  badge: { borderRadius: Radius.pill, paddingHorizontal: 7, paddingVertical: 1, borderWidth: 1 },
  badgeOwner: { borderColor: QuinckleColors.primarySoftBorder, backgroundColor: QuinckleColors.primarySoft },
  badgeStaff: { borderColor: QuinckleColors.infoBorder, backgroundColor: QuinckleColors.infoSoft },
  badgeText: { ...Typography.micro },
  time: { ...Typography.caption, color: QuinckleColors.textMuted, marginLeft: 'auto' },
  action: { ...Typography.caption, color: QuinckleColors.textSecondary, marginTop: 2 },
  line: { ...Typography.caption, color: QuinckleColors.textPrimary, marginTop: 2 },
  lineLabel: { color: QuinckleColors.textMuted },
  arrow: { color: QuinckleColors.textMuted },
  more: { alignItems: 'center', paddingTop: Spacing.sm },
  moreText: { ...Typography.caption, color: QuinckleColors.primary },
});
