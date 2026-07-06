/**
 * BillDetailsSheet — replaces the old inline "Bill Details" accordion, whose
 * item list was clipped past a hardcoded 180px with no way to scroll to the
 * rest. Fixed-height bottom sheet: item list scrolls in its own region,
 * summary rows + grand total stay pinned below it.
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

interface Props {
  visible: boolean;
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
  onClose: () => void;
}

export function BillDetailsSheet({
  visible,
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
  onClose,
}: Props) {
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Bill details"
      maxHeightRatio={0.82}
      disableInternalScroll
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.itemCount}>{items.length} item{items.length !== 1 ? 's' : ''}</Text>

        <ScrollView
          style={styles.itemsScroll}
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

        <View style={styles.summarySection}>
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

          <View style={styles.grandTotalCard}>
            <Text style={styles.grandTotalLabel}>Grand total</Text>
            <Text style={styles.grandTotalValue}>₹{grandTotal.toFixed(2)}</Text>
          </View>
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  itemCount: {
    ...Typography.micro,
    color: QuinckleColors.textTertiary,
    paddingHorizontal: Spacing.xl,
    marginBottom: Spacing.sm,
  },
  itemsScroll: {
    flexGrow: 0,
    borderTopWidth: 1,
    borderTopColor: QuinckleColors.borderSubtle,
    borderBottomWidth: 1,
    borderBottomColor: QuinckleColors.borderSubtle,
    paddingHorizontal: Spacing.xl,
  },
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
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  summaryLabel: { color: QuinckleColors.textSecondary, fontSize: 12, fontWeight: '500' },
  summaryValue: { color: QuinckleColors.textPrimary, fontSize: 12, fontWeight: '600' },
  creditValue: { color: '#86efac' },

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
  grandTotalLabel: { color: QuinckleColors.textPrimary, fontSize: 14, fontWeight: '600' },
  grandTotalValue: { color: QuinckleColors.primary, fontSize: 17, fontWeight: '700' },
});
