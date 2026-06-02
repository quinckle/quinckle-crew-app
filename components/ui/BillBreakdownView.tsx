import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { QuinckleColors, Spacing } from '../../constants/Colors';
import type { BillBreakdown } from '../../services/api';

/**
 * Renders the canonical bill breakdown — subtotal, charges, tax, tip → total.
 * Lines collapse if their amount is zero (don't show "Tip ₹0").
 * Used on payment-collect + table-detail screens.
 */
export function BillBreakdownView({ breakdown, compact = false }: {
  breakdown: BillBreakdown;
  compact?: boolean;
}) {
  const lines: { label: string; amount: number; muted?: boolean }[] = [];
  lines.push({ label: 'Subtotal', amount: breakdown.subtotal });
  if (breakdown.discount > 0) lines.push({ label: 'Discount', amount: -breakdown.discount, muted: true });
  if (breakdown.chargesTotal !== 0) {
    lines.push({
      label: breakdown.chargesTotal > 0 ? 'Service charge' : 'Adjustment',
      amount: breakdown.chargesTotal,
      muted: breakdown.chargesTotal < 0,
    });
  }
  if (breakdown.taxAmount > 0) {
    const taxLabel = breakdown.taxRate > 0 ? `GST (${breakdown.taxRate}%)` : 'Tax';
    lines.push({ label: taxLabel, amount: breakdown.taxAmount });
  }
  if (breakdown.tip > 0) lines.push({ label: 'Tip', amount: breakdown.tip });

  return (
    <View style={[s.wrap, compact && s.wrapCompact]}>
      {lines.map((l, i) => (
        <View key={i} style={s.row}>
          <Text style={s.label}>{l.label}</Text>
          <Text style={[s.amount, l.muted && s.amountMuted]}>
            {l.amount < 0 ? '−' : ''}₹{Math.abs(l.amount).toLocaleString('en-IN')}
          </Text>
        </View>
      ))}
      <View style={s.divider} />
      <View style={s.row}>
        <Text style={s.totalLabel}>Total</Text>
        <Text style={s.totalAmount}>₹{breakdown.total.toLocaleString('en-IN')}</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    paddingVertical: Spacing.sm,
    gap: 6,
  },
  wrapCompact: {
    paddingVertical: 4,
    gap: 4,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    color: QuinckleColors.textSecondary,
    fontSize: 13,
    fontWeight: '500',
  },
  amount: {
    color: QuinckleColors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  amountMuted: {
    color: QuinckleColors.success,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: QuinckleColors.border,
    marginVertical: 4,
  },
  totalLabel: {
    color: QuinckleColors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  totalAmount: {
    color: QuinckleColors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'],
  },
});
