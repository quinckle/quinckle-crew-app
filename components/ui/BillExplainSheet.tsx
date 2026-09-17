/**
 * BillExplainSheet — the whole bill, explained the way the diner's bill and the
 * printed receipt explain it: items, each discount tagged with where it came
 * from (loyalty / membership / offer / staff), the partner's own charge names,
 * taxable value, CGST and SGST per rate, tip, round off, total.
 *
 * One component for every place the crew app opens "the breakdown" — the table
 * screen's total bar and the Collect Payment screen — so a steward never sees
 * two different explanations of the same bill.
 *
 * Nothing here computes money. Every figure comes from the backend's bill; the
 * only arithmetic is presentational (summing tax lines for the taxable-value
 * row). An older backend without tax_lines / discount_lines gets the flat
 * figures instead of invented splits.
 */

import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { BottomSheet } from './BottomSheet';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';
import type { BillBreakdown, SessionBill } from '../../services/api';

export type DiscountKind = 'LOYALTY' | 'MEMBERSHIP' | 'OFFER' | 'STAFF' | 'OTHER' | string;

export interface ExplainedBill {
  items: { key: string; name: string; modifiersSummary?: string | null; price: number }[];
  subtotal: number;
  discountTotal: number;
  discountLines: { kind: DiscountKind; name: string; amount: number }[];
  chargesTotal: number;
  chargeLines: { id: string; name: string; amount: number }[];
  taxTotal: number;
  taxRate: number;
  taxLines: { rate: number; taxableValue: number; cgst: number; sgst: number; amount: number }[];
  tip: number;
  roundOff: number;
  total: number;
}

/**
 * From the session bill — the same normalisation the table screen has always
 * applied (canonical `breakdown` first, legacy flat fields second, a discount
 * inferred from the total only when none is reported).
 */
export function explainSessionBill(bill: SessionBill): ExplainedBill {
  const bd = bill.breakdown;
  const rate = bd?.taxRate ?? bill.tax_rate ?? 0;
  const subtotal = bd?.subtotal ?? bill.session_total;
  const tax = bd?.taxAmount ?? bill.tax_total ?? subtotal * (rate / 100);
  const charges = bd?.chargesTotal ?? bill.service_charge_total ?? 0;
  const tip = bd?.tip ?? bill.tip_total ?? 0;
  const roundOff = bd?.roundOff ?? bill.round_off ?? 0;
  const explicitDisc = bd?.discount ?? bill.discount_total ?? 0;
  const explicitTotal = bd?.total ?? bill.total_payable;
  const discount = explicitDisc > 0 || explicitTotal == null
    ? explicitDisc
    : Math.max(0, Math.round((subtotal + tax + charges + tip + roundOff - explicitTotal) * 100) / 100);
  const total = explicitTotal ?? subtotal + tax + charges + tip - discount + roundOff;
  return {
    items: (bill.orders ?? []).flatMap((o) =>
      o.items
        .filter((i) => i.item_status !== 'cancelled')
        .map((i) => ({
          key: `${o.order_id}:${i.item_id}`,
          name: `${i.qty}× ${i.name}`,
          modifiersSummary: i.modifiers_summary,
          price: i.price * i.qty,
        })),
    ),
    subtotal,
    discountTotal: discount,
    discountLines: bill.discount_lines ?? [],
    chargesTotal: charges,
    chargeLines: bill.charge_lines ?? [],
    taxTotal: tax,
    taxRate: rate,
    taxLines: bill.tax_lines ?? [],
    tip,
    roundOff,
    total,
  };
}

/** From the bare breakdown a navigation param carries — no items, no named lines. */
export function explainBreakdown(bd: BillBreakdown): ExplainedBill {
  return {
    items: [],
    subtotal: bd.subtotal,
    discountTotal: bd.discount,
    discountLines: [],
    chargesTotal: bd.chargesTotal,
    chargeLines: [],
    taxTotal: bd.taxAmount,
    taxRate: bd.taxRate,
    taxLines: [],
    tip: bd.tip,
    roundOff: bd.roundOff ?? 0,
    total: bd.total,
  };
}

// ── Formatting ───────────────────────────────────────────────────────────────

const round2 = (n: number) => Math.round(n * 100) / 100;
/** Whole rupees stay whole; paise show only where the bill has them (GST, round off). */
function rupees(n: number, forcePaise = false): string {
  const v = Math.abs(round2(n));
  const paise = forcePaise || Math.abs(v - Math.round(v)) >= 0.005;
  return `₹${v.toLocaleString('en-IN', { minimumFractionDigits: paise ? 2 : 0, maximumFractionDigits: 2 })}`;
}
const pct = (n: number) => `${round2(n)}%`;

const KIND_TAG: Record<string, { label: string; bg: string; fg: string }> = {
  LOYALTY:    { label: 'Loyalty',    bg: 'rgba(243,93,59,0.16)',  fg: '#FB8A6E' },
  MEMBERSHIP: { label: 'Membership', bg: 'rgba(167,139,250,0.16)', fg: '#C4B5FD' },
  OFFER:      { label: 'Offer',      bg: 'rgba(96,165,250,0.16)',  fg: '#93C5FD' },
  STAFF:      { label: 'Staff',      bg: 'rgba(255,255,255,0.08)', fg: QuinckleColors.textSecondary },
  OTHER:      { label: 'Discount',   bg: 'rgba(255,255,255,0.08)', fg: QuinckleColors.textSecondary },
};

/** "Loyalty: Free Paneer Tikka x2" → "Free Paneer Tikka x2" — the tag already says Loyalty. */
function discountName(kind: string, name: string): string {
  if (kind === 'STAFF') return 'Given by staff';
  const stripped = name.replace(/^(Loyalty|Membership|Offer):\s*/i, '');
  return stripped || KIND_TAG[kind]?.label || 'Discount';
}

// ── View ─────────────────────────────────────────────────────────────────────

function Row({ label, value, tone, strong, children }: {
  label: string; value: string; tone?: 'credit' | 'muted'; strong?: boolean; children?: React.ReactNode;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.rowLabelWrap}>
        {children}
        <Text style={[styles.rowLabel, strong && styles.rowStrong, tone === 'muted' && styles.muted]} numberOfLines={2}>
          {label}
        </Text>
      </View>
      <Text style={[styles.rowValue, strong && styles.rowStrong, tone === 'credit' && styles.credit, tone === 'muted' && styles.muted]}>
        {value}
      </Text>
    </View>
  );
}

function Section({ title, children, first }: { title: string; children: React.ReactNode; first?: boolean }) {
  return (
    <View style={[styles.section, !first && styles.sectionRule]}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

export function BillExplainContent({ bill, pinned = false, inset = true, onGiveDiscount }: {
  bill: ExplainedBill;
  /**
   * The tablet rail shows the bill permanently in a fixed-height pane: the
   * lines scroll and the total stays on the pane's floor. The sheet scrolls
   * as a whole instead.
   */
  pinned?: boolean;
  /** Horizontal padding of its own; false when the parent already pads. */
  inset?: boolean;
  /** Puts the give/edit discount icon beside the total (tablet rail only). */
  onGiveDiscount?: () => void;
}) {
  const itemCount = bill.items.length;

  // Discount rows: the named lines when the backend itemises them; otherwise
  // the one total, untagged, rather than a guessed attribution.
  const discountRows = bill.discountLines.length > 0
    ? bill.discountLines
    : bill.discountTotal > 0 ? [{ kind: 'OTHER', name: 'Discount', amount: bill.discountTotal }] : [];

  const chargeRows = bill.chargeLines.length > 0
    ? bill.chargeLines
    : bill.chargesTotal !== 0
      ? [{ id: 'charges', name: bill.chargesTotal > 0 ? 'Service charge' : 'Adjustment', amount: bill.chargesTotal }]
      : [];

  const taxLines = bill.taxLines.filter((l) => l.amount > 0 || l.cgst > 0 || l.sgst > 0);
  const multiRate = taxLines.length > 1;
  const taxable = taxLines.reduce((n, l) => n + l.taxableValue, 0);
  const hasRoundOff = Math.abs(bill.roundOff) >= 0.005;

  const body = (
    <>
      {itemCount > 0 && (
        <Section title={`Items · ${itemCount}`} first>
          {bill.items.map((it) => (
            <View key={it.key} style={styles.itemRow}>
              <View style={{ flex: 1, paddingRight: Spacing.sm }}>
                <Text style={styles.itemName}>{it.name}</Text>
                {it.modifiersSummary ? <Text style={styles.itemMods} numberOfLines={1}>{it.modifiersSummary}</Text> : null}
              </View>
              <Text style={styles.rowValue}>{rupees(it.price)}</Text>
            </View>
          ))}
        </Section>
      )}

      <View style={itemCount > 0 ? styles.subtotalAfterItems : undefined}>
        <Row label="Subtotal" value={rupees(bill.subtotal)} strong />
      </View>

      {discountRows.length > 0 && (
        <Section title="Discounts">
          {discountRows.map((d, i) => {
            const tag = KIND_TAG[d.kind] ?? KIND_TAG.OTHER;
            return (
              <Row key={`${d.kind}:${d.name}:${i}`} label={discountName(d.kind, d.name)} value={`−${rupees(d.amount)}`} tone="credit">
                <View style={[styles.tag, { backgroundColor: tag.bg }]}>
                  <Text style={[styles.tagText, { color: tag.fg }]}>{tag.label}</Text>
                </View>
              </Row>
            );
          })}
        </Section>
      )}

      {(chargeRows.length > 0 || bill.taxTotal > 0 || bill.tip > 0 || hasRoundOff) && (
        <Section title="Charges and tax">
          {chargeRows.map((c) => (
            <Row key={c.id} label={c.name} value={`${c.amount < 0 ? '−' : ''}${rupees(c.amount)}`} tone={c.amount < 0 ? 'credit' : undefined} />
          ))}

          {taxLines.length > 0 ? (
            <>
              <Row label="Taxable value" value={rupees(taxable, true)} />
              {taxLines.map((l) => (
                <React.Fragment key={l.rate}>
                  <Row
                    label={multiRate ? `CGST ${pct(l.rate / 2)} on ${rupees(l.taxableValue)}` : `CGST ${pct(l.rate / 2)}`}
                    value={rupees(l.cgst, true)}
                  />
                  <Row
                    label={multiRate ? `SGST ${pct(l.rate / 2)} on ${rupees(l.taxableValue)}` : `SGST ${pct(l.rate / 2)}`}
                    value={rupees(l.sgst, true)}
                  />
                </React.Fragment>
              ))}
            </>
          ) : bill.taxTotal > 0 ? (
            // No per-rate lines from this backend: the one GST figure, not an invented split.
            <Row label={bill.taxRate > 0 ? `GST ${pct(bill.taxRate)}` : 'Tax'} value={rupees(bill.taxTotal, true)} />
          ) : null}

          {bill.tip > 0 && <Row label="Tip" value={rupees(bill.tip)} />}
          {hasRoundOff && (
            <Row label="Round off" value={`${bill.roundOff < 0 ? '−' : '+'}${rupees(bill.roundOff, true)}`} tone="muted" />
          )}
        </Section>
      )}

    </>
  );

  const total = (
    <View style={styles.totalBox}>
      <Text style={styles.totalLabel}>Total payable</Text>
      <View style={styles.totalRight}>
        {onGiveDiscount && (
          <TouchableOpacity
            onPress={onGiveDiscount}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={bill.discountTotal > 0 ? 'Edit discount' : 'Give discount'}
          >
            <MaterialCommunityIcons
              name="percent-box-outline"
              size={20}
              color={bill.discountTotal > 0 ? QuinckleColors.primary : QuinckleColors.textSecondary}
            />
          </TouchableOpacity>
        )}
        <Text style={styles.totalValue}>{rupees(bill.total)}</Text>
      </View>
    </View>
  );

  const pad = inset ? { paddingHorizontal: Spacing.xl } : null;
  if (pinned) {
    return (
      <View style={[{ flex: 1 }, pad]}>
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>{body}</ScrollView>
        {total}
      </View>
    );
  }
  return <View style={pad}>{body}{total}</View>;
}

export function BillExplainSheet({ visible, onClose, bill, title = 'Bill breakdown' }: {
  visible: boolean;
  onClose: () => void;
  bill: ExplainedBill | null;
  title?: string;
}) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title={title} maxHeightRatio={0.88}>
      {bill ? <BillExplainContent bill={bill} /> : null}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  section: { paddingVertical: Spacing.sm },
  sectionRule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: QuinckleColors.border, marginTop: Spacing.xs },
  sectionTitle: {
    color: QuinckleColors.textTertiary, fontSize: 11, fontWeight: '600',
    letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 4,
  },
  subtotalAfterItems: {
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: QuinckleColors.border,
    paddingTop: Spacing.xs, paddingBottom: Spacing.xs,
  },

  itemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 5 },
  itemName: { color: QuinckleColors.textSecondary, fontSize: 13.5 },
  itemMods: { color: QuinckleColors.textTertiary, fontSize: 11, marginTop: 2 },

  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: Spacing.md, paddingVertical: 5 },
  rowLabelWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowLabel: { flexShrink: 1, color: QuinckleColors.textSecondary, fontSize: 13.5 },
  rowValue: { color: QuinckleColors.textPrimary, fontSize: 13.5, fontWeight: '500', fontVariant: ['tabular-nums'] },
  rowStrong: { color: QuinckleColors.textPrimary, fontWeight: '700' },
  credit: { color: '#4ADE80' },
  muted: { color: QuinckleColors.textTertiary },

  tag: { borderRadius: Radius.pill, paddingHorizontal: 7, paddingVertical: 2 },
  tagText: { fontSize: 10, fontWeight: '700' },

  totalBox: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: QuinckleColors.surfaceElevated, borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md, marginTop: Spacing.md,
  },
  totalRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  totalLabel: { color: QuinckleColors.textPrimary, fontSize: 14, fontWeight: '600' },
  totalValue: { color: QuinckleColors.textPrimary, fontSize: 24, fontWeight: '700', letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
});
