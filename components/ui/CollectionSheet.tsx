/**
 * CollectionSheet — Payment Flow v3 (crew app).
 *
 * Opened from the Payment Collection screen when staff taps "Collect Payment"
 * on a pending row. Two modes inside one sheet:
 *
 *   ONE-TAP MODE (default)
 *     Two big buttons — Cash (full amount) / UPI (full amount).
 *     Tap either → confirm → POST /api/crew/payments/collect with a single split.
 *
 *   SPLIT MODE
 *     Tap the "Split payment" link to swap to dual-input view.
 *     Auto-balance: typing in one field auto-fills the other so the sum always
 *     equals the bill total. Confirm enables only when both > 0.
 *
 * When the UPI button is highlighted (one-tap UPI OR split with UPI > 0),
 * a big QR appears showing the partner's VPA + the relevant UPI amount —
 * the diner scans it from the staff member's phone screen.
 *
 * Strictly Bluetooth-free. No printer dependency. Pure software.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import QRCode from 'react-native-qrcode-svg';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';

interface BillContext {
  orderId: string;
  tableNumber: number;
  customerName: string | null;
  customerPhone: string;
  amount: number; // bill total in rupees
}

interface PartnerUpiInfo {
  vpa: string | null;
  merchantName: string | null;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  bill: BillContext | null;
  partner: PartnerUpiInfo;
  /** Returns true on success so parent can close + refresh. */
  onConfirm: (splits: { method: 'CASH' | 'UPI_DIRECT'; amount: number }[]) => Promise<boolean>;
}

// Build a NPCI-spec-compliant UPI deep link. Spaces must be %20, not "+".
// No mc=5812 (triggers merchant verification → bank rejects for P2P VPAs).
function buildUpiUri(vpa: string, merchantName: string, amount: number): string {
  const enc = (v: string | number) => encodeURIComponent(String(v));
  return `upi://pay?pa=${enc(vpa)}&pn=${enc(merchantName)}&am=${enc(amount.toFixed(2))}&cu=INR`;
}

export function CollectionSheet({ visible, onClose, bill, partner, onConfirm }: Props) {
  type Mode = 'one-tap' | 'split';
  type Hi = 'cash' | 'upi' | null;

  const [mode, setMode]       = useState<Mode>('one-tap');
  const [hi, setHi]           = useState<Hi>(null);           // which side is highlighted (drives QR visibility)
  const [cashAmt, setCashAmt] = useState<string>('');
  const [upiAmt,  setUpiAmt]  = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const total = bill?.amount ?? 0;

  // Reset every time the sheet reopens.
  useEffect(() => {
    if (visible) {
      setMode('one-tap');
      setHi(null);
      setCashAmt('');
      setUpiAmt('');
      setError(null);
      setSubmitting(false);
    }
  }, [visible, bill?.orderId]);

  // ── Auto-balance for split mode ───────────────────────────────────────────
  // Edits to one field auto-fill the other so sum === total. User can still
  // override the other field, which updates the first inversely. We track
  // which field was "last touched" to avoid cyclic re-fires.
  const onCashChange = (raw: string) => {
    const cleaned = raw.replace(/[^\d]/g, '').slice(0, 7);
    setCashAmt(cleaned);
    const n = Number(cleaned);
    if (!Number.isFinite(n)) return;
    const upi = Math.max(0, total - n);
    setUpiAmt(upi > 0 ? String(upi) : '');
  };
  const onUpiChange = (raw: string) => {
    const cleaned = raw.replace(/[^\d]/g, '').slice(0, 7);
    setUpiAmt(cleaned);
    const n = Number(cleaned);
    if (!Number.isFinite(n)) return;
    const cash = Math.max(0, total - n);
    setCashAmt(cash > 0 ? String(cash) : '');
  };

  // Determine which side gets highlighted in split mode (drives QR visibility).
  const splitUpiActive = mode === 'split' && Number(upiAmt) > 0;
  const showQr = (mode === 'one-tap' && hi === 'upi') || splitUpiActive;
  const qrAmount = mode === 'one-tap' ? total : Number(upiAmt || 0);
  const upiUri = useMemo(() => {
    if (!partner.vpa || qrAmount <= 0) return '';
    return buildUpiUri(partner.vpa, partner.merchantName ?? 'Merchant', qrAmount);
  }, [partner.vpa, partner.merchantName, qrAmount]);

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleOneTap = async (method: 'CASH' | 'UPI_DIRECT') => {
    if (!bill || submitting) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setHi(method === 'CASH' ? 'cash' : 'upi');
    setSubmitting(true);
    setError(null);
    try {
      const ok = await onConfirm([{ method, amount: total }]);
      if (!ok) { setHi(null); }
    } catch (e: any) {
      setError(e?.message ?? 'Could not record payment');
      setHi(null);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSplitConfirm = async () => {
    if (!bill || submitting) return;
    const cashN = Number(cashAmt);
    const upiN  = Number(upiAmt);
    if (!cashN || !upiN) { setError('Both amounts must be greater than 0'); return; }
    if (Math.abs(cashN + upiN - total) > 1) {
      setError(`Split must add up to ₹${total}`);
      return;
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSubmitting(true);
    setError(null);
    try {
      const ok = await onConfirm([
        { method: 'CASH', amount: cashN },
        { method: 'UPI_DIRECT', amount: upiN },
      ]);
      if (!ok) { /* parent shows error */ }
    } catch (e: any) {
      setError(e?.message ?? 'Could not record split payment');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenInGpay = () => {
    if (!upiUri) return;
    Linking.openURL(upiUri).catch(() => {});
  };

  if (!bill) return null;

  const splitValid = mode === 'split' && Number(cashAmt) > 0 && Number(upiAmt) > 0 && Math.abs(Number(cashAmt) + Number(upiAmt) - total) <= 1;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => { /* eat */ }}>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {/* Drag handle */}
            <View style={styles.handleWrap}><View style={styles.handle} /></View>

            {/* Header */}
            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                <Text style={styles.eyebrow}>Payment collection</Text>
                <Text style={styles.title}>Table {bill.tableNumber} · ₹{bill.amount.toLocaleString('en-IN')}</Text>
                <Text style={styles.sub}>{bill.customerName ?? 'Guest'} · {bill.customerPhone}</Text>
              </View>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={8}>
                <Ionicons name="close" size={20} color={QuinckleColors.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* QR — only visible when UPI is active in either mode */}
            {showQr && partner.vpa ? (
              <View style={styles.qrCard}>
                <Text style={styles.qrLabel}>Show this to the diner to scan</Text>
                <View style={styles.qrWrap}>
                  <QRCode value={upiUri} size={200} backgroundColor="#ffffff" color="#000000" />
                </View>
                <Text style={styles.qrAmount}>₹{qrAmount.toLocaleString('en-IN')}</Text>
                <Text style={styles.qrVpa}>{partner.vpa}</Text>
                <TouchableOpacity onPress={handleOpenInGpay} style={styles.qrAlt} activeOpacity={0.7}>
                  <Ionicons name="phone-portrait-outline" size={13} color={QuinckleColors.textTertiary} />
                  <Text style={styles.qrAltText}>Or open in any UPI app</Text>
                </TouchableOpacity>
              </View>
            ) : showQr && !partner.vpa ? (
              <View style={styles.qrCardMissing}>
                <Ionicons name="warning-outline" size={20} color={QuinckleColors.warning} />
                <Text style={styles.qrMissingText}>
                  No UPI ID configured. Ask the partner to set their UPI in dashboard → Settings.
                </Text>
              </View>
            ) : null}

            {/* ONE-TAP MODE */}
            {mode === 'one-tap' && (
              <View style={styles.oneTapWrap}>
                <TouchableOpacity
                  onPress={() => handleOneTap('CASH')}
                  disabled={submitting}
                  activeOpacity={0.85}
                  style={[
                    styles.bigBtn,
                    styles.cashBtn,
                    hi === 'cash' && styles.bigBtnActive,
                  ]}
                >
                  <View style={styles.bigBtnIcon}>
                    <Ionicons name="cash-outline" size={24} color="#fff" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.bigBtnLabel}>Cash</Text>
                    <Text style={styles.bigBtnAmount}>₹{total.toLocaleString('en-IN')}</Text>
                  </View>
                  {submitting && hi === 'cash' ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.6)" />
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => handleOneTap('UPI_DIRECT')}
                  disabled={submitting || !partner.vpa}
                  activeOpacity={0.85}
                  style={[
                    styles.bigBtn,
                    styles.upiBtn,
                    hi === 'upi' && styles.bigBtnActive,
                    !partner.vpa && styles.bigBtnDisabled,
                  ]}
                >
                  <View style={[styles.bigBtnIcon, { backgroundColor: 'rgba(255,255,255,0.18)' }]}>
                    <Ionicons name="qr-code-outline" size={24} color="#fff" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.bigBtnLabel}>UPI</Text>
                    <Text style={styles.bigBtnAmount}>₹{total.toLocaleString('en-IN')}</Text>
                  </View>
                  {submitting && hi === 'upi' ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.6)" />
                  )}
                </TouchableOpacity>

                {/* Toggle UPI highlight (shows QR without confirming) */}
                {partner.vpa && (
                  <TouchableOpacity
                    onPress={() => setHi(hi === 'upi' ? null : 'upi')}
                    activeOpacity={0.7}
                    style={styles.tapForQr}
                  >
                    <Text style={styles.tapForQrText}>
                      {hi === 'upi' ? 'Hide QR' : 'Show UPI QR before confirming'}
                    </Text>
                  </TouchableOpacity>
                )}

                <View style={styles.divider}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>or</Text>
                  <View style={styles.dividerLine} />
                </View>

                <TouchableOpacity
                  onPress={() => { setMode('split'); setHi(null); setError(null); }}
                  activeOpacity={0.7}
                  style={styles.splitBtn}
                >
                  <Ionicons name="git-network-outline" size={16} color={QuinckleColors.primary} />
                  <Text style={styles.splitBtnText}>Split payment</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* SPLIT MODE */}
            {mode === 'split' && (
              <View style={styles.splitWrap}>
                <View style={styles.splitInputRow}>
                  <View style={styles.splitInputBlock}>
                    <Text style={styles.splitInputLabel}>
                      <Ionicons name="cash-outline" size={12} color={QuinckleColors.textSecondary} /> Cash
                    </Text>
                    <View style={styles.splitInputField}>
                      <Text style={styles.splitInputRupee}>₹</Text>
                      <TextInput
                        value={cashAmt}
                        onChangeText={onCashChange}
                        keyboardType="number-pad"
                        placeholder="0"
                        placeholderTextColor={QuinckleColors.textTertiary}
                        style={styles.splitInput}
                      />
                    </View>
                  </View>

                  <View style={styles.splitInputBlock}>
                    <Text style={styles.splitInputLabel}>
                      <Ionicons name="qr-code-outline" size={12} color={QuinckleColors.textSecondary} /> UPI
                    </Text>
                    <View style={styles.splitInputField}>
                      <Text style={styles.splitInputRupee}>₹</Text>
                      <TextInput
                        value={upiAmt}
                        onChangeText={onUpiChange}
                        keyboardType="number-pad"
                        placeholder="0"
                        placeholderTextColor={QuinckleColors.textTertiary}
                        style={styles.splitInput}
                        editable={!!partner.vpa}
                      />
                    </View>
                  </View>
                </View>

                <View style={styles.splitTotalRow}>
                  <Text style={styles.splitTotalLabel}>Total</Text>
                  <Text style={styles.splitTotalValue}>
                    ₹{(Number(cashAmt || 0) + Number(upiAmt || 0)).toLocaleString('en-IN')}
                    <Text style={styles.splitTotalExpected}> / ₹{total.toLocaleString('en-IN')}</Text>
                  </Text>
                </View>

                <TouchableOpacity
                  onPress={handleSplitConfirm}
                  disabled={!splitValid || submitting}
                  activeOpacity={0.85}
                  style={[styles.confirmBtn, (!splitValid || submitting) && styles.confirmBtnDisabled]}
                >
                  {submitting ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <>
                      <Ionicons name="checkmark-circle" size={16} color="#fff" />
                      <Text style={styles.confirmBtnText}>Confirm split</Text>
                    </>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => { setMode('one-tap'); setHi(null); setError(null); setCashAmt(''); setUpiAmt(''); }}
                  activeOpacity={0.7}
                  style={styles.backToOneTap}
                >
                  <Ionicons name="arrow-back" size={13} color={QuinckleColors.textTertiary} />
                  <Text style={styles.backToOneTapText}>Back to one-tap</Text>
                </TouchableOpacity>
              </View>
            )}

            {error && (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={14} color={QuinckleColors.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <View style={{ height: Spacing.huge }} />
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: QuinckleColors.background,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    maxHeight: '92%',
    paddingTop: Spacing.xs,
  },
  handleWrap: { alignItems: 'center', paddingVertical: Spacing.sm },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: QuinckleColors.borderStrong },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: QuinckleColors.border,
  },
  eyebrow: {
    color: QuinckleColors.textTertiary,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 2,
  },
  title: {
    color: QuinckleColors.textPrimary,
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  sub: {
    color: QuinckleColors.textSecondary,
    fontSize: 12,
    marginTop: 2,
  },
  closeBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: QuinckleColors.surfaceMuted,
    alignItems: 'center', justifyContent: 'center',
  },

  qrCard: {
    margin: Spacing.lg,
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    backgroundColor: QuinckleColors.surface,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    alignItems: 'center',
  },
  qrLabel: {
    color: QuinckleColors.textTertiary,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: Spacing.md,
  },
  qrWrap: {
    padding: Spacing.md,
    backgroundColor: '#ffffff',
    borderRadius: Radius.md,
  },
  qrAmount: {
    color: QuinckleColors.textPrimary,
    fontSize: 22,
    fontWeight: '700',
    marginTop: Spacing.md,
    letterSpacing: -0.3,
  },
  qrVpa: {
    color: QuinckleColors.textSecondary,
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginTop: 2,
  },
  qrAlt: {
    marginTop: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: Radius.pill,
    backgroundColor: QuinckleColors.surfaceMuted,
  },
  qrAltText: { color: QuinckleColors.textTertiary, fontSize: 11, fontWeight: '600' },
  qrCardMissing: {
    margin: Spacing.lg,
    padding: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: QuinckleColors.warningSoft,
    borderWidth: 1,
    borderColor: QuinckleColors.warningBorder,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  qrMissingText: { color: QuinckleColors.warning, fontSize: 12, flex: 1, lineHeight: 17 },

  oneTapWrap: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    gap: Spacing.md,
  },
  bigBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.lg,
    gap: Spacing.md,
    borderWidth: 1,
  },
  bigBtnActive: { transform: [{ scale: 0.98 }], opacity: 0.92 },
  bigBtnDisabled: { opacity: 0.4 },
  cashBtn: {
    backgroundColor: '#2e7d32',
    borderColor: '#2e7d32',
  },
  upiBtn: {
    backgroundColor: '#3b82f6',
    borderColor: '#3b82f6',
  },
  bigBtnIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  bigBtnLabel: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  bigBtnAmount: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: -0.4,
    marginTop: 2,
  },
  tapForQr: {
    alignSelf: 'center',
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.md,
  },
  tapForQrText: {
    color: QuinckleColors.textTertiary,
    fontSize: 11.5,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },

  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: QuinckleColors.border },
  dividerText: { color: QuinckleColors.textTertiary, fontSize: 10, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 },

  splitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: QuinckleColors.primarySoft,
    borderWidth: 1,
    borderColor: QuinckleColors.primarySoftBorder,
  },
  splitBtnText: { color: QuinckleColors.primary, fontSize: 13, fontWeight: '700', letterSpacing: 0.2 },

  splitWrap: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    gap: Spacing.md,
  },
  splitInputRow: { flexDirection: 'row', gap: Spacing.md },
  splitInputBlock: { flex: 1 },
  splitInputLabel: {
    color: QuinckleColors.textSecondary,
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 6,
  },
  splitInputField: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: QuinckleColors.surface,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    height: 54,
  },
  splitInputRupee: {
    color: QuinckleColors.textSecondary,
    fontSize: 20,
    fontWeight: '500',
    marginRight: 4,
  },
  splitInput: {
    flex: 1,
    color: QuinckleColors.textPrimary,
    fontSize: 22,
    fontWeight: '700',
    padding: 0,
    letterSpacing: -0.4,
  },
  splitTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: QuinckleColors.surfaceMuted,
  },
  splitTotalLabel: { color: QuinckleColors.textSecondary, fontSize: 12, fontWeight: '600' },
  splitTotalValue: {
    color: QuinckleColors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  splitTotalExpected: {
    color: QuinckleColors.textTertiary,
    fontSize: 13,
    fontWeight: '500',
  },
  confirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: QuinckleColors.primary,
  },
  confirmBtnDisabled: { opacity: 0.4 },
  confirmBtnText: { color: '#fff', fontSize: 14, fontWeight: '700', letterSpacing: 0.2 },
  backToOneTap: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
  },
  backToOneTapText: { color: QuinckleColors.textTertiary, fontSize: 11.5, fontWeight: '600' },

  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: QuinckleColors.dangerSoft,
    borderWidth: 1,
    borderColor: QuinckleColors.dangerBorder,
  },
  errorText: { color: QuinckleColors.danger, fontSize: 12, flex: 1, lineHeight: 17 },
});
