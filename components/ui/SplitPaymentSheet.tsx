/**
 * SplitPaymentSheet — cash + UPI amounts for a takeaway order paid part one
 * way, part the other, captured on order-menu's payment pill BEFORE the order
 * is placed. Confirming here doesn't collect anything — it just stores the
 * split; order-menu's confirmAndPlace calls crewPayments.collectPayment with
 * it the moment the order actually exists (see PAYMENT_METHODS there).
 *
 * Same Cash-typed / UPI-computed pattern as payment-collect.tsx's split mode,
 * and the same right-drawer / bottom-sheet duality as GuestSheet.
 */

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { QuinckleColors, Radius, Spacing, Typography } from '../../constants/Colors';
import { BottomSheet } from './BottomSheet';
import { RightDrawer } from './CartReviewSheet';

export interface SplitPaymentSheetProps {
  visible: boolean;
  onClose: () => void;
  /** true on tablet-landscape / desktop → right-side drawer; else bottom sheet. */
  isWide: boolean;
  total: number;
  initialCash?: number | null;
  onConfirm: (cash: number, upi: number) => void;
}

export function SplitPaymentSheet(props: SplitPaymentSheetProps) {
  const { visible, onClose, isWide } = props;
  const insets = useSafeAreaInsets();

  if (!isWide) {
    return (
      <BottomSheet visible={visible} onClose={onClose} title="Split payment" maxHeightRatio={0.6}>
        <SplitForm {...props} />
      </BottomSheet>
    );
  }

  return (
    <RightDrawer visible={visible} onClose={onClose} insetsTop={insets.top} insetsBottom={insets.bottom}>
      <View style={styles.drawerHeader}>
        <Text style={styles.drawerTitle}>Split payment</Text>
        <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={8} activeOpacity={0.7}>
          <Ionicons name="close" size={20} color={QuinckleColors.textSecondary} />
        </TouchableOpacity>
      </View>
      <View style={styles.drawerDivider} />
      <SplitForm {...props} />
    </RightDrawer>
  );
}

function SplitForm({ visible, total, initialCash, onConfirm, onClose }: SplitPaymentSheetProps) {
  const [cashInput, setCashInput] = useState('');

  // Fresh each time it opens — re-splitting an already-confirmed amount starts
  // from what was last entered, not from zero.
  useEffect(() => {
    if (visible) setCashInput(initialCash != null ? String(initialCash) : '');
  }, [visible, initialCash]);

  const cashNum = Number(cashInput || 0);
  const upiNum = Math.max(0, total - cashNum);
  const valid = cashNum > 0 && upiNum > 0;
  const hint =
    cashInput.length === 0 ? null
    : valid ? 'Exact'
    : cashNum >= total ? `₹${(cashNum - total).toLocaleString('en-IN')} over`
    : null;

  return (
    <View style={styles.body}>
      <Text style={styles.hint}>Enter the cash amount — UPI is calculated automatically.</Text>
      <Text style={styles.totalText}>Total ₹{total.toLocaleString('en-IN')}</Text>

      <View style={styles.row}>
        <View style={styles.col}>
          <Text style={styles.colLabel}>Cash</Text>
          <View style={[styles.field, styles.fieldActive]}>
            <Text style={styles.currency}>₹</Text>
            <TextInput
              value={cashInput}
              onChangeText={(raw) => setCashInput(raw.replace(/[^\d]/g, '').slice(0, 7))}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor={QuinckleColors.textTertiary}
              style={styles.input}
              autoFocus
            />
          </View>
        </View>
        <View style={styles.col}>
          <Text style={styles.colLabel}>UPI</Text>
          <View style={styles.field}>
            <Text style={styles.currency}>₹</Text>
            <Text style={[styles.readonly, { color: cashInput.length === 0 ? QuinckleColors.textTertiary : QuinckleColors.textPrimary }]}>
              {cashInput.length === 0 ? '—' : String(upiNum)}
            </Text>
          </View>
        </View>
      </View>
      {hint && <Text style={styles.splitHint}>{hint}</Text>}

      <TouchableOpacity
        style={[styles.confirmBtn, !valid && styles.confirmBtnOff]}
        onPress={() => { onConfirm(cashNum, upiNum); onClose(); }}
        disabled={!valid}
        activeOpacity={0.85}
      >
        <Text style={styles.confirmBtnText}>Confirm split</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.sm, paddingBottom: Spacing.xl },
  hint: { ...Typography.caption, color: QuinckleColors.textTertiary },
  totalText: { ...Typography.subtitle, color: QuinckleColors.textPrimary, marginTop: 4, marginBottom: Spacing.lg },

  row: { flexDirection: 'row', gap: Spacing.md },
  col: { flex: 1 },
  colLabel: { fontSize: 12, fontWeight: '600', color: QuinckleColors.textSecondary, marginBottom: 6 },
  field: {
    flexDirection: 'row', alignItems: 'center', height: 48,
    backgroundColor: QuinckleColors.surfaceElevated, borderRadius: Radius.md,
    borderWidth: 1, borderColor: QuinckleColors.border, paddingHorizontal: 12,
  },
  fieldActive: { borderColor: QuinckleColors.primary },
  currency: { fontSize: 15, color: QuinckleColors.textSecondary, marginRight: 4 },
  input: { flex: 1, color: QuinckleColors.textPrimary, fontSize: 16, fontWeight: '600', height: '100%' },
  readonly: { flex: 1, fontSize: 16, fontWeight: '600' },
  splitHint: { fontSize: 12, fontWeight: '600', color: QuinckleColors.success, textAlign: 'right', marginTop: 6 },

  confirmBtn: {
    marginTop: Spacing.xl, backgroundColor: QuinckleColors.primary,
    borderRadius: Radius.md, paddingVertical: 13, alignItems: 'center',
  },
  confirmBtnOff: { opacity: 0.4 },
  confirmBtnText: { ...Typography.bodyStrong, color: '#fff' },

  drawerHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl, paddingBottom: Spacing.md,
  },
  drawerTitle: { ...Typography.subtitle, color: QuinckleColors.textPrimary },
  closeBtn: { padding: 4 },
  drawerDivider: { height: StyleSheet.hairlineWidth, backgroundColor: QuinckleColors.border, marginBottom: Spacing.sm },
});
