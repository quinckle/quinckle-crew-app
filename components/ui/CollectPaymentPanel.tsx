/**
 * CollectPaymentPanel — the desktop command rail's "Send to Payment
 * Collection" flow, embedded in a bottom sheet (see [tableId].tsx) instead
 * of pushing the phone's payment-collect.tsx screen. Same move as
 * AdjustBillForm / SwapTableSheet / the extend-time sheet: a mouse-and-
 * keyboard surface keeps the panel's context instead of replacing the whole
 * window.
 *
 * Deliberately NOT a port of payment-collect.tsx's full flow: that screen's
 * staged tap-to-confirm steps and UPI QR exist for a phone handed across a
 * counter. At a till, crew already has their own UPI terminal and cash
 * drawer — they just need to log which method(s) covered the bill. So this
 * is a method picker + one CTA: pick Cash / UPI / Split / Due, fill the one
 * or two fields that method needs, hit Confirm & Collect, sheet closes.
 *
 * Split needs only the cash amount — UPI is whatever's left of the total,
 * same rule the phone flow uses, just without the QR. Due (khata) still
 * needs the guest's phone (required server-side for the ledger entry).
 */

import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, LayoutChangeEvent, StyleSheet, Switch, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { QuinckleColors, Radius, Spacing, Typography } from '../../constants/Colors';
import { crewPayments, crewSessions, type CollectSplitMethod } from '../../services/api';

/** Runs after a successful collect, only when the panel's own toggle is on.
 *  Defaults to the dine-in free-table behaviour below when omitted — pass
 *  this to repurpose the same toggle for something else (e.g. takeaway's
 *  hand-over), so the caller owns that side effect instead of this panel
 *  needing to know about every channel that reuses it. */
export interface CollectSecondaryAction {
  label: string;
  run: () => Promise<void>;
}

type Method = 'CASH' | 'UPI_DIRECT' | 'SPLIT' | 'DUE';

// Same icon + tint per method as the phone flow's optionRow (payment-collect.tsx)
// — cash green, UPI blue, split neutral, pay-later/khata amber — so the two
// surfaces read as the same feature, not a re-skin.
const METHODS: { key: Method; label: string; icon: React.ComponentProps<typeof Ionicons>['name']; tint: string }[] = [
  { key: 'CASH', label: 'Cash', icon: 'cash-outline', tint: QuinckleColors.success },
  { key: 'UPI_DIRECT', label: 'UPI', icon: 'qr-code-outline', tint: '#60A5FA' },
  { key: 'SPLIT', label: 'Split', icon: 'git-compare-outline', tint: QuinckleColors.textSecondary },
  { key: 'DUE', label: 'Due', icon: 'time-outline', tint: QuinckleColors.warning },
];

export interface CollectPaymentPanelProps {
  /** Session-wide collect (dine-in): pass sessionId + orderIds, leave orderId unset. */
  sessionId?: string;
  orderIds?: string[];
  /** Single-order collect (takeaway): pass orderId, leave sessionId/orderIds unset. */
  orderId?: string;
  amount: number;
  /** e.g. "T06" or a pickup token — used only in the sub-label under the amount. */
  tableLabel: string;
  staffId: string;
  customerName?: string | null;
  customerPhone?: string | null;
  onClose: () => void;
  /** Payment recorded — the secondary action (free table / hand over), if the toggle was on, already ran. */
  onCollected: () => void;
  /** Repurposes the toggle for something other than dine-in's free-table. */
  secondaryAction?: CollectSecondaryAction;
}

const splitsSig = (splits: { method: CollectSplitMethod; amount: number }[]) =>
  splits.map(s => `${s.method}:${Number(s.amount).toFixed(2)}`).join('|');

export function CollectPaymentPanel({
  sessionId, orderIds, orderId, amount, tableLabel, staffId, customerName, customerPhone, onClose, onCollected, secondaryAction,
}: CollectPaymentPanelProps) {
  const [method, setMethod] = useState<Method>('CASH');
  const [cashInput, setCashInput] = useState('');
  const [khataPhone, setKhataPhone] = useState((customerPhone ?? '').replace(/\D/g, ''));
  const [khataName, setKhataName] = useState(customerName ?? '');
  const [khataPaidInput, setKhataPaidInput] = useState('');
  const [khataPaidMethod, setKhataPaidMethod] = useState<'CASH' | 'UPI_DIRECT'>('CASH');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Same default/rule as the phone screen's autoFree: on by default, only
  // actually frees once the server confirms nothing's left owed (see confirm()) —
  // or, with `secondaryAction`, whatever the caller's own toggle does instead.
  const [secondaryOn, setSecondaryOn] = useState(true);

  // The sheet (components/ui/BottomSheet) has no explicit height — it just
  // wraps its content, and React Native never animates a layout size change
  // on its own (that needs either LayoutAnimation, a no-op on the web/
  // Electron build this panel only ever renders in, or an animated style).
  // So switching Cash/UPI (no extra fields) to Split/Due (2-3 fields) used to
  // snap the sheet to its new height instead of resizing smoothly. Fix: the
  // variable fields live in an Animated.View whose height we drive by hand,
  // measured once per method via an invisible off-screen copy of each block
  // so the very first switch to it animates too, not just the second.
  const [extraH, setExtraH] = useState<Partial<Record<Method, number>>>({});
  const heightAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const target = method === 'SPLIT' ? extraH.SPLIT ?? 0 : method === 'DUE' ? extraH.DUE ?? 0 : 0;
    Animated.timing(heightAnim, {
      toValue: target, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: false,
    }).start();
  }, [method, extraH, heightAnim]);
  const measure = (key: 'SPLIT' | 'DUE') => (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    setExtraH(prev => (Math.abs((prev[key] ?? -1) - h) < 0.5 ? prev : { ...prev, [key]: h }));
  };

  const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;

  const cashNum = Number(cashInput || 0);
  const upiNum = Math.max(0, amount - cashNum);
  const splitValid = cashNum > 0 && upiNum > 0 && Math.abs(cashNum + upiNum - amount) <= 1;

  const khataPaidNum = Number(khataPaidInput || 0);
  const khataDueAmount = Math.max(0, amount - khataPaidNum);
  const khataPhoneValid = /^[6-9]\d{9}$/.test(khataPhone);
  const khataValid = khataPhoneValid && khataDueAmount > 0 && khataPaidNum >= 0 && khataPaidNum < amount;

  const valid =
    method === 'CASH' || method === 'UPI_DIRECT' ? amount > 0
      : method === 'SPLIT' ? splitValid
      : khataValid;

  const summary =
    method === 'CASH' ? `${rupees(amount)} in cash`
      : method === 'UPI_DIRECT' ? `${rupees(amount)} via UPI`
      : method === 'SPLIT'
        ? (splitValid ? `${rupees(cashNum)} cash + ${rupees(upiNum)} UPI` : 'Enter the cash amount received')
        : khataPhoneValid ? `${rupees(khataDueAmount)} on ${(khataName.trim() || khataPhone)}'s khata`
        : 'Enter a valid 10-digit phone number';

  const confirm = async () => {
    if (!valid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      let splits: { method: CollectSplitMethod; amount: number }[];
      let dueOptions: { customerPhone: string; customerName?: string | null } | null = null;
      if (method === 'CASH') splits = [{ method: 'CASH', amount }];
      else if (method === 'UPI_DIRECT') splits = [{ method: 'UPI_DIRECT', amount }];
      else if (method === 'SPLIT') splits = [{ method: 'CASH', amount: cashNum }, { method: 'UPI_DIRECT', amount: upiNum }];
      else {
        splits = [];
        if (khataPaidNum > 0) splits.push({ method: khataPaidMethod, amount: khataPaidNum });
        splits.push({ method: 'DUE', amount: khataDueAmount });
        dueOptions = { customerPhone: khataPhone, customerName: khataName.trim() || null };
      }
      if (orderId) {
        const idempotencyKey = `crew-collect:${orderId}:${splitsSig(splits)}`;
        await crewPayments.collectPayment(orderId, staffId, splits, idempotencyKey, null, dueOptions);
      } else {
        const idempotencyKey = `crew-collect-session:${sessionId}:${[...(orderIds ?? [])].sort().join(',')}:${splitsSig(splits)}`;
        await crewPayments.collectSessionPayment(sessionId!, orderIds ?? [], staffId, splits, idempotencyKey, null, dueOptions);
      }

      // The toggle's side effect — only when it's on. Best-effort: the
      // payment is already recorded either way, so a failure here just
      // leaves the table/order for staff to free/hand over by hand.
      if (secondaryOn) {
        if (secondaryAction) {
          try { await secondaryAction.run(); } catch { /* best-effort */ }
        } else if (sessionId) {
          // Dine-in default: free the table, but only once the server
          // confirms nothing is left owed on the session.
          try {
            const left = await crewSessions.getCollectible(sessionId);
            if ((left?.data?.orderCount ?? 1) === 0) await crewSessions.end(sessionId);
          } catch { /* best-effort */ }
        }
      }

      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onCollected();
    } catch (err: any) {
      const code = String(err?.code ?? err?.message ?? '');
      setError(
        code.includes('ALREADY_COLLECTED') ? 'This table has already been settled.'
          : code.includes('SESSION_HAS_UNCOLLECTED_ORDERS') || code.includes('STALE_ORDERS')
            ? 'A new order landed on this table — close this and send to collection again.'
            : (err?.message ?? 'Could not record payment. Please try again.'),
      );
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSubmitting(false);
    }
  };

  // Shared between the visible (interactive) block and the invisible
  // off-screen copy that only exists to measure the height to animate to
  // (see extraH above) — one definition so the two can never drift apart.
  const renderSplitFields = (interactive: boolean) => (
    <View style={s.fieldBlock}>
      <Text style={s.fieldLabel}>Cash received</Text>
      <TextInput
        style={s.input}
        value={cashInput}
        onChangeText={interactive ? setCashInput : undefined}
        keyboardType="numeric"
        placeholder="0"
        placeholderTextColor={QuinckleColors.textMuted}
        autoFocus={interactive}
        editable={interactive}
      />
      <Text style={s.hint}>UPI covers the rest — {rupees(upiNum)}</Text>
    </View>
  );

  const renderDueFields = (interactive: boolean) => (
    <View style={s.fieldBlock}>
      <Text style={s.fieldLabel}>Guest phone</Text>
      <TextInput
        style={s.input}
        value={khataPhone}
        onChangeText={interactive ? (v) => setKhataPhone(v.replace(/\D/g, '').slice(0, 10)) : undefined}
        keyboardType="phone-pad"
        placeholder="10-digit number"
        placeholderTextColor={QuinckleColors.textMuted}
        maxLength={10}
        autoFocus={interactive && !khataPhone}
        editable={interactive}
      />
      <Text style={s.fieldLabel}>Guest name (optional)</Text>
      <TextInput
        style={s.input}
        value={khataName}
        onChangeText={interactive ? setKhataName : undefined}
        placeholder="Name"
        placeholderTextColor={QuinckleColors.textMuted}
        editable={interactive}
      />
      <Text style={s.fieldLabel}>Received now (optional)</Text>
      <View style={s.khataPaidRow}>
        <TextInput
          style={[s.input, { flex: 1 }]}
          value={khataPaidInput}
          onChangeText={interactive ? setKhataPaidInput : undefined}
          keyboardType="numeric"
          placeholder="0"
          placeholderTextColor={QuinckleColors.textMuted}
          editable={interactive}
        />
        {(['CASH', 'UPI_DIRECT'] as const).map((pm) => (
          <TouchableOpacity
            key={pm}
            style={[s.miniChip, khataPaidMethod === pm && s.miniChipActive]}
            onPress={interactive ? () => setKhataPaidMethod(pm) : undefined}
            activeOpacity={0.8}
          >
            <Text style={[s.miniChipText, khataPaidMethod === pm && s.miniChipTextActive]}>
              {pm === 'CASH' ? 'Cash' : 'UPI'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={s.hint}>{rupees(khataDueAmount)} goes on khata</Text>
    </View>
  );

  return (
    <View style={s.wrap}>
      <Text style={s.amount}>{rupees(amount)}</Text>
      <Text style={s.sub}>Payable for {tableLabel}</Text>

      <View style={s.methodRow}>
        {METHODS.map((m) => {
          const selected = method === m.key;
          return (
            <TouchableOpacity
              key={m.key}
              style={[s.methodChip, selected && s.methodChipActive]}
              onPress={() => { setMethod(m.key); setError(null); }}
              activeOpacity={0.8}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={m.label}
            >
              <Ionicons name={m.icon} size={18} color={m.tint} />
              <Text style={[s.methodChipText, selected && s.methodChipTextActive]}>{m.label}</Text>
              <View style={{ flex: 1 }} />
              <Ionicons
                name={selected ? 'radio-button-on' : 'radio-button-off'}
                size={18}
                color={selected ? QuinckleColors.primary : QuinckleColors.textMuted}
              />
            </TouchableOpacity>
          );
        })}
      </View>

      <Animated.View style={{ height: heightAnim, overflow: 'hidden' }}>
        {method === 'SPLIT' ? renderSplitFields(true) : method === 'DUE' ? renderDueFields(true) : null}
      </Animated.View>

      {/* Invisible, non-interactive, always mounted — exists only so
          `heightAnim` above has a real number to animate to the FIRST time a
          method is picked, not just on the second visit. */}
      <View style={s.measureLayer} pointerEvents="none" importantForAccessibility="no-hide-descendants">
        <View onLayout={measure('SPLIT')}>{renderSplitFields(false)}</View>
        <View onLayout={measure('DUE')}>{renderDueFields(false)}</View>
      </View>

      <View style={s.summaryRow}>
        <Text style={s.summary} numberOfLines={2}>{summary}</Text>
        <View style={s.freeToggle}>
          <Text style={s.freeToggleLabel}>{secondaryAction?.label ?? 'Free table'}</Text>
          <Switch
            value={secondaryOn}
            onValueChange={setSecondaryOn}
            disabled={submitting}
            trackColor={{ false: QuinckleColors.border, true: QuinckleColors.success }}
            thumbColor="#fff"
            ios_backgroundColor={QuinckleColors.border}
            accessibilityLabel={secondaryAction?.label ?? 'Free table after collection'}
          />
        </View>
      </View>
      {error ? <Text style={s.error}>{error}</Text> : null}

      <View style={s.actions}>
        <TouchableOpacity style={s.cancelBtn} onPress={onClose} disabled={submitting} activeOpacity={0.8}>
          <Text style={s.cancelBtnText}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.confirmBtn, (!valid || submitting) && { opacity: 0.5 }]}
          onPress={() => void confirm()}
          disabled={!valid || submitting}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Confirm and collect"
        >
          {submitting ? <ActivityIndicator size="small" color="#fff" /> : (
            <>
              <Ionicons name="checkmark" size={16} color="#fff" />
              <Text style={s.confirmBtnText}>Confirm & Collect</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.xl, gap: Spacing.md },
  amount: { fontSize: 30, fontWeight: '700', color: QuinckleColors.textPrimary, letterSpacing: -0.5, textAlign: 'center' },
  sub: { ...Typography.caption, color: QuinckleColors.textTertiary, textAlign: 'center', marginTop: -Spacing.xs },
  methodRow: { flexDirection: 'column', gap: Spacing.sm, marginTop: Spacing.sm },
  methodChip: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.md, paddingHorizontal: Spacing.md,
    borderRadius: Radius.md, borderWidth: 1, borderColor: QuinckleColors.border,
    backgroundColor: QuinckleColors.surfaceMuted, gap: Spacing.sm,
  },
  methodChipActive: { borderColor: QuinckleColors.primarySoftBorder, backgroundColor: QuinckleColors.primarySoft },
  methodChipText: { fontSize: 12, fontWeight: '600', color: QuinckleColors.textSecondary },
  methodChipTextActive: { color: QuinckleColors.primary },
  // Rendered off-screen (not just opacity:0 — pulled out of flow entirely so
  // it can't add scroll height or a stray focus ring of its own).
  measureLayer: { position: 'absolute', top: 0, left: 0, right: 0, opacity: 0, zIndex: -1 },
  fieldBlock: { gap: Spacing.xs },
  fieldLabel: {
    fontSize: 11, fontWeight: '600', color: QuinckleColors.textTertiary,
    textTransform: 'uppercase', letterSpacing: 0.4, marginTop: Spacing.xs,
  },
  input: {
    borderWidth: 1, borderColor: QuinckleColors.border, borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, fontSize: 15, fontWeight: '600',
    color: QuinckleColors.textPrimary, backgroundColor: QuinckleColors.surfaceMuted,
  },
  khataPaidRow: { flexDirection: 'row', gap: Spacing.sm },
  miniChip: {
    paddingHorizontal: Spacing.md, borderRadius: Radius.md, borderWidth: 1,
    borderColor: QuinckleColors.border, backgroundColor: QuinckleColors.surfaceMuted,
    alignItems: 'center', justifyContent: 'center',
  },
  miniChipActive: { borderColor: QuinckleColors.primarySoftBorder, backgroundColor: QuinckleColors.primarySoft },
  miniChipText: { fontSize: 12, fontWeight: '600', color: QuinckleColors.textSecondary },
  miniChipTextActive: { color: QuinckleColors.primary },
  hint: { fontSize: 11, fontWeight: '500', color: QuinckleColors.textMuted },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  summary: { flex: 1, fontSize: 13, fontWeight: '600', color: QuinckleColors.textSecondary },
  freeToggle: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, flexShrink: 0 },
  freeToggleLabel: { fontSize: 11, fontWeight: '600', color: QuinckleColors.textTertiary },
  error: { fontSize: 12, fontWeight: '600', color: QuinckleColors.danger, textAlign: 'center' },
  actions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
  cancelBtn: {
    flex: 1, paddingVertical: Spacing.md, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: QuinckleColors.border, backgroundColor: QuinckleColors.surfaceMutedHover,
  },
  cancelBtnText: { ...Typography.bodyStrong, color: QuinckleColors.textPrimary },
  confirmBtn: {
    flex: 2, flexDirection: 'row', gap: Spacing.xs, paddingVertical: Spacing.md, borderRadius: Radius.md,
    alignItems: 'center', justifyContent: 'center', backgroundColor: QuinckleColors.primary,
  },
  confirmBtnText: { ...Typography.bodyStrong, color: '#fff' },
});
