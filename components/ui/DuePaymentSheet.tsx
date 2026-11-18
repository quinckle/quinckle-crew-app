/**
 * DuePaymentSheet — the same khata (pay-later) capture payment-collect.tsx's
 * "Pay later" mode does (phone, name, an optional amount paid now), but
 * reached from order-menu's payment pill BEFORE the order is placed.
 *
 * Confirming here doesn't collect anything — it just stores the details;
 * order-menu's confirmAndPlace calls crewPayments.collectPayment with a DUE
 * split (plus a CASH/UPI_DIRECT split for whatever was paid now) the moment
 * the order actually exists, the same call payment-collect.tsx's khata mode
 * makes.
 */

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { QuinckleColors, Radius, Spacing, Typography } from '../../constants/Colors';
import { BottomSheet } from './BottomSheet';
import { RightDrawer } from './CartReviewSheet';

export interface DuePaymentDetails {
  phone: string;
  name: string;
  paidNow: number;
  paidMethod: 'CASH' | 'UPI_DIRECT';
}

export interface DuePaymentSheetProps {
  visible: boolean;
  onClose: () => void;
  /** true on tablet-landscape / desktop → right-side drawer; else bottom sheet. */
  isWide: boolean;
  total: number;
  initial?: DuePaymentDetails | null;
  /** Prefilled from the order-menu guest row when there's nothing saved yet. */
  fallbackPhone?: string;
  fallbackName?: string;
  onConfirm: (details: DuePaymentDetails) => void;
}

export function DuePaymentSheet(props: DuePaymentSheetProps) {
  const { visible, onClose, isWide } = props;
  const insets = useSafeAreaInsets();

  if (!isWide) {
    return (
      <BottomSheet visible={visible} onClose={onClose} title="Pay later — khata" maxHeightRatio={0.75}>
        <DueForm {...props} />
      </BottomSheet>
    );
  }

  return (
    <RightDrawer visible={visible} onClose={onClose} insetsTop={insets.top} insetsBottom={insets.bottom}>
      <View style={styles.drawerHeader}>
        <Text style={styles.drawerTitle}>Pay later — khata</Text>
        <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={8} activeOpacity={0.7}>
          <Ionicons name="close" size={20} color={QuinckleColors.textSecondary} />
        </TouchableOpacity>
      </View>
      <View style={styles.drawerDivider} />
      <DueForm {...props} />
    </RightDrawer>
  );
}

function DueForm({ visible, total, initial, fallbackPhone, fallbackName, onConfirm, onClose }: DuePaymentSheetProps) {
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [paidNowInput, setPaidNowInput] = useState('');
  const [paidMethod, setPaidMethod] = useState<'CASH' | 'UPI_DIRECT'>('CASH');

  useEffect(() => {
    if (!visible) return;
    setPhone(initial?.phone ?? (fallbackPhone ?? '').replace(/^\+91|[\s\-()]/g, '').slice(0, 10));
    setName(initial?.name ?? fallbackName ?? '');
    setPaidNowInput(initial && initial.paidNow > 0 ? String(initial.paidNow) : '');
    setPaidMethod(initial?.paidMethod ?? 'CASH');
  }, [visible, initial, fallbackPhone, fallbackName]);

  const paidNow = Number(paidNowInput || 0);
  const dueAmount = Math.max(0, total - paidNow);
  const phoneValid = /^[6-9]\d{9}$/.test(phone);
  const valid = phoneValid && dueAmount > 0 && paidNow >= 0 && paidNow < total;
  const who = name.trim() || phone;

  return (
    <View style={styles.body}>
      <Text style={styles.hint}>Who&apos;s this on the hook for?</Text>

      <View style={styles.inputWrap}>
        <View style={styles.code}><Text style={styles.codeText}>+91</Text></View>
        <View style={styles.divider} />
        <TextInput
          style={styles.input}
          value={phone}
          onChangeText={(v) => setPhone(v.replace(/\D/g, '').slice(0, 10))}
          placeholder="10-digit mobile"
          placeholderTextColor={QuinckleColors.textMuted}
          keyboardType="phone-pad"
          maxLength={10}
          autoFocus
        />
      </View>

      <View style={[styles.inputWrap, { marginTop: 10 }]}>
        <TextInput
          style={[styles.input, { flex: 1, paddingHorizontal: 14 }]}
          value={name}
          onChangeText={setName}
          placeholder="Name (optional)"
          placeholderTextColor={QuinckleColors.textMuted}
          returnKeyType="done"
        />
      </View>

      <Text style={[styles.hint, { marginTop: Spacing.lg }]}>Received anything right now?</Text>
      <View style={styles.row}>
        <View style={styles.col}>
          <View style={[styles.field, styles.fieldActive]}>
            <Text style={styles.currency}>₹</Text>
            <TextInput
              value={paidNowInput}
              onChangeText={(raw) => setPaidNowInput(raw.replace(/[^\d]/g, '').slice(0, 7))}
              keyboardType="number-pad"
              placeholder="0"
              placeholderTextColor={QuinckleColors.textTertiary}
              style={styles.input}
            />
          </View>
        </View>
        {paidNow > 0 && (
          <View style={styles.methodPair}>
            {(['CASH', 'UPI_DIRECT'] as const).map((m) => {
              const on = paidMethod === m;
              return (
                <TouchableOpacity
                  key={m}
                  style={[styles.methodChip, on && styles.methodChipOn]}
                  onPress={() => setPaidMethod(m)}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.methodChipText, on && styles.methodChipTextOn]}>
                    {m === 'CASH' ? 'Cash' : 'UPI'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </View>

      <Text style={styles.dueLine}>
        {paidNow > 0
          ? `₹${paidNow.toLocaleString('en-IN')} received now · ₹${dueAmount.toLocaleString('en-IN')} on ${who || 'their'} khata`
          : `₹${dueAmount.toLocaleString('en-IN')} on ${who || 'their'} khata`}
      </Text>

      <TouchableOpacity
        style={[styles.confirmBtn, !valid && styles.confirmBtnOff]}
        onPress={() => { onConfirm({ phone, name: name.trim(), paidNow, paidMethod }); onClose(); }}
        disabled={!valid}
        activeOpacity={0.85}
      >
        <Text style={styles.confirmBtnText}>Confirm</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.sm, paddingBottom: Spacing.xl },
  hint: { ...Typography.caption, color: QuinckleColors.textTertiary, marginBottom: Spacing.sm },

  inputWrap: {
    flexDirection: 'row', alignItems: 'center', height: 48, overflow: 'hidden',
    backgroundColor: QuinckleColors.surfaceElevated, borderRadius: Radius.md,
    borderWidth: 1, borderColor: QuinckleColors.border,
  },
  code: { paddingHorizontal: 12, height: '100%', justifyContent: 'center' },
  codeText: { ...Typography.body, color: QuinckleColors.textSecondary, fontWeight: '600' },
  divider: { width: 1, height: '60%', backgroundColor: QuinckleColors.border },
  input: { flex: 1, color: QuinckleColors.textPrimary, fontSize: 15, paddingHorizontal: 12, height: '100%' },

  row: { flexDirection: 'row', gap: Spacing.md, alignItems: 'center' },
  col: { flex: 1 },
  field: {
    flexDirection: 'row', alignItems: 'center', height: 48,
    backgroundColor: QuinckleColors.surfaceElevated, borderRadius: Radius.md,
    borderWidth: 1, borderColor: QuinckleColors.border, paddingHorizontal: 12,
  },
  fieldActive: { borderColor: QuinckleColors.primary },
  currency: { fontSize: 15, color: QuinckleColors.textSecondary, marginRight: 4 },

  methodPair: { flexDirection: 'row', gap: 6 },
  methodChip: {
    paddingHorizontal: 12, paddingVertical: 12, borderRadius: Radius.md,
    borderWidth: 1, borderColor: QuinckleColors.border, backgroundColor: QuinckleColors.surfaceMuted,
  },
  methodChipOn: { backgroundColor: QuinckleColors.primary, borderColor: QuinckleColors.primary },
  methodChipText: { fontSize: 13, fontWeight: '600', color: QuinckleColors.textSecondary },
  methodChipTextOn: { color: '#fff' },

  dueLine: { fontSize: 13, fontWeight: '600', color: QuinckleColors.warning, marginTop: Spacing.md },

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
