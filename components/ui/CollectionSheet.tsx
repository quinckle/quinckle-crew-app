/**
 * CollectionSheet — Payment Flow v3 (crew app).
 *
 * TWO MODES inside one bottom sheet:
 *
 *   ONE-TAP — two big gradient buttons (Cash / UPI full amount).
 *              Tap → haptic → spring press-down → POST /crew/payments/collect.
 *
 *   SPLIT   — dual-input view. Typing one field auto-fills the other so the
 *              sum always equals the bill total. Auto-filled field flashes its
 *              accent colour as a visual cue. Confirm enables only when exact.
 *
 * Mode switching uses a 350ms opacity cross-fade. The QR card springs in/out
 * instead of popping. Button presses use spring scale (0.95 on press, snap back).
 *
 * UPI link format: NPCI-spec, no mc= param (triggers merchant verification on
 * P2P VPAs → bank rejects). Spaces encoded as %20, not "+".
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
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
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import QRCode from 'react-native-qrcode-svg';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';

interface BillContext {
  orderId: string;
  tableNumber: number;
  customerName: string | null;
  customerPhone: string;
  amount: number;
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
  onConfirm: (splits: { method: 'CASH' | 'UPI_DIRECT'; amount: number }[]) => Promise<boolean>;
}

function buildUpiUri(vpa: string, merchantName: string, amount: number): string {
  const enc = (v: string | number) => encodeURIComponent(String(v));
  return `upi://pay?pa=${enc(vpa)}&pn=${enc(merchantName)}&am=${enc(amount.toFixed(2))}&cu=INR`;
}

export function CollectionSheet({ visible, onClose, bill, partner, onConfirm }: Props) {
  type Mode = 'one-tap' | 'split';
  type Hi = 'cash' | 'upi' | null;

  // ── Core state ──────────────────────────────────────────────────────────────
  const [mode, setMode]       = useState<Mode>('one-tap');
  const [hi, setHi]           = useState<Hi>(null);
  const [cashAmt, setCashAmt] = useState('');
  const [upiAmt,  setUpiAmt]  = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  // Input focus state (drives animated border colour)
  const [cashFocused, setCashFocused] = useState(false);
  const [upiFocused,  setUpiFocused]  = useState(false);

  // Lagged display states so animated elements can fade out before unmounting
  const [displayedError, setDisplayedError] = useState<string | null>(null);
  const [qrVisible, setQrVisible]           = useState(false);

  const total = bill?.amount ?? 0;

  // ── Animation refs ──────────────────────────────────────────────────────────
  const contentOpacity = useRef(new Animated.Value(1)).current;   // mode cross-fade
  const qrAnim         = useRef(new Animated.Value(0)).current;   // QR spring in/out
  const errorOpacity   = useRef(new Animated.Value(0)).current;   // error fade
  const cashScale      = useRef(new Animated.Value(1)).current;   // Cash button press
  const upiScale       = useRef(new Animated.Value(1)).current;   // UPI  button press
  const confirmScale   = useRef(new Animated.Value(1)).current;   // Confirm button press
  // Auto-balance flash (non-native driver — drives backgroundColor)
  const cashFillAnim   = useRef(new Animated.Value(0)).current;
  const upiFillAnim    = useRef(new Animated.Value(0)).current;

  // ── Reset on each open ──────────────────────────────────────────────────────
  useEffect(() => {
    if (visible) {
      setMode('one-tap');
      setHi(null);
      setCashAmt('');
      setUpiAmt('');
      setError(null);
      setSubmitting(false);
      setCashFocused(false);
      setUpiFocused(false);
      contentOpacity.setValue(1);
      qrAnim.setValue(0);
      setQrVisible(false);
      errorOpacity.setValue(0);
      setDisplayedError(null);
      cashScale.setValue(1);
      upiScale.setValue(1);
      cashFillAnim.setValue(0);
      upiFillAnim.setValue(0);
    }
  }, [visible, bill?.orderId]);

  // ── QR card spring in/out ───────────────────────────────────────────────────
  const showQr = (mode === 'one-tap' && hi === 'upi') || (mode === 'split' && Number(upiAmt) > 0);

  useEffect(() => {
    if (showQr) {
      setQrVisible(true);
      Animated.spring(qrAnim, { toValue: 1, damping: 22, stiffness: 220, useNativeDriver: true }).start();
    } else {
      Animated.spring(qrAnim, { toValue: 0, damping: 22, stiffness: 220, useNativeDriver: true })
        .start(({ finished }) => { if (finished) setQrVisible(false); });
    }
  }, [showQr]);

  // ── Error fade in/out ───────────────────────────────────────────────────────
  useEffect(() => {
    if (error) {
      setDisplayedError(error);
      Animated.timing(errorOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    } else {
      Animated.timing(errorOpacity, { toValue: 0, duration: 150, useNativeDriver: true })
        .start(({ finished }) => { if (finished) setDisplayedError(null); });
    }
  }, [error]);

  // ── Mode cross-fade helpers ──────────────────────────────────────────────────
  const switchToSplit = () => {
    Animated.timing(contentOpacity, { toValue: 0, duration: 150, useNativeDriver: true })
      .start(() => {
        setMode('split');
        setCashAmt('');
        setUpiAmt('');
        setError(null);
        Animated.timing(contentOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      });
  };

  const switchToOneTap = () => {
    Animated.timing(contentOpacity, { toValue: 0, duration: 150, useNativeDriver: true })
      .start(() => {
        setMode('one-tap');
        setHi(null);
        setError(null);
        setCashAmt('');
        setUpiAmt('');
        Animated.timing(contentOpacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      });
  };

  // ── Button press spring helpers ──────────────────────────────────────────────
  const pressIn = (anim: Animated.Value) => {
    Animated.spring(anim, { toValue: 0.95, damping: 20, stiffness: 400, useNativeDriver: true }).start();
  };
  const pressOut = (anim: Animated.Value) => {
    Animated.spring(anim, { toValue: 1, damping: 15, stiffness: 200, useNativeDriver: true }).start();
  };

  // ── Auto-balance ─────────────────────────────────────────────────────────────
  const flashField = (anim: Animated.Value) => {
    anim.setValue(0);
    Animated.sequence([
      Animated.timing(anim, { toValue: 1, duration: 100, useNativeDriver: false }),
      Animated.timing(anim, { toValue: 0, duration: 350, useNativeDriver: false }),
    ]).start();
  };

  const onCashChange = (raw: string) => {
    const cleaned = raw.replace(/[^\d]/g, '').slice(0, 7);
    setCashAmt(cleaned);
    const n = Number(cleaned);
    if (!Number.isFinite(n)) return;
    const upi = Math.max(0, total - n);
    setUpiAmt(upi > 0 ? String(upi) : '');
    if (cleaned) flashField(upiFillAnim);
  };

  const onUpiChange = (raw: string) => {
    const cleaned = raw.replace(/[^\d]/g, '').slice(0, 7);
    setUpiAmt(cleaned);
    const n = Number(cleaned);
    if (!Number.isFinite(n)) return;
    const cash = Math.max(0, total - n);
    setCashAmt(cash > 0 ? String(cash) : '');
    if (cleaned) flashField(cashFillAnim);
  };

  // ── Split total status ───────────────────────────────────────────────────────
  const cashN = Number(cashAmt || 0);
  const upiN  = Number(upiAmt  || 0);
  const remaining = total - cashN - upiN;
  const hasBothFields = cashAmt.length > 0 || upiAmt.length > 0;
  const totalStatusText = !hasBothFields
    ? `₹${total.toLocaleString('en-IN')}`
    : remaining === 0
    ? '✓ Exact'
    : remaining > 0
    ? `₹${remaining.toLocaleString('en-IN')} remaining`
    : `₹${Math.abs(remaining).toLocaleString('en-IN')} over`;
  const totalStatusColor = !hasBothFields
    ? QuinckleColors.textTertiary
    : remaining === 0
    ? QuinckleColors.success
    : remaining > 0
    ? QuinckleColors.warning
    : QuinckleColors.danger;

  // ── QR URI ───────────────────────────────────────────────────────────────────
  const qrAmount = mode === 'one-tap' ? total : upiN;
  const upiUri = useMemo(() => {
    if (!partner.vpa || qrAmount <= 0) return '';
    return buildUpiUri(partner.vpa, partner.merchantName ?? 'Merchant', qrAmount);
  }, [partner.vpa, partner.merchantName, qrAmount]);

  // ── Submit handlers ──────────────────────────────────────────────────────────
  const handleOneTap = async (method: 'CASH' | 'UPI_DIRECT') => {
    if (!bill || submitting) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setHi(method === 'CASH' ? 'cash' : 'upi');
    setSubmitting(true);
    setError(null);
    try {
      const ok = await onConfirm([{ method, amount: total }]);
      if (ok) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        setHi(null);
      }
    } catch (e: any) {
      setError(e?.message ?? 'Could not record payment');
      setHi(null);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSplitConfirm = async () => {
    if (!bill || submitting) return;
    if (!cashN || !upiN) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      setError('Both amounts must be greater than 0');
      return;
    }
    if (Math.abs(cashN + upiN - total) > 1) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      setError(`Split must add up to ₹${total}`);
      return;
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm([
        { method: 'CASH',       amount: cashN },
        { method: 'UPI_DIRECT', amount: upiN  },
      ]);
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

  const splitValid = mode === 'split' && cashN > 0 && upiN > 0 && Math.abs(cashN + upiN - total) <= 1;

  // Animated style for auto-balance flash on cash input field
  const cashFieldBg = cashFillAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [QuinckleColors.surface, 'rgba(22,163,74,0.18)'],
  });
  // Animated style for auto-balance flash on UPI input field
  const upiFieldBg = upiFillAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [QuinckleColors.surface, 'rgba(59,130,246,0.18)'],
  });

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => { /* eat touches */ }}>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

            {/* Drag handle */}
            <View style={styles.handleWrap}><View style={styles.handle} /></View>

            {/* ── Header ── */}
            <View style={styles.header}>
              <View style={{ flex: 1 }}>
                <View style={styles.headerChip}>
                  <Ionicons name="restaurant-outline" size={11} color={QuinckleColors.primary} />
                  <Text style={styles.headerChipText}>Table {bill.tableNumber}</Text>
                </View>
                <Text style={styles.title}>₹{bill.amount.toLocaleString('en-IN')}</Text>
                <Text style={styles.sub}>{bill.customerName ?? 'Guest'} · {bill.customerPhone}</Text>
              </View>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={8}>
                <Ionicons name="close" size={20} color={QuinckleColors.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* ── QR Card (spring in/out) ── */}
            {qrVisible && (
              <Animated.View style={[
                styles.qrCard,
                !partner.vpa && styles.qrCardMissingContainer,
                {
                  opacity: qrAnim,
                  transform: [{ scale: qrAnim.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1] }) }],
                },
              ]}>
                {partner.vpa && upiUri ? (
                  <>
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
                  </>
                ) : !partner.vpa ? (
                  <>
                    <Ionicons name="warning-outline" size={20} color={QuinckleColors.warning} />
                    <Text style={styles.qrMissingText}>
                      No UPI ID configured. Ask the partner to set their UPI in Settings.
                    </Text>
                  </>
                ) : null}
              </Animated.View>
            )}

            {/* ── Mode content (cross-fades on switch) ── */}
            <Animated.View style={{ opacity: contentOpacity }}>

              {/* ONE-TAP MODE */}
              {mode === 'one-tap' && (
                <View style={styles.oneTapWrap}>

                  {/* Cash button */}
                  <Pressable
                    onPress={() => handleOneTap('CASH')}
                    onPressIn={() => pressIn(cashScale)}
                    onPressOut={() => pressOut(cashScale)}
                    disabled={submitting}
                  >
                    <Animated.View style={{ transform: [{ scale: cashScale }] }}>
                      <LinearGradient
                        colors={['#16a34a', '#15803d']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 0, y: 1 }}
                        style={[styles.bigBtn, styles.cashBtn]}
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
                        ) : hi === 'cash' ? (
                          <Ionicons name="checkmark" size={22} color="rgba(255,255,255,0.9)" />
                        ) : (
                          <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.55)" />
                        )}
                      </LinearGradient>
                    </Animated.View>
                  </Pressable>

                  {/* UPI button */}
                  <Pressable
                    onPress={() => handleOneTap('UPI_DIRECT')}
                    onPressIn={() => pressIn(upiScale)}
                    onPressOut={() => pressOut(upiScale)}
                    disabled={submitting || !partner.vpa}
                  >
                    <Animated.View style={[
                      { transform: [{ scale: upiScale }] },
                      !partner.vpa && styles.bigBtnDisabled,
                    ]}>
                      <LinearGradient
                        colors={['#3b82f6', '#2563eb']}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 0, y: 1 }}
                        style={[styles.bigBtn, styles.upiBtn]}
                      >
                        <View style={[styles.bigBtnIcon, { backgroundColor: 'rgba(255,255,255,0.15)' }]}>
                          <Ionicons name="qr-code-outline" size={24} color="#fff" />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.bigBtnLabel}>UPI</Text>
                          <Text style={styles.bigBtnAmount}>₹{total.toLocaleString('en-IN')}</Text>
                        </View>
                        {submitting && hi === 'upi' ? (
                          <ActivityIndicator color="#fff" />
                        ) : hi === 'upi' ? (
                          <Ionicons name="checkmark" size={22} color="rgba(255,255,255,0.9)" />
                        ) : (
                          <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.55)" />
                        )}
                      </LinearGradient>
                    </Animated.View>
                  </Pressable>

                  {/* Show/hide QR toggle */}
                  {partner.vpa && (
                    <TouchableOpacity
                      onPress={() => {
                        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setHi(hi === 'upi' ? null : 'upi');
                      }}
                      activeOpacity={0.8}
                      style={[styles.tapForQr, hi === 'upi' && styles.tapForQrActive]}
                    >
                      <Ionicons
                        name={hi === 'upi' ? 'eye-off-outline' : 'qr-code-outline'}
                        size={13}
                        color={hi === 'upi' ? QuinckleColors.primary : QuinckleColors.textTertiary}
                      />
                      <Text style={[styles.tapForQrText, hi === 'upi' && styles.tapForQrTextActive]}>
                        {hi === 'upi' ? 'Hide QR' : 'Show UPI QR before confirming'}
                      </Text>
                    </TouchableOpacity>
                  )}

                  {/* Split payment button */}
                  <TouchableOpacity
                    onPress={() => {
                      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      switchToSplit();
                    }}
                    activeOpacity={0.8}
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

                    {/* Cash input */}
                    <View style={styles.splitInputBlock}>
                      <Text style={styles.splitInputLabel}>
                        <Ionicons name="cash-outline" size={12} color={QuinckleColors.textSecondary} /> Cash
                      </Text>
                      <Animated.View style={[
                        styles.splitInputField,
                        { borderColor: cashFocused ? QuinckleColors.primary : QuinckleColors.border },
                        { backgroundColor: cashFieldBg },
                      ]}>
                        <Text style={styles.splitInputRupee}>₹</Text>
                        <TextInput
                          value={cashAmt}
                          onChangeText={onCashChange}
                          onFocus={() => setCashFocused(true)}
                          onBlur={() => setCashFocused(false)}
                          keyboardType="number-pad"
                          placeholder="0"
                          placeholderTextColor={QuinckleColors.textTertiary}
                          style={styles.splitInput}
                        />
                      </Animated.View>
                    </View>

                    {/* UPI input */}
                    <View style={styles.splitInputBlock}>
                      <Text style={styles.splitInputLabel}>
                        <Ionicons name="qr-code-outline" size={12} color={QuinckleColors.textSecondary} /> UPI
                      </Text>
                      <Animated.View style={[
                        styles.splitInputField,
                        { borderColor: upiFocused ? QuinckleColors.info : QuinckleColors.border },
                        { backgroundColor: upiFieldBg },
                      ]}>
                        <Text style={styles.splitInputRupee}>₹</Text>
                        <TextInput
                          value={upiAmt}
                          onChangeText={onUpiChange}
                          onFocus={() => setUpiFocused(true)}
                          onBlur={() => setUpiFocused(false)}
                          keyboardType="number-pad"
                          placeholder="0"
                          placeholderTextColor={QuinckleColors.textTertiary}
                          style={styles.splitInput}
                          editable={!!partner.vpa}
                        />
                      </Animated.View>
                    </View>
                  </View>

                  {/* Color-coded total row */}
                  <View style={styles.splitTotalRow}>
                    <Text style={styles.splitTotalLabel}>Total</Text>
                    <Text style={[styles.splitTotalValue, { color: totalStatusColor }]}>
                      {totalStatusText}
                    </Text>
                  </View>

                  {/* Confirm split button */}
                  <Pressable
                    onPress={handleSplitConfirm}
                    onPressIn={() => pressIn(confirmScale)}
                    onPressOut={() => pressOut(confirmScale)}
                    disabled={!splitValid || submitting}
                  >
                    <Animated.View style={[
                      styles.confirmBtn,
                      (!splitValid || submitting) && styles.confirmBtnDisabled,
                      { transform: [{ scale: confirmScale }] },
                    ]}>
                      {submitting ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <>
                          <Ionicons name="checkmark-circle" size={16} color="#fff" />
                          <Text style={styles.confirmBtnText}>Confirm split</Text>
                        </>
                      )}
                    </Animated.View>
                  </Pressable>

                  {/* Back to one-tap */}
                  <TouchableOpacity
                    onPress={switchToOneTap}
                    activeOpacity={0.7}
                    style={styles.backToOneTap}
                  >
                    <Ionicons name="arrow-back" size={13} color={QuinckleColors.textSecondary} />
                    <Text style={styles.backToOneTapText}>Back to one-tap</Text>
                  </TouchableOpacity>
                </View>
              )}

            </Animated.View>
            {/* end mode content */}

            {/* ── Error (fades in/out) ── */}
            {displayedError && (
              <Animated.View style={[styles.errorBox, { opacity: errorOpacity }]}>
                <Ionicons name="alert-circle" size={14} color={QuinckleColors.danger} />
                <Text style={styles.errorText}>{displayedError}</Text>
              </Animated.View>
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
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: QuinckleColors.background,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    maxHeight: '92%',
    paddingTop: Spacing.sm,
  },
  handleWrap: { alignItems: 'center', paddingVertical: Spacing.md },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: QuinckleColors.borderStrong },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: QuinckleColors.border,
  },
  headerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: QuinckleColors.primarySoft,
    borderWidth: 1,
    borderColor: QuinckleColors.primarySoftBorder,
    borderRadius: Radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'flex-start',
    marginBottom: Spacing.sm,
  },
  headerChipText: {
    color: QuinckleColors.primary,
    fontSize: 11,
    fontWeight: '700',
  },
  title: {
    color: QuinckleColors.textPrimary,
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  sub: {
    color: QuinckleColors.textSecondary,
    fontSize: 12,
    marginTop: 3,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: QuinckleColors.surfaceMuted,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },

  // QR Card
  qrCard: {
    margin: Spacing.lg,
    padding: Spacing.lg,
    borderRadius: Radius.lg,
    backgroundColor: QuinckleColors.surface,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    alignItems: 'center',
  },
  qrCardMissingContainer: {
    flexDirection: 'row',
    backgroundColor: QuinckleColors.warningSoft,
    borderColor: QuinckleColors.warningBorder,
    alignItems: 'center',
    gap: Spacing.sm,
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
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
    backgroundColor: QuinckleColors.surfaceMuted,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
  },
  qrAltText: { color: QuinckleColors.textTertiary, fontSize: 11, fontWeight: '600' },
  qrMissingText: { color: QuinckleColors.warning, fontSize: 12, flex: 1, lineHeight: 17 },

  // One-tap mode
  oneTapWrap: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.md,
    gap: Spacing.lg,
  },
  bigBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.lg,
    gap: Spacing.md,
    borderWidth: 1,
  },
  bigBtnDisabled: { opacity: 0.4 },
  cashBtn: {
    borderColor: 'rgba(134,239,172,0.25)',
  },
  upiBtn: {
    borderColor: 'rgba(147,197,253,0.25)',
  },
  bigBtnIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigBtnLabel: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    opacity: 0.85,
  },
  bigBtnAmount: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginTop: 1,
  },
  tapForQr: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'center',
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
  },
  tapForQrActive: {
    borderColor: QuinckleColors.primarySoftBorder,
    backgroundColor: QuinckleColors.primarySoft,
  },
  tapForQrText: {
    color: QuinckleColors.textTertiary,
    fontSize: 12,
    fontWeight: '600',
  },
  tapForQrTextActive: {
    color: QuinckleColors.primary,
  },
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
  splitBtnText: {
    color: QuinckleColors.primary,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
  },

  // Split mode
  splitWrap: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.md,
    gap: Spacing.lg,
  },
  splitInputRow: {
    flexDirection: 'row',
    gap: Spacing.lg,
  },
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
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    borderWidth: 1.5,
    height: 60,
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
    alignItems: 'center',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: QuinckleColors.surfaceMuted,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
  },
  splitTotalLabel: {
    color: QuinckleColors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  splitTotalValue: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.1,
  },
  confirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: QuinckleColors.primary,
  },
  confirmBtnDisabled: { opacity: 0.4 },
  confirmBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  backToOneTap: {
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  backToOneTapText: {
    color: QuinckleColors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },

  // Error
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: QuinckleColors.dangerSoft,
    borderWidth: 1,
    borderColor: QuinckleColors.dangerBorder,
  },
  errorText: {
    color: QuinckleColors.danger,
    fontSize: 12,
    flex: 1,
    lineHeight: 17,
  },
});
