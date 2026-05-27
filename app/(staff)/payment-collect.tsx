import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import QRCode from 'react-native-qrcode-svg';
import { useAuth } from '../../context/AuthContext';
import { crewPayments, restaurantApi } from '../../services/api';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';

function buildUpiUri(vpa: string, merchantName: string, amount: number): string {
  const enc = (v: string | number) => encodeURIComponent(String(v));
  return `upi://pay?pa=${enc(vpa)}&pn=${enc(merchantName)}&am=${enc(amount.toFixed(2))}&cu=INR`;
}

type Mode = 'normal' | 'split';
type Step = 'choose' | 'confirm_cash';
type SuccessInfo = {
  tableNumber: number;
  total: number;
  splits: { method: 'CASH' | 'UPI_DIRECT'; amount: number }[];
};

// ── Shimmer (matches TableSkeleton) ─────────────────────────────────────────
const SHIMMER_DURATION = 1500;
const SWEEP = 260;

function useShimmerTx() {
  const p = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(p, { toValue: 1, duration: SHIMMER_DURATION, easing: Easing.inOut(Easing.ease), useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, []);
  return p.interpolate({ inputRange: [0, 1], outputRange: [-SWEEP, SWEEP] });
}

function ShimmerBlock({ width, height, radius = 6, style, tx }: {
  width: number | `${number}%`; height: number; radius?: number; style?: object;
  tx: Animated.AnimatedInterpolation<number>;
}) {
  return (
    <View style={[{ width, height, borderRadius: radius, backgroundColor: 'rgba(255,255,255,0.045)', overflow: 'hidden' }, style]}>
      <Animated.View style={[StyleSheet.absoluteFillObject, { transform: [{ translateX: tx }] }]}>
        <LinearGradient
          colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.05)', 'rgba(255,255,255,0.11)', 'rgba(255,255,255,0.05)', 'rgba(255,255,255,0)']}
          locations={[0, 0.35, 0.5, 0.65, 1]}
          start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </View>
  );
}

function QrSkeleton({ size }: { size: number }) {
  const tx = useShimmerTx();
  return (
    <View style={{ alignItems: 'center', gap: 16, paddingVertical: Spacing.xl }}>
      <ShimmerBlock tx={tx} width={120} height={9} radius={4} />
      <View style={{ padding: 16, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: Radius.md }}>
        <ShimmerBlock tx={tx} width={size} height={size} radius={4} />
      </View>
      <ShimmerBlock tx={tx} width={72} height={20} radius={4} />
      <ShimmerBlock tx={tx} width={160} height={9} radius={4} />
    </View>
  );
}

// ── Success screen ───────────────────────────────────────────────────────────
function SuccessScreen({ info, onDone }: { info: SuccessInfo; onDone: () => void }) {
  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const riseAnim  = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 260, useNativeDriver: true }),
      Animated.timing(riseAnim, { toValue: 0, duration: 340, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
    const t = setTimeout(onDone, 2400);
    return () => clearTimeout(t);
  }, []);

  const cashSplit = info.splits.find(s => s.method === 'CASH');
  const upiSplit  = info.splits.find(s => s.method === 'UPI_DIRECT');
  const isSplit   = !!(cashSplit && upiSplit);
  const isUpiOnly = !cashSplit && !!upiSplit;

  return (
    <Animated.View style={[sc.screen, { opacity: fadeAnim }]}>
      <Animated.View style={[sc.body, { transform: [{ translateY: riseAnim }] }]}>
        {/* Check icon */}
        <View style={sc.iconWrap}>
          <Ionicons name="checkmark" size={56} color="#fff" />
        </View>

        <Text style={sc.title}>Collected</Text>
        <Text style={sc.table}>Table {info.tableNumber}</Text>
        <Text style={sc.amount}>₹{info.total.toLocaleString('en-IN')}</Text>

        <View style={sc.divider} />

        {/* Method breakdown */}
        {isSplit ? (
          <View style={sc.methodRow}>
            <View style={sc.methodItem}>
              <Text style={sc.methodAmt}>₹{cashSplit!.amount.toLocaleString('en-IN')}</Text>
              <Text style={sc.methodLabel}>Cash</Text>
            </View>
            <View style={sc.methodSep} />
            <View style={sc.methodItem}>
              <Text style={sc.methodAmt}>₹{upiSplit!.amount.toLocaleString('en-IN')}</Text>
              <Text style={sc.methodLabel}>UPI</Text>
            </View>
          </View>
        ) : (
          <Text style={sc.methodSingle}>{isUpiOnly ? 'via UPI' : 'via Cash'}</Text>
        )}
      </Animated.View>
    </Animated.View>
  );
}

const sc = StyleSheet.create({
  screen: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#1a7a3a',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 999,
  },
  body: { alignItems: 'center', paddingHorizontal: 40 },
  iconWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
  },
  title: {
    color: '#fff',
    fontSize: 34,
    fontWeight: '700',
    letterSpacing: -0.8,
    marginBottom: 6,
  },
  table: {
    color: 'rgba(255,255,255,0.65)',
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 12,
  },
  amount: {
    color: '#fff',
    fontSize: 52,
    fontWeight: '800',
    letterSpacing: -2,
  },
  divider: {
    width: 48,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.2)',
    marginVertical: 24,
  },
  methodRow: { flexDirection: 'row', alignItems: 'center', gap: 24 },
  methodSep: { width: 1, height: 32, backgroundColor: 'rgba(255,255,255,0.2)' },
  methodItem: { alignItems: 'center', gap: 2 },
  methodAmt: { color: '#fff', fontSize: 20, fontWeight: '700', letterSpacing: -0.5 },
  methodLabel: { color: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: '500' },
  methodSingle: { color: 'rgba(255,255,255,0.65)', fontSize: 16, fontWeight: '500' },
});

// ── Main screen ──────────────────────────────────────────────────────────────
export default function PaymentCollectScreen() {
  const router  = useRouter();
  const insets  = useSafeAreaInsets();
  const { staffInfo } = useAuth();
  const params  = useLocalSearchParams<{
    orderId: string; tableNumber: string; amount: string;
    customerName: string; customerPhone: string;
  }>();

  const orderId       = params.orderId ?? '';
  const tableNumber   = Number(params.tableNumber ?? 0);
  const total         = Number(params.amount ?? 0);
  const customerName  = params.customerName && params.customerName.length > 0 ? params.customerName : null;
  const customerPhone = params.customerPhone ?? '';

  const [mode, setMode]           = useState<Mode>('normal');
  const [step, setStep]           = useState<Step>('choose');
  const [cashInput, setCashInput] = useState('');
  const [loading, setLoading]     = useState(false);
  const [isLoadingUpi, setIsLoadingUpi] = useState(true);
  const [partnerUpi, setPartnerUpi]     = useState<{ vpa: string | null; merchantName: string | null }>({ vpa: null, merchantName: null });
  const [successInfo, setSuccessInfo]   = useState<SuccessInfo | null>(null);

  useEffect(() => {
    const restaurantId = staffInfo?.restaurantId;
    if (!restaurantId) { setIsLoadingUpi(false); return; }
    restaurantApi.getBranding(restaurantId)
      .then(r => setPartnerUpi({ vpa: r?.data?.upiId ?? null, merchantName: r?.data?.upiDisplayName ?? r?.data?.name ?? null }))
      .catch(() => {})
      .finally(() => setIsLoadingUpi(false));
  }, [staffInfo?.restaurantId]);

  const cashNum    = Number(cashInput || 0);
  const upiNum     = Math.max(0, total - cashNum);
  const remaining  = total - cashNum;
  const splitValid = mode === 'split' && cashNum > 0 && upiNum > 0 && Math.abs(cashNum + upiNum - total) <= 1;

  const qrAmount = mode === 'normal' ? total : upiNum;
  const upiUri   = useMemo(() => {
    if (!partnerUpi.vpa || qrAmount <= 0) return '';
    return buildUpiUri(partnerUpi.vpa, partnerUpi.merchantName ?? 'Merchant', qrAmount);
  }, [partnerUpi.vpa, partnerUpi.merchantName, qrAmount]);

  const submit = async (splits: { method: 'CASH' | 'UPI_DIRECT'; amount: number }[]) => {
    const staffId = staffInfo?.id;
    if (!staffId) { Alert.alert('Not signed in', 'Please reopen the app and sign in again.'); return; }
    setLoading(true);
    try {
      await crewPayments.collectPayment(orderId, staffId, splits);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSuccessInfo({ tableNumber, total, splits });
    } catch (err: any) {
      Alert.alert('Could not record payment', err?.message ?? 'Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleUpiPay      = () => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); void submit([{ method: 'UPI_DIRECT', amount: total }]); };
  const handleCashTap     = () => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setStep('confirm_cash'); };
  const handleCashConfirm = () => { void submit([{ method: 'CASH', amount: total }]); };
  const handleSplitPaid   = () => { if (!splitValid) return; void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); void submit([{ method: 'CASH', amount: cashNum }, { method: 'UPI_DIRECT', amount: upiNum }]); };
  const enterSplitMode    = () => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setMode('split'); setStep('choose'); setCashInput(''); };
  const exitSplitMode     = () => { setMode('normal'); setStep('choose'); setCashInput(''); Keyboard.dismiss(); };

  const splitHint =
    cashInput.length === 0 ? null
    : splitValid           ? 'Exact'
    : remaining > 0        ? `₹${remaining.toLocaleString('en-IN')} remaining`
    : `₹${Math.abs(remaining).toLocaleString('en-IN')} over`;

  const splitHintColor =
    splitValid    ? QuinckleColors.success
    : remaining < 0 ? QuinckleColors.danger
    : QuinckleColors.textTertiary;

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.6} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={24} color={QuinckleColors.textPrimary} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Collect Payment</Text>
        {mode === 'normal' ? (
          <TouchableOpacity onPress={enterSplitMode} activeOpacity={0.6} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={s.splitLink}>Split</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={exitSplitMode} activeOpacity={0.6} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={s.cancelLink}>Cancel</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Order summary */}
      <View style={[s.summary, { paddingHorizontal: Spacing.xl }]}>
        <Text style={s.tableLabel}>Table {tableNumber}</Text>
        <Text style={s.totalAmount}>₹{total.toLocaleString('en-IN')}</Text>
        <View style={s.customerRow}>
          <Text style={s.customerText}>{customerName ?? 'Guest'}</Text>
          {customerPhone ? (
            <TouchableOpacity onPress={() => Linking.openURL(`tel:${customerPhone}`).catch(() => {})} activeOpacity={0.6}>
              <Text style={s.phoneText}>{customerPhone}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <View style={s.divider} />

      {/* Scrollable content */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

        {/* Normal mode QR */}
        {mode === 'normal' && (
          isLoadingUpi ? <QrSkeleton size={200} /> : (
            partnerUpi.vpa ? (
              <View style={s.qrBlock}>
                <Text style={s.qrHint}>Ask the diner to scan</Text>
                <View style={s.qrFrame}>
                  <QRCode value={upiUri} size={200} backgroundColor="#ffffff" color="#000000" />
                </View>
                <Text style={s.qrAmt}>₹{total.toLocaleString('en-IN')}</Text>
                <Text style={s.qrVpa}>{partnerUpi.vpa}</Text>
                <TouchableOpacity onPress={() => Linking.openURL(upiUri).catch(() => {})} activeOpacity={0.6} style={s.openLink}>
                  <Text style={s.openLinkText}>Open in UPI app</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={s.warningBlock}>
                <Ionicons name="information-circle-outline" size={16} color={QuinckleColors.textTertiary} />
                <Text style={s.warningText}>No UPI ID configured. Add one in restaurant settings.</Text>
              </View>
            )
          )
        )}

        {/* Split mode */}
        {mode === 'split' && (
          <View style={s.splitSection}>
            <Text style={s.splitTitle}>Split payment</Text>
            <Text style={s.splitSub}>Enter the cash amount — UPI is calculated automatically.</Text>

            <View style={s.splitRow}>
              {/* Cash input */}
              <View style={s.splitCol}>
                <Text style={s.splitColLabel}>Cash</Text>
                <View style={[s.splitField, s.splitFieldActive]}>
                  <Text style={s.splitCurrency}>₹</Text>
                  <TextInput
                    value={cashInput}
                    onChangeText={raw => setCashInput(raw.replace(/[^\d]/g, '').slice(0, 7))}
                    keyboardType="number-pad"
                    placeholder="0"
                    placeholderTextColor={QuinckleColors.textTertiary}
                    style={s.splitInput}
                    autoFocus
                  />
                </View>
              </View>

              {/* UPI calculated */}
              <View style={s.splitCol}>
                <Text style={s.splitColLabel}>UPI</Text>
                <View style={s.splitField}>
                  <Text style={s.splitCurrency}>₹</Text>
                  <Text style={[s.splitReadonly, { color: cashInput.length === 0 ? QuinckleColors.textTertiary : QuinckleColors.textPrimary }]}>
                    {cashInput.length === 0 ? '—' : String(Math.max(0, upiNum))}
                  </Text>
                </View>
              </View>
            </View>

            {splitHint && (
              <Text style={[s.splitHint, { color: splitHintColor }]}>{splitHint}</Text>
            )}

            {/* Split QR */}
            {upiNum > 0 && !isLoadingUpi && partnerUpi.vpa && (
              <View style={s.qrBlock}>
                <Text style={s.qrHint}>UPI — ₹{upiNum.toLocaleString('en-IN')}</Text>
                <View style={s.qrFrame}>
                  <QRCode value={upiUri} size={180} backgroundColor="#ffffff" color="#000000" />
                </View>
                <Text style={s.qrVpa}>{partnerUpi.vpa}</Text>
              </View>
            )}
            {upiNum > 0 && isLoadingUpi && <QrSkeleton size={180} />}
          </View>
        )}
      </ScrollView>

      {/* Bottom actions */}
      <View style={[s.bottom, { paddingBottom: insets.bottom + 16 }]}>

        {mode === 'normal' && step === 'choose' && (
          <View style={s.btnRow}>
            <TouchableOpacity style={s.btnCash} onPress={handleCashTap} disabled={loading} activeOpacity={0.8}>
              {loading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.btnLabel}>Cash</Text>}
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.btnUpi, (isLoadingUpi || !partnerUpi.vpa) && s.btnMuted]}
              onPress={handleUpiPay}
              disabled={loading || isLoadingUpi || !partnerUpi.vpa}
              activeOpacity={0.8}
            >
              {loading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.btnLabel}>UPI</Text>}
            </TouchableOpacity>
          </View>
        )}

        {mode === 'normal' && step === 'confirm_cash' && (
          <View style={s.confirmWrap}>
            <Text style={s.confirmMsg}>Confirm ₹{total.toLocaleString('en-IN')} cash received?</Text>
            <View style={s.btnRow}>
              <TouchableOpacity style={s.btnGhost} onPress={() => setStep('choose')} disabled={loading} activeOpacity={0.7}>
                <Text style={s.btnGhostLabel}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.btnCash, { flex: 2 }, loading && { opacity: 0.5 }]} onPress={handleCashConfirm} disabled={loading} activeOpacity={0.8}>
                {loading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.btnLabel}>Confirm</Text>}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {mode === 'split' && (
          <TouchableOpacity
            style={[s.btnPrimary, (!splitValid || loading) && s.btnMuted]}
            onPress={handleSplitPaid}
            disabled={!splitValid || loading}
            activeOpacity={0.8}
          >
            {loading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.btnLabel}>Mark as Paid</Text>}
          </TouchableOpacity>
        )}
      </View>

      {successInfo && <SuccessScreen info={successInfo} onDone={() => router.back()} />}
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: QuinckleColors.background },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md,
  },
  backBtn: { padding: 4 },
  headerTitle: { color: QuinckleColors.textPrimary, fontSize: 15, fontWeight: '600' },
  splitLink: { color: QuinckleColors.primary, fontSize: 15, fontWeight: '600' },
  cancelLink: { color: QuinckleColors.textSecondary, fontSize: 15, fontWeight: '500' },

  // Order summary
  summary: { paddingTop: Spacing.xl, paddingBottom: Spacing.xl },
  tableLabel: { color: QuinckleColors.textTertiary, fontSize: 12, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 6 },
  totalAmount: { color: QuinckleColors.textPrimary, fontSize: 44, fontWeight: '700', letterSpacing: -1.5, marginBottom: 10 },
  customerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  customerText: { color: QuinckleColors.textSecondary, fontSize: 14, fontWeight: '500' },
  phoneText: { color: QuinckleColors.textTertiary, fontSize: 14 },

  divider: { height: StyleSheet.hairlineWidth, backgroundColor: QuinckleColors.border, marginHorizontal: Spacing.xl },

  // Scroll
  scroll: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.xl, paddingBottom: Spacing.xxxl },

  // QR
  qrBlock: { alignItems: 'center', gap: 12 },
  qrHint: { color: QuinckleColors.textTertiary, fontSize: 12, fontWeight: '500', letterSpacing: 0.2 },
  qrFrame: { padding: 16, backgroundColor: '#fff', borderRadius: Radius.md },
  qrAmt: { color: QuinckleColors.textPrimary, fontSize: 20, fontWeight: '600', letterSpacing: -0.4, marginTop: 4 },
  qrVpa: { color: QuinckleColors.textTertiary, fontSize: 12, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  openLink: { marginTop: 4 },
  openLinkText: { color: QuinckleColors.textTertiary, fontSize: 13, fontWeight: '500', textDecorationLine: 'underline' },

  warningBlock: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: Spacing.md },
  warningText: { color: QuinckleColors.textTertiary, fontSize: 13, flex: 1, lineHeight: 18 },

  // Split
  splitSection: { gap: 20 },
  splitTitle: { color: QuinckleColors.textPrimary, fontSize: 20, fontWeight: '700', letterSpacing: -0.4 },
  splitSub: { color: QuinckleColors.textTertiary, fontSize: 13, fontWeight: '400', marginTop: -12 },
  splitRow: { flexDirection: 'row', gap: Spacing.md },
  splitCol: { flex: 1, gap: 6 },
  splitColLabel: { color: QuinckleColors.textTertiary, fontSize: 11, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase' },
  splitField: {
    flexDirection: 'row', alignItems: 'center',
    height: 56, borderRadius: Radius.md,
    backgroundColor: QuinckleColors.surface,
    borderWidth: 1, borderColor: QuinckleColors.border,
    paddingHorizontal: Spacing.md,
  },
  splitFieldActive: { borderColor: QuinckleColors.borderStrong },
  splitCurrency: { color: QuinckleColors.textSecondary, fontSize: 18, fontWeight: '400', marginRight: 2 },
  splitInput: { flex: 1, color: QuinckleColors.textPrimary, fontSize: 22, fontWeight: '600', padding: 0, letterSpacing: -0.4 },
  splitReadonly: { flex: 1, fontSize: 22, fontWeight: '600', letterSpacing: -0.4 },
  splitHint: { fontSize: 13, fontWeight: '500', textAlign: 'right' },

  // Bottom
  bottom: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: QuinckleColors.border,
  },
  btnRow: { flexDirection: 'row', gap: Spacing.md },
  btnCash: {
    flex: 1, height: 52, borderRadius: Radius.lg,
    backgroundColor: '#16a34a',
    alignItems: 'center', justifyContent: 'center',
  },
  btnUpi: {
    flex: 1, height: 52, borderRadius: Radius.lg,
    backgroundColor: '#1d4ed8',
    alignItems: 'center', justifyContent: 'center',
  },
  btnPrimary: {
    height: 52, borderRadius: Radius.lg,
    backgroundColor: QuinckleColors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  btnMuted: { opacity: 0.35 },
  btnLabel: { color: '#fff', fontSize: 16, fontWeight: '600' },
  btnGhost: {
    flex: 1, height: 52, borderRadius: Radius.lg,
    backgroundColor: QuinckleColors.surfaceMuted,
    borderWidth: 1, borderColor: QuinckleColors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  btnGhostLabel: { color: QuinckleColors.textSecondary, fontSize: 16, fontWeight: '500' },
  confirmWrap: { gap: Spacing.md },
  confirmMsg: { color: QuinckleColors.textSecondary, fontSize: 14, textAlign: 'center' },
});
