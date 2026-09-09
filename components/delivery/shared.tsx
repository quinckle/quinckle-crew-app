/**
 * What the counter board and the rider view must agree on.
 *
 * There are two delivery surfaces now (DELIVERY_V2_PLAN §4) and they answer
 * the same questions differently only in LAYOUT. "Is this paid?", "is the cash
 * still on the rider?", "what has the kitchen finished?" are money questions,
 * and two copies of a money question drift — one gets a fix, the other keeps
 * quietly telling somebody the wrong number. So they live here once.
 *
 * Styling deliberately does NOT live here beyond the two chips below: the
 * counter needs a dense board and a rider needs an address they can read at
 * arm's length on a bike. Those are supposed to differ.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { DeliveryOrder, DeliveryStatus } from '../../services/api';
import { QuinckleColors, Radius, Spacing, Typography } from '../../constants/Colors';

// ── Presentation for each lifecycle state ────────────────────────────────────
export const STATUS_META: Record<DeliveryStatus, { label: string; color: string; soft: string; border: string }> = {
  NEW:       { label: 'New',        color: QuinckleColors.warning, soft: QuinckleColors.warningSoft, border: QuinckleColors.warningBorder },
  OUT:       { label: 'On the way', color: QuinckleColors.info,    soft: QuinckleColors.infoSoft,    border: QuinckleColors.infoBorder },
  DELIVERED: { label: 'Delivered',  color: QuinckleColors.primary, soft: QuinckleColors.primarySoft, border: QuinckleColors.primarySoftBorder },
  CLOSED:    { label: 'Done',       color: QuinckleColors.success, soft: QuinckleColors.successSoft, border: QuinckleColors.successBorder },
  FAILED:    { label: 'Failed',     color: QuinckleColors.danger,  soft: QuinckleColors.dangerSoft,  border: QuinckleColors.dangerBorder },
  CANCELLED: { label: 'Cancelled',  color: QuinckleColors.textTertiary, soft: QuinckleColors.surfaceMuted, border: QuinckleColors.border },
};

export const money = (n: number | null | undefined) =>
  `₹${Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export function timeAgo(iso: string | null): string {
  if (!iso) return '';
  const mins = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return hrs < 24 ? `${hrs}h ago` : `${Math.floor(hrs / 24)}d ago`;
}

export const oneLineAddress = (d: DeliveryOrder) =>
  [d.address.house_no, d.address.line, d.address.landmark].filter(Boolean).join(', ');

/** Delivered, but the rider still has the money — the venue is not done with it. */
export const cashStillOut = (o: DeliveryOrder) =>
  o.status === 'DELIVERED' && !!o.cod_amount && !o.cod_settled_at;

/** On the board because somebody still has to do something about it. */
export const isLive = (o: DeliveryOrder) => o.status === 'NEW' || o.status === 'OUT';

export const isPaid = (o: DeliveryOrder) => o.payment_status === 'PAID';

/**
 * Kitchen progress for a card, or null when there is nothing honest to say.
 *
 * Stage 1 has no tap of its own — instead of the counter declaring ACCEPTED
 * and then READY, it reads what the kitchen has actually finished (V2 §2). An
 * older backend sends no `prep` at all, so absence renders nothing rather than
 * an alarming "0/5".
 */
export const prepOf = (o: DeliveryOrder) => {
  const p = o.prep;
  if (!p || !p.total) return null;
  return { ...p, done: p.ready >= p.total };
};

/**
 * Where the rider is being sent.
 *
 * Coordinates when the diner dropped a pin (exact), otherwise the typed
 * address a phone order carries. A deep link to the real Maps app buys live
 * traffic, voice nav and offline maps for free — and ships OTA, because there
 * is no native map dependency to build.
 */
export const directionsUrl = (o: DeliveryOrder) => {
  const { latitude, longitude } = o.address;
  const dest = latitude != null && longitude != null
    ? `${latitude},${longitude}`
    : encodeURIComponent(oneLineAddress(o));
  return `https://www.google.com/maps/dir/?api=1&destination=${dest}`;
};

/**
 * "3/5 ready" — what the kitchen has done, on the card that decides whether a
 * bag can be packed. Only meaningful before the food leaves.
 */
export function PrepChip({ prep }: { prep: { ready: number; total: number; done: boolean } }) {
  return (
    <View style={[
      s.pill,
      s.pillIcon,
      prep.done
        ? { backgroundColor: QuinckleColors.successSoft, borderColor: QuinckleColors.successBorder }
        : { backgroundColor: QuinckleColors.infoSoft, borderColor: QuinckleColors.infoBorder },
    ]}>
      <Ionicons
        name={prep.done ? 'checkmark-circle' : 'flame-outline'}
        size={11}
        color={prep.done ? QuinckleColors.success : QuinckleColors.info}
      />
      <Text style={[s.pillText, { color: prep.done ? QuinckleColors.success : QuinckleColors.info }]}>
        {prep.done ? 'All ready' : `${prep.ready}/${prep.total} ready`}
      </Text>
    </View>
  );
}

/** Same medallion + two lines as every other empty tab on the dashboard. */
export function EmptyState({ icon, title, body }: { icon: any; title: string; body: string }) {
  return (
    <View style={s.emptyWrap}>
      <View style={s.emptyMedallion}>
        <Ionicons name={icon} size={28} color={QuinckleColors.textTertiary} />
      </View>
      <Text style={s.emptyTitle}>{title}</Text>
      <Text style={s.emptyBody}>{body}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  pill: { paddingHorizontal: Spacing.sm, paddingVertical: 2, borderRadius: Radius.pill, borderWidth: 1 },
  pillIcon: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pillText: { ...Typography.micro, fontWeight: '700' },
  emptyWrap: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: Spacing.xxl, paddingHorizontal: Spacing.xl,
  },
  emptyMedallion: {
    width: 64, height: 64, borderRadius: 32,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: QuinckleColors.surfaceMuted,
  },
  emptyTitle: { ...Typography.subtitle, color: QuinckleColors.textSecondary, marginTop: Spacing.md },
  emptyBody: { ...Typography.caption, color: QuinckleColors.textTertiary, textAlign: 'center', marginTop: Spacing.xs },
});
