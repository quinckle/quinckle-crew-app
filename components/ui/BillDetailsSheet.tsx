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
import { QuinckleColors, Spacing } from '../../constants/Colors';

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

/**
 * Receipt-style breakdown. The item list scrolls in its own region while the
 * summary rows + grand total stay pinned to the bottom of the available space
 * — so the total sits flush at the foot of the sheet (or the tablet rail)
 * whether there are 2 items or 20. Amounts are set in tabular monospace so
 * the ₹ column lines up like a printed bill.
 */
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
  // The sheet floats free of the screen edges, so its content needs its own
  // horizontal padding; the tablet rail ('receipt') already pads its wrapper.
  const hPad = variant === 'receipt' ? 0 : Spacing.xl;
  return (
    <View style={{ flex: 1 }}>
      {showItems && (
        <>
          <View style={[styles.itemsHeader, { paddingHorizontal: hPad }]}>
            <Text style={styles.itemsHeaderLabel}>Bill</Text>
            <Text style={styles.itemsHeaderCount}>{items.length} item{items.length !== 1 ? 's' : ''}</Text>
          </View>

          <ScrollView
            style={[styles.itemsScroll, { paddingHorizontal: hPad }]}
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

      {/* Pinned to the bottom of the available space. */}
      <View style={[styles.summarySection, { paddingHorizontal: hPad }, !showItems && styles.pinBottom]}>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Subtotal</Text>
          <Text style={styles.summaryValue}>₹{subtotal.toFixed(0)}</Text>
        </View>
        {discountTotal > 0 && (
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Discount</Text>
            <Text style={[styles.summaryValue, styles.creditValue]}>−₹{discountTotal.toFixed(0)}</Text>
          </View>
        )}
        {serviceChargeTotal !== 0 && (
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>{serviceChargeTotal > 0 ? 'Service charge' : 'Adjustment'}</Text>
            <Text style={[styles.summaryValue, serviceChargeTotal < 0 && styles.creditValue]}>
              {serviceChargeTotal < 0 ? '−' : ''}₹{Math.abs(serviceChargeTotal).toFixed(0)}
            </Text>
          </View>
        )}
        {tax > 0 && (
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>{taxRate > 0 ? `GST (${taxRate}%)` : 'Tax'}</Text>
            <Text style={styles.summaryValue}>₹{tax.toFixed(2)}</Text>
          </View>
        )}
        {tipTotal > 0 && (
          <View style={styles.summaryRow}>
            <Text style={styles.summaryLabel}>Tip</Text>
            <Text style={styles.summaryValue}>₹{tipTotal.toFixed(0)}</Text>
          </View>
        )}

        {canGiveDiscount && (
          <TouchableOpacity style={styles.discountBtn} onPress={onGiveDiscount} activeOpacity={0.8}>
            <Ionicons name="pricetag-outline" size={14} color={QuinckleColors.primary} />
            <Text style={styles.discountBtnText}>{discountTotal > 0 ? 'Edit discount' : 'Give discount'}</Text>
          </TouchableOpacity>
        )}

        <View style={styles.dashedRule} />

        <View style={styles.grandTotalRow}>
          <Text style={styles.grandTotalLabel}>Grand total</Text>
          <Text style={styles.grandTotalValue}>₹{grandTotal.toFixed(2)}</Text>
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

// Tabular monospace so every ₹ amount aligns in a clean right-hand column,
// the way a printed receipt reads.
const MONO = { fontFamily: 'monospace' as const, letterSpacing: 0.3 };

const styles = StyleSheet.create({
  pinBottom: { justifyContent: 'flex-end' },

  itemsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: Spacing.md,
  },
  itemsHeaderLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: QuinckleColors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  itemsHeaderCount: {
    fontSize: 11,
    fontWeight: '600',
    color: QuinckleColors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  // Fill the available height so the summary + grand total sit flush at the
  // bottom of the pane (uniform whether 2 items or 20).
  itemsScroll: { flex: 1 },
  itemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: Spacing.sm,
  },
  itemName: { color: QuinckleColors.textPrimary, fontSize: 13.5, fontWeight: '500' },
  itemModifiers: { color: QuinckleColors.textTertiary, fontSize: 11, marginTop: 2, fontStyle: 'italic' },
  itemPrice: { ...MONO, color: QuinckleColors.textSecondary, fontSize: 13.5, fontWeight: '500' },

  summarySection: {
    paddingTop: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: QuinckleColors.borderSubtle,
  },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2.5 },
  summaryLabel: { color: QuinckleColors.textSecondary, fontSize: 12, fontWeight: '500' },
  summaryValue: { ...MONO, color: QuinckleColors.textPrimary, fontSize: 12, fontWeight: '600' },
  creditValue: { color: '#86efac' },
  dashedRule: {
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

  // Flat row on the dashed rule instead of a filled card — the rule + bold
  // text carry the weight, matching a thermal-printed receipt.
  grandTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: Spacing.md,
  },
  grandTotalLabel: { color: QuinckleColors.textPrimary, fontSize: 14, fontWeight: '600' },
  grandTotalValue: { ...MONO, color: QuinckleColors.primary, fontSize: 19, fontWeight: '700' },
});
