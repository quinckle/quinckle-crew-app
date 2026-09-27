/**
 * UpiPaymentSheet — the QR a customer scans, shown right on order-menu's
 * payment pill instead of navigating to payment-collect.tsx for it.
 *
 * Same "one deliberate tap" shape as every collection method in this app
 * (see payment-collect.tsx's own note on Step/PendingPayment): the QR alone
 * proves nothing scanned it, so staff still has to tap "Payment received"
 * once they've actually seen it land, the same confirm payment-collect.tsx's
 * own UPI flow asks for. Confirming here doesn't collect anything — it just
 * marks the method chosen; order-menu's confirmAndPlace calls
 * crewPayments.collectPayment the moment the order actually exists.
 */

import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import QRCode from 'react-native-qrcode-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { QuinckleColors, Radius, Spacing, Typography } from '../../constants/Colors';
import { restaurantApi } from '../../services/api';
import { BottomSheet } from './BottomSheet';
import { RightDrawer } from './CartReviewSheet';

function buildUpiUri(vpa: string, merchantName: string, amount: number): string {
  const enc = (v: string | number) => encodeURIComponent(String(v));
  return `upi://pay?pa=${enc(vpa)}&pn=${enc(merchantName)}&am=${enc(amount.toFixed(2))}&cu=INR`;
}

export interface UpiPaymentSheetProps {
  visible: boolean;
  onClose: () => void;
  /** true on tablet-landscape / desktop → right-side drawer; else bottom sheet. */
  isWide: boolean;
  total: number;
  restaurantId: string | undefined;
  onConfirm: () => void;
}

export function UpiPaymentSheet(props: UpiPaymentSheetProps) {
  const { visible, onClose, isWide } = props;
  const insets = useSafeAreaInsets();

  if (!isWide) {
    return (
      <BottomSheet visible={visible} onClose={onClose} title="UPI" maxHeightRatio={0.7}>
        <UpiForm {...props} />
      </BottomSheet>
    );
  }

  return (
    <RightDrawer visible={visible} onClose={onClose} insetsTop={insets.top} insetsBottom={insets.bottom}>
      <View style={styles.drawerHeader}>
        <Text style={styles.drawerTitle}>UPI</Text>
        <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={8} activeOpacity={0.7}>
          <Ionicons name="close" size={20} color={QuinckleColors.textSecondary} />
        </TouchableOpacity>
      </View>
      <View style={styles.drawerDivider} />
      <UpiForm {...props} />
    </RightDrawer>
  );
}

function UpiForm({ visible, total, restaurantId, onConfirm, onClose }: UpiPaymentSheetProps) {
  const [loading, setLoading] = useState(true);
  const [vpa, setVpa] = useState<string | null>(null);
  const [merchantName, setMerchantName] = useState('Merchant');

  useEffect(() => {
    if (!visible || !restaurantId) return;
    let cancelled = false;
    setLoading(true);
    restaurantApi.getBranding(restaurantId)
      .then((r) => {
        if (cancelled) return;
        setVpa(r?.data?.upiId ?? null);
        setMerchantName(r?.data?.upiDisplayName ?? r?.data?.name ?? 'Merchant');
      })
      .catch(() => { if (!cancelled) setVpa(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [visible, restaurantId]);

  const upiUri = vpa && total > 0 ? buildUpiUri(vpa, merchantName, total) : '';

  return (
    <View style={styles.body}>
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={QuinckleColors.primary} /></View>
      ) : !vpa ? (
        <Text style={styles.hint}>No UPI ID on file — add one in restaurant settings.</Text>
      ) : (
        <>
          <Text style={styles.hint}>Scan to pay ₹{total.toLocaleString('en-IN')}</Text>
          <View style={styles.qrFrame}>
            <QRCode value={upiUri} size={200} backgroundColor="#ffffff" color="#000000" />
          </View>
          <Text style={styles.vpa}>{vpa}</Text>

          <TouchableOpacity
            style={styles.confirmBtn}
            onPress={() => { onConfirm(); onClose(); }}
            activeOpacity={0.85}
          >
            <Text style={styles.confirmBtnText}>Payment received</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.sm, paddingBottom: Spacing.xl, alignItems: 'center' },
  center: { paddingVertical: Spacing.huge },
  hint: { ...Typography.caption, color: QuinckleColors.textTertiary, textAlign: 'center', marginBottom: Spacing.lg },
  qrFrame: { padding: 14, backgroundColor: '#fff', borderRadius: Radius.lg },
  vpa: { ...Typography.caption, color: QuinckleColors.textSecondary, marginTop: Spacing.sm },

  confirmBtn: {
    marginTop: Spacing.xl, width: '100%', backgroundColor: QuinckleColors.primary,
    borderRadius: Radius.md, paddingVertical: 13, alignItems: 'center',
  },
  confirmBtnText: { ...Typography.bodyStrong, color: '#fff' },

  drawerHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl, paddingBottom: Spacing.md,
  },
  drawerTitle: { ...Typography.subtitle, color: QuinckleColors.textPrimary },
  closeBtn: { padding: 4 },
  drawerDivider: { height: StyleSheet.hairlineWidth, backgroundColor: QuinckleColors.border, marginBottom: Spacing.sm },
});
