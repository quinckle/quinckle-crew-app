/**
 * Menu Activity building blocks shared by the preview card (Manage menu tab,
 * item and combo editors) and the full Menu Activity screen: the tab list,
 * chips, and how one log row reads.
 */

import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { QuinckleColors, Radius, Spacing, Typography } from '@/constants/Colors';
import type { MenuActivityEntity, MenuActivityKind, MenuChange } from '@/services/menuAdmin';

export const KIND_TABS: { key: MenuActivityKind | null; label: string }[] = [
  { key: null, label: 'All' },
  { key: 'ADDED', label: 'Added' },
  { key: 'PRICE', label: 'Price' },
  { key: 'IMAGE', label: 'Photo' },
  { key: 'CATEGORY', label: 'Category' },
  { key: 'GST', label: 'GST' },
  { key: 'CHANNELS', label: 'Channels' },
  { key: 'AVAILABILITY', label: 'Availability' },
  { key: 'DETAILS', label: 'Details' },
  { key: 'REMOVED', label: 'Removed' },
  { key: 'AUTOMATIC', label: 'Automatic' },
];

export const ENTITY_TABS: { key: MenuActivityEntity | null; label: string }[] = [
  { key: null, label: 'Everything' },
  { key: 'ITEM', label: 'Items' },
  { key: 'COMBO', label: 'Combos' },
  { key: 'ADDON', label: 'Add-ons' },
];

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
  stockOut: 'Out of stock',
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
const PERCENT_FIELDS = new Set(['taxRatePercent']);

const CHANNEL_LABELS: Record<string, string> = {
  DINE_IN: 'Dine-in',
  TAKEAWAY: 'Takeaway',
  DELIVERY: 'Delivery',
  QR: 'QR',
};

/** Why the system changed something — set by the server on automatic rows. */
const REASON_HEADLINES: Record<string, string> = {
  STOCK_OUT: 'Turned off — a stock material ran out',
  STOCK_BACK: 'Back on — stock came back',
  OFF_TIMER_ENDED: 'Back on — temporary off ended',
  COMBO_FULLY_CLAIMED: 'Turned off — fully claimed',
};

const KIND_HEADLINES: Record<MenuActivityKind, string> = {
  ADDED: 'Added',
  PRICE: 'Price changed',
  IMAGE: 'Photo changed',
  CATEGORY: 'Category changed',
  GST: 'GST changed',
  CHANNELS: 'Channels changed',
  AVAILABILITY: 'Availability changed',
  DETAILS: 'Details edited',
  REMOVED: 'Removed',
  AUTOMATIC: 'Automatic change',
};

const ENTITY_NOUNS: Record<MenuChange['entityType'], string> = {
  ITEM: 'Item',
  COMBO: 'Combo',
  CATEGORY: 'Category',
  MODIFIER_GROUP: 'Add-on group',
  MODIFIER_OPTION: 'Add-on',
  HIGHLIGHT: 'Highlighted',
};

type FieldChange = { field: string; from: unknown; to: unknown; reason?: string };

function formatValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (field === 'imageUrl') return 'photo';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (MONEY_FIELDS.has(field) && typeof value === 'number') return `₹${value}`;
  if (PERCENT_FIELDS.has(field) && typeof value === 'number') return `${value}%`;
  if (Array.isArray(value)) {
    if (!value.length) return '—';
    return value.map((v) => (typeof v === 'object' ? '…' : CHANNEL_LABELS[String(v)] ?? String(v))).join(', ');
  }
  if (typeof value === 'object') return '…';
  if (field === 'validFrom' || field === 'validUntil' || field === 'unavailableUntil') {
    const d = new Date(String(value));
    if (!Number.isNaN(d.getTime())) return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  }
  return String(value);
}

export function when(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function day(iso: string | Date): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fieldChanges(row: MenuChange): FieldChange[] {
  return Array.isArray(row.changes) ? (row.changes as FieldChange[]) : [];
}

function fieldLines(row: MenuChange): { label: string; from: string; to: string; delta?: number }[] {
  return fieldChanges(row).map((c) => {
    const delta =
      MONEY_FIELDS.has(c.field) && typeof c.from === 'number' && typeof c.to === 'number' ? c.to - c.from : undefined;
    return {
      label: FIELD_LABELS[c.field] ?? c.field,
      from: c.field === 'imageUrl' ? (c.from ? 'photo' : 'none') : formatValue(c.field, c.from),
      to: c.field === 'imageUrl' ? (c.to ? 'new photo' : 'removed') : formatValue(c.field, c.to),
      delta,
    };
  });
}

/** Key facts of a dish when it was added or removed: price, category, GST, channels. */
function snapshotLine(row: MenuChange): string | null {
  if ((row.action !== 'CREATED' && row.action !== 'DELETED') || !row.changes || Array.isArray(row.changes)) return null;
  const s = row.changes as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof s.price === 'number') parts.push(`₹${s.price}`);
  if (typeof s.category === 'string' && s.category) parts.push(s.category);
  if (typeof s.taxRatePercent === 'number') parts.push(`GST ${s.taxRatePercent}%`);
  if (Array.isArray(s.channels) && s.channels.length) parts.push(formatValue('channels', s.channels));
  return parts.length ? parts.join(' · ') : null;
}

function headline(row: MenuChange, activeKind: MenuActivityKind | null): string {
  const reason = fieldChanges(row).find((c) => c.reason)?.reason;
  if (reason && REASON_HEADLINES[reason]) return REASON_HEADLINES[reason];
  if (row.action === 'CREATED') return 'Added';
  if (row.action === 'DELETED') return 'Removed';
  if (row.action === 'REORDERED') return 'Reordered';
  if (row.action === 'RENAMED') return 'Renamed';
  if (row.action === 'AVAILABILITY') {
    const avail = fieldChanges(row).find((c) => c.field === 'isAvailable' || c.field === 'isActive');
    if (avail) return avail.to ? 'Turned on' : 'Turned off';
  }
  // On a tab, lead with that tab's meaning; on All, with the first kind.
  const kinds = (row.kinds ?? []).filter((k) => k !== 'AUTOMATIC');
  if (activeKind && activeKind !== 'AUTOMATIC' && kinds.includes(activeKind)) return KIND_HEADLINES[activeKind];
  if (kinds.length === 1) return KIND_HEADLINES[kinds[0]];
  if (kinds.length > 1) return kinds.slice(0, 2).map((k) => KIND_HEADLINES[k].replace(/ (changed|edited)$/, '')).join(' & ') + ' changed';
  return 'Edited';
}

export function actorLabel(a: { actorType: string; actorRole?: string | null }): string {
  if (a.actorType === 'SYSTEM') return 'Automatic';
  if (a.actorType === 'OWNER') return 'Owner';
  return a.actorRole ? `Staff · ${a.actorRole}` : 'Staff';
}

export function ActorBadge({ actorType, actorRole }: { actorType: string; actorRole?: string | null }) {
  const isSystem = actorType === 'SYSTEM';
  const isOwner = actorType === 'OWNER';
  const color = isSystem ? QuinckleColors.textSecondary : isOwner ? QuinckleColors.primary : QuinckleColors.info;
  return (
    <View style={[styles.badge, isSystem ? styles.badgeSystem : isOwner ? styles.badgeOwner : styles.badgeStaff]}>
      <Text style={[styles.badgeText, { color }]}>{actorLabel({ actorType, actorRole })}</Text>
    </View>
  );
}

export function Chips<T extends string | null>({
  tabs,
  value,
  onChange,
  small = false,
}: {
  tabs: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  small?: boolean;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {tabs.map((t) => {
        const on = t.key === value;
        return (
          <TouchableOpacity
            key={t.label}
            onPress={() => onChange(t.key)}
            activeOpacity={0.8}
            style={[styles.chip, small && styles.chipSmall, on && styles.chipOn]}
          >
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{t.label}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

/** One log row. `showEntity` names the item/combo (whole-menu views). */
export function ActivityRow({
  row,
  activeKind = null,
  showEntity = false,
  first = false,
}: {
  row: MenuChange;
  activeKind?: MenuActivityKind | null;
  showEntity?: boolean;
  first?: boolean;
}) {
  const lines = fieldLines(row);
  const snap = snapshotLine(row);
  const isSystem = row.actorType === 'SYSTEM';
  const nameEntity = showEntity || row.entityType === 'MODIFIER_GROUP' || row.entityType === 'MODIFIER_OPTION';
  return (
    <View style={[styles.row, first && styles.rowFirst]}>
      <View style={styles.rowTop}>
        <Text
          style={[
            styles.headline,
            row.action === 'DELETED' && { color: QuinckleColors.danger },
            row.action === 'CREATED' && { color: QuinckleColors.success },
          ]}
          numberOfLines={1}
        >
          {headline(row, activeKind)}
        </Text>
        <Text style={styles.time} numberOfLines={1}>{when(row.createdAt)}</Text>
      </View>
      {nameEntity && (
        <Text style={styles.entity} numberOfLines={1}>
          {row.entityName}
          <Text style={styles.entityNoun}>  {ENTITY_NOUNS[row.entityType]}</Text>
        </Text>
      )}
      {snap && <Text style={styles.line}>{snap}</Text>}
      {!isSystem &&
        lines.map((l, i) => (
          <Text key={i} style={styles.line}>
            <Text style={styles.lineLabel}>{l.label}: </Text>
            {l.from} <Text style={styles.arrow}>→</Text> {l.to}
            {l.delta ? (
              <Text style={{ color: l.delta > 0 ? QuinckleColors.warning : QuinckleColors.success }}>
                {'  '}
                {l.delta > 0 ? '+' : '−'}₹{Math.abs(l.delta)}
              </Text>
            ) : null}
          </Text>
        ))}
      <View style={styles.byRow}>
        <Text style={styles.by} numberOfLines={1}>
          {isSystem ? 'No one — done automatically' : `by ${row.actorName}`}
        </Text>
        <ActorBadge actorType={row.actorType} actorRole={row.actorRole} />
      </View>
    </View>
  );
}

/** "Added · 3 Feb 2025 · before Menu Activity began" for dishes older than the log. */
export function FirstSeenRow({ createdAt }: { createdAt: string }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.headline, { color: QuinckleColors.success }]}>Added</Text>
      <Text style={styles.line}>{day(createdAt)} · before Menu Activity began, so who added it is not known</Text>
    </View>
  );
}

export const activityStyles = StyleSheet.create({
  empty: { ...Typography.caption, color: QuinckleColors.textMuted, paddingVertical: Spacing.md, textAlign: 'center' },
  error: { ...Typography.caption, color: QuinckleColors.danger, paddingVertical: Spacing.sm, textAlign: 'center' },
});

const styles = StyleSheet.create({
  chips: { gap: 6, paddingBottom: Spacing.sm },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
  },
  chipSmall: { paddingHorizontal: 10, paddingVertical: 4 },
  chipOn: { borderColor: QuinckleColors.primarySoftBorder, backgroundColor: QuinckleColors.primarySoft },
  chipText: { ...Typography.caption, color: QuinckleColors.textSecondary },
  chipTextOn: { color: QuinckleColors.primary, fontWeight: '600' },
  row: {
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: QuinckleColors.borderSubtle,
  },
  rowFirst: { borderTopWidth: 0 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headline: { ...Typography.bodyStrong, color: QuinckleColors.textPrimary, flexShrink: 1 },
  time: { ...Typography.caption, color: QuinckleColors.textMuted, marginLeft: 'auto', flexShrink: 0 },
  entity: { ...Typography.body, color: QuinckleColors.textPrimary, marginTop: 2 },
  entityNoun: { ...Typography.micro, color: QuinckleColors.textMuted },
  line: { ...Typography.caption, color: QuinckleColors.textPrimary, marginTop: 2 },
  lineLabel: { color: QuinckleColors.textMuted },
  arrow: { color: QuinckleColors.textMuted },
  byRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  by: { ...Typography.caption, color: QuinckleColors.textSecondary, flexShrink: 1 },
  badge: { borderRadius: Radius.pill, paddingHorizontal: 7, paddingVertical: 1, borderWidth: 1 },
  badgeOwner: { borderColor: QuinckleColors.primarySoftBorder, backgroundColor: QuinckleColors.primarySoft },
  badgeStaff: { borderColor: QuinckleColors.infoBorder, backgroundColor: QuinckleColors.infoSoft },
  badgeSystem: { borderColor: QuinckleColors.border, backgroundColor: 'transparent' },
  badgeText: { ...Typography.micro },
});
