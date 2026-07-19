/**
 * BillDetailsSheet — replaces the old inline "Bill Details" accordion, whose
 * item list was clipped past a hardcoded 180px with no way to scroll to the
 * rest. Fixed-height bottom sheet: item list scrolls in its own region,
 * summary rows + grand total stay pinned below it.
 *
 * The actual breakdown content lives in `BillBreakdownContent` below so it
 * can also be embedded inline (e.g. the tablet-landscape table detail screen
 * shows it permanently in the left pane instead of behind a sheet).
 */

import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheet } from './BottomSheet';
import { QuinckleColors, Radius, Spacing, Typography } from '../../constants/Colors';

export interface BillLineItem {
  key: string;
  name: string;
  modifiersSummary?: string | null;
  price: number;
}

export interface BillBreakdownProps {
  items: BillLineItem[];
  subtotal: number;
  discountTotal: number;
  serviceChargeTotal: number;
  tax: number;
  taxRate: number;
  tipTotal: number;
  grandTotal: number;
  canGiveDiscount: boolean;
  onGiveDiscount: () => void;
  /**
   * Set false to render only the summary rows + grand total, skipping the
   * per-item list — for contexts where the items are already itemized
   * elsewhere on screen (e.g. the tablet table-detail layout, which shows
   * them in full in the right pane). Defaults true for the sheet.
   */
  showItems?: boolean;
  /**
   * 'receipt' tightens row spacing, right-aligns values in a tabular
   * monospace, and adds a dashed rule above the grand total — for a
   * permanently-visible inline breakdown (tablet left pane). Defaults
   * 'sheet' (the original look) so the bottom sheet is unaffected.
   */
  variant?: 'sheet' | 'receipt';
}

/** Item list (scrolls) + summary rows + grand total (pinned below it). */
export function BillBreakdownContent({
  items,
  subtotal,
  discountTotal,
  serviceChargeTotal,
  tax,
  taxRate,
  tipTotal,
  grandTotal,
  canGiveDiscount,
  onGiveDiscount,
  showItems = true,
  variant = 'sheet',
}: BillBreakdownProps) {
  const receipt = variant === 'receipt';
  return (
    // No item list to anchor to the top → sink the summary to the bottom of
    // the available space instead of leaving it stranded up top with a big
    // empty gap below (that's the "stuck to bottom" receipt look).
    <View style={[{ flex: 1 }, !showItems && styles.pinBottom]}>
      {showItems && (
        <>
          <Text style={styles.itemCount}>{items.length} item{items.length !== 1 ? 's' : ''}</Text>

          <ScrollView
            style={[styles.itemsScroll, receipt && styles.itemsScrollReceipt]}
            showsVerticalScrollIndicator
            contentContainerStyle={{ paddingBottom: Spacing.sm }}
          >
            {items.map(item => (
              <View key={item.key} style={styles.itemRow}>
                <View style={{ flex: 1, paddingRight: Spacing.sm }}>
                  <Text style={styles.itemName}>{item.name}</Text>
                  {item.modifiersSummary ? (
                    <Text style={styles.itemModifiers} numberOfLines={1}>{item.modifiersSummary}</Text>
                  ) : null}
                </View>
                <Text style={styles.itemPrice}>₹{item.price.toFixed(0)}</Text>
              </View>
            ))}
          </ScrollView>
        </>
      )}

      {receipt && <Text style={styles.receiptLabel}>Bill</Text>}
      <View style={[styles.summarySection, receipt && styles.summarySectionReceipt]}>
        <View style={[styles.summaryRow, receipt && styles.summaryRowReceipt]}>
          <Text style={styles.summaryLabel}>Subtotal</Text>
          <Text style={[styles.summaryValue, receipt && styles.summaryValueReceipt]}>₹{subtotal.toFixed(0)}</Text>
        </View>
        {discountTotal > 0 && (
          <View style={[styles.summaryRow, receipt && styles.summaryRowReceipt]}>
            <Text style={styles.summaryLabel}>Discount</Text>
            <Text style={[styles.summaryValue, receipt && styles.summaryValueReceipt, styles.creditValue]}>−₹{discountTotal.toFixed(0)}</Text>
          </View>
        )}
        {serviceChargeTotal !== 0 && (
          <View style={[styles.summaryRow, receipt && styles.summaryRowReceipt]}>
            <Text style={styles.summaryLabel}>{serviceChargeTotal > 0 ? 'Service charge' : 'Adjustment'}</Text>
            <Text style={[styles.summaryValue, receipt && styles.summaryValueReceipt, serviceChargeTotal < 0 && styles.creditValue]}>
              {serviceChargeTotal < 0 ? '−' : ''}₹{Math.abs(serviceChargeTotal).toFixed(0)}
            </Text>
          </View>
        )}
        {tax > 0 && (
          <View style={[styles.summaryRow, receipt && styles.summaryRowReceipt]}>
            <Text style={styles.summaryLabel}>{taxRate > 0 ? `GST (${taxRate}%)` : 'Tax'}</Text>
            <Text style={[styles.summaryValue, receipt && styles.summaryValueReceipt]}>₹{tax.toFixed(2)}</Text>
          </View>
        )}
        {tipTotal > 0 && (
          <View style={[styles.summaryRow, receipt && styles.summaryRowReceipt]}>
            <Text style={styles.summaryLabel}>Tip</Text>
            <Text style={[styles.summaryValue, receipt && styles.summaryValueReceipt]}>₹{tipTotal.toFixed(0)}</Text>
          </View>
        )}

        {canGiveDiscount && (
          <TouchableOpacity style={styles.discountBtn} onPress={onGiveDiscount} activeOpacity={0.8}>
            <Ionicons name="pricetag-outline" size={14} color={QuinckleColors.primary} />
            <Text style={styles.discountBtnText}>{discountTotal > 0 ? 'Edit discount' : 'Give discount'}</Text>
          </TouchableOpacity>
        )}

        {receipt && <View style={styles.receiptDashedRule} />}

        <View style={[styles.grandTotalCard, receipt && styles.grandTotalCardReceipt]}>
          <Text style={styles.grandTotalLabel}>Grand total</Text>
          <Text style={[styles.grandTotalValue, receipt && styles.summaryValueReceipt]}>₹{grandTotal.toFixed(2)}</Text>
        </View>
      </View>
    </View>
  );
}

interface SheetProps extends BillBreakdownProps {
  visible: boolean;
  onClose: () => void;
}

export function BillDetailsSheet({ visible, onClose, ...breakdown }: SheetProps) {
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Bill details"
      maxHeightRatio={0.82}
      disableInternalScroll
    >
      <BillBreakdownContent {...breakdown} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  pinBottom: { justifyContent: 'flex-end' },
  receiptLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: QuinckleColors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: Spacing.sm,
  },
  itemCount: {
    ...Typography.micro,
    color: QuinckleColors.textTertiary,
    paddingHorizontal: Spacing.xl,
    marginBottom: Spacing.sm,
  },
  itemsScroll: {
    flexGrow: 0,
    // (receipt variant overrides flexGrow so the list fills and the summary
    // pins to the bottom of the rail — see itemsScrollReceipt.)
    borderTopWidth: 1,
    borderTopColor: QuinckleColors.borderSubtle,
    borderBottomWidth: 1,
    borderBottomColor: QuinckleColors.borderSubtle,
    paddingHorizontal: Spacing.xl,
  },
  // Fill the available height so the summary + grand total sit flush at the
  // bottom of the pane (uniform whether 2 items or 20).
  itemsScrollReceipt: { flex: 1, flexGrow: 1 },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: QuinckleColors.borderSubtle,
  },
  itemName: { color: QuinckleColors.textPrimary, fontSize: 13, fontWeight: '500' },
  itemModifiers: { color: QuinckleColors.textTertiary, fontSize: 11, marginTop: 2, fontStyle: 'italic' },
  itemPrice: { color: QuinckleColors.textSecondary, fontSize: 13, fontWeight: '500' },

  summarySection: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.md },
  summarySectionReceipt: { paddingHorizontal: 0, paddingTop: 0 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  summaryRowReceipt: { paddingVertical: 2 },
  summaryLabel: { color: QuinckleColors.textSecondary, fontSize: 12, fontWeight: '500' },
  summaryValue: { color: QuinckleColors.textPrimary, fontSize: 12, fontWeight: '600' },
  summaryValueReceipt: { fontFamily: 'monospace', letterSpacing: 0.3 },
  creditValue: { color: '#86efac' },
  receiptDashedRule: {
    borderTopWidth: 1,
    borderStyle: 'dashed',
    borderColor: QuinckleColors.borderStrong,
    marginTop: Spacing.md,
  },

  discountBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginTop: Spacing.sm,
  },
  discountBtnText: { color: QuinckleColors.primary, fontSize: 12, fontWeight: '700' },

  grandTotalCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: QuinckleColors.primarySoft,
    borderRadius: Radius.md,
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  // Receipt variant: flat row on the dashed rule instead of a filled card —
  // the rule + bold text already carry enough weight.
  grandTotalCardReceipt: {
    backgroundColor: 'transparent',
    borderRadius: 0,
    paddingHorizontal: 0,
    paddingVertical: 0,
    marginTop: Spacing.sm,
    marginBottom: 0,
  },
  grandTotalLabel: { color: QuinckleColors.textPrimary, fontSize: 14, fontWeight: '600' },
  grandTotalValue: { color: QuinckleColors.primary, fontSize: 17, fontWeight: '700' },
});
