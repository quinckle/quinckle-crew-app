/**
 * Record a refund against a settled order (POS adjustments, Tier C1).
 *
 * "Record-only": the money moves in the physical world — cash out of the
 * drawer, or a UPI transfer sent by hand — and the ledger row is its only
 * trace. Nothing about the order changes, because it really was paid.
 *
 * The copy says "record" rather than "refund" for that reason: tapping this
 * does not move any money, it writes down that someone did.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheet } from './BottomSheet';
import { ReasonChips } from './ReasonSheet';
import { REFUND_REASONS, isReasonComplete, toReasonPayload, type CancelReason } from '../../constants/adjustmentReasons';
import { QuinckleColors } from '../../constants/Colors';

export type RefundMethod = 'CASH' | 'UPI_DIRECT';

interface Props {
  visible: boolean;
  /** What is still refundable on this order. */
  refundable: number;
  orderLabel?: string | null;
  busy?: boolean;
  onClose: () => void;
  onSubmit: (input: { amount: number; method: RefundMethod; coded: CancelReason }) => void;
}

const METHODS: { key: RefundMethod; label: string; icon: string }[] = [
  { key: 'CASH', label: 'Cash from drawer', icon: 'cash-outline' },
  { key: 'UPI_DIRECT', label: 'UPI sent by hand', icon: 'phone-portrait-outline' },
];

export function RefundSheet({ visible, refundable, orderLabel, busy = false, onClose, onSubmit }: Props) {
  const [full, setFull] = useState(true);
  const [amountText, setAmountText] = useState('');
  const [method, setMethod] = useState<RefundMethod | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [text, setText] = useState('');

  useEffect(() => {
    if (visible) {
      setFull(true); setAmountText(''); setMethod(null); setCode(null); setText('');
    }
  }, [visible]);

  const amount = full ? refundable : Number(amountText || 0);

  const amountError = useMemo(() => {
    if (full) return null;
    if (!(amount > 0)) return 'Enter an amount.';
    // The server clamps too, but being told before you open the till is better
    // than being told after.
    if (amount > refundable + 0.005) return `Only ₹${refundable.toFixed(0)} is left to refund.`;
    return null;
  }, [full, amount, refundable]);

  const canSubmit = !busy && !amountError && amount > 0 && !!method && isReasonComplete(code, text);

  return (
    <BottomSheet visible={visible} onClose={() => { if (!busy) onClose(); }} title="Record a refund">
      <View style={styles.body}>
        <Text style={styles.note}>
          {orderLabel ? `${orderLabel} · ` : ''}₹{refundable.toFixed(0)} can still be refunded.
          {'\n'}This writes the refund down — hand over the money yourself.
        </Text>

        <View style={styles.segRow}>
          <TouchableOpacity
            style={[styles.seg, full && styles.segActive]}
            onPress={() => setFull(true)} activeOpacity={0.85} disabled={busy}
          >
            <Text style={[styles.segText, full && styles.segTextActive]}>Full ₹{refundable.toFixed(0)}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.seg, !full && styles.segActive]}
            onPress={() => setFull(false)} activeOpacity={0.85} disabled={busy}
          >
            <Text style={[styles.segText, !full && styles.segTextActive]}>Part of it</Text>
          </TouchableOpacity>
        </View>

        {!full && (
          <TextInput
            style={styles.amountInput}
            value={amountText}
            onChangeText={(t) => setAmountText(t.replace(/[^\d.]/g, ''))}
            placeholder="₹0"
            placeholderTextColor={QuinckleColors.textMuted}
            keyboardType="decimal-pad"
            editable={!busy}
            autoFocus
          />
        )}
        {amountError ? <Text style={styles.error}>{amountError}</Text> : null}

        <Text style={styles.prompt}>How is it going back?</Text>
        <View style={styles.methodRow}>
          {METHODS.map((m) => {
            const active = method === m.key;
            return (
              <TouchableOpacity
                key={m.key}
                style={[styles.method, active && styles.methodActive]}
                onPress={() => setMethod(m.key)} activeOpacity={0.85} disabled={busy}
              >
                <Ionicons
                  name={m.icon as any} size={15}
                  color={active ? QuinckleColors.primary : QuinckleColors.textSecondary}
                />
                <Text style={[styles.methodText, active && styles.methodTextActive]} numberOfLines={1}>{m.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <ReasonChips
          reasons={REFUND_REASONS}
          prompt="Why is it being refunded?"
          code={code}
          text={text}
          onPickCode={setCode}
          onChangeText={setText}
          disabled={busy}
        />

        <View style={styles.actions}>
          <TouchableOpacity
            style={styles.cancel} onPress={() => { if (!busy) onClose(); }}
            activeOpacity={0.8} disabled={busy}
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.confirm, !canSubmit && styles.confirmDisabled]}
            onPress={() => {
              if (!canSubmit || !method || !code) return;
              onSubmit({ amount, method, coded: toReasonPayload(code, text) });
            }}
            activeOpacity={0.85}
            disabled={!canSubmit}
          >
            {busy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.confirmText}>Record refund</Text>}
          </TouchableOpacity>
        </View>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 22, paddingTop: 0, paddingBottom: 8, alignItems: 'center' },
  note: { fontSize: 13, color: QuinckleColors.textSecondary, textAlign: 'center', lineHeight: 19 },
  segRow: { flexDirection: 'row', gap: 8, alignSelf: 'stretch', marginTop: 16 },
  seg: {
    flex: 1, paddingVertical: 11, borderRadius: 12, alignItems: 'center',
    backgroundColor: QuinckleColors.surfaceElevated, borderWidth: 1.5, borderColor: 'transparent',
  },
  segActive: { borderColor: QuinckleColors.primary, backgroundColor: 'rgba(243,93,59,0.10)' },
  segText: { fontSize: 13, fontWeight: '600', color: QuinckleColors.textSecondary },
  segTextActive: { color: QuinckleColors.textPrimary },
  amountInput: {
    alignSelf: 'stretch', marginTop: 10, paddingVertical: 13,
    backgroundColor: QuinckleColors.surfaceElevated, borderRadius: 12,
    borderWidth: 1, borderColor: QuinckleColors.border,
    fontSize: 20, textAlign: 'center', color: QuinckleColors.textPrimary,
  },
  error: { fontSize: 12, color: QuinckleColors.danger, marginTop: 8, alignSelf: 'flex-start' },
  prompt: {
    fontSize: 13, fontWeight: '700', color: QuinckleColors.textSecondary,
    alignSelf: 'flex-start', marginTop: 18, marginBottom: 10,
  },
  methodRow: { flexDirection: 'row', gap: 8, alignSelf: 'stretch' },
  method: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    paddingVertical: 12, borderRadius: 12,
    backgroundColor: QuinckleColors.surfaceElevated, borderWidth: 1.5, borderColor: 'transparent',
  },
  methodActive: { borderColor: QuinckleColors.primary, backgroundColor: 'rgba(243,93,59,0.10)' },
  methodText: { flexShrink: 1, fontSize: 12.5, fontWeight: '600', color: QuinckleColors.textSecondary },
  methodTextActive: { color: QuinckleColors.textPrimary },
  actions: { flexDirection: 'row', gap: 12, alignSelf: 'stretch', marginTop: 22 },
  cancel: {
    flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1,
    borderColor: QuinckleColors.border, alignItems: 'center', justifyContent: 'center',
  },
  cancelText: { fontSize: 14, fontWeight: '700', color: QuinckleColors.textSecondary },
  confirm: {
    flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: QuinckleColors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  confirmDisabled: { opacity: 0.4 },
  confirmText: { fontSize: 14, fontWeight: '800', color: '#fff' },
});
