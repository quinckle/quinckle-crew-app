import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import Svg, { Path } from 'react-native-svg';
import { useAuth } from '../../context/AuthContext';
import { crewOrders, crewPayments, restaurantApi, type BillBreakdown, type CollectDueOptions, type CollectSplitMethod, type CrewOrderPaymentContext } from '../../services/api';
import { BillBreakdownView } from '../../components/ui/BillBreakdownView';
import { playPaymentSuccess } from '../../services/sound';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';
import { isOffPremise, channelLabel, locationLabel as channelLocationLabel } from '../../constants/channel';

function buildUpiUri(vpa: string, merchantName: string, amount: number): string {
  const enc = (v: string | number) => encodeURIComponent(String(v));
  return `upi://pay?pa=${enc(vpa)}&pn=${enc(merchantName)}&am=${enc(amount.toFixed(2))}&cu=INR`;
}

function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

type Mode = 'normal' | 'split' | 'khata';
/**
 * Every path that settles money passes through 'confirm'.
 *
 * Cash used to be the only method that asked, while UPI submitted on the first
 * tap — so the method where nobody had verified the transfer landed was the one
 * with LESS friction. There is no undo: the crew payment API exposes only
 * collect / collect-session / intent confirm+reject, and the sole reversal is
 * `POST /orders/:id/refund`, which needs a manager PIN and records a refund
 * adjustment rather than erasing the collection. One deliberate tap is cheap
 * next to unwinding that.
 */
type Step = 'choose' | 'confirm';

/** What a confirmed tap will submit, held between 'choose' and 'confirm'. */
type PendingPayment = {
  splits: { method: CollectSplitMethod; amount: number }[];
  dueOptions?: CollectDueOptions | null;
  /** Reads after "Confirm" — e.g. "₹1,200 received in cash?" */
  question: string;
  /** Styles the confirm button to match the method being confirmed. */
  tone: 'cash' | 'upi' | 'split' | 'khata';
};
type SuccessInfo = {
  tableNumber: number;
  locationLabel: string;
  total: number;
  splits: { method: CollectSplitMethod; amount: number }[];
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
  }, [p]);
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
    playPaymentSuccess();
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 260, useNativeDriver: true }),
      Animated.timing(riseAnim, { toValue: 0, duration: 340, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
    const t = setTimeout(onDone, 2400);
    return () => clearTimeout(t);
  }, [fadeAnim, riseAnim, onDone]);

  const cashSplit = info.splits.find(s => s.method === 'CASH');
  const upiSplit  = info.splits.find(s => s.method === 'UPI_DIRECT');
  const dueSplit  = info.splits.find(s => s.method === 'DUE');
  const moneyParts = [cashSplit, upiSplit, dueSplit].filter(Boolean).length;
  const isSplit   = moneyParts > 1;
  const isUpiOnly = !cashSplit && !!upiSplit && !dueSplit;
  const isDueOnly = !!dueSplit && !cashSplit && !upiSplit;

  return (
    <Animated.View style={[sc.screen, { opacity: fadeAnim }]}>
      <Animated.View style={[sc.body, { transform: [{ translateY: riseAnim }] }]}>
        {/* Check icon */}
        <View style={sc.iconWrap}>
          <Svg width={52} height={52} viewBox="0 0 16 16" fill="none">
            <Path
              fill="#fff"
              d="M10.067.87a2.89 2.89 0 0 0-4.134 0l-.622.638-.89-.011a2.89 2.89 0 0 0-2.924 2.924l.01.89-.636.622a2.89 2.89 0 0 0 0 4.134l.637.622-.011.89a2.89 2.89 0 0 0 2.924 2.924l.89-.01.622.636a2.89 2.89 0 0 0 4.134 0l.622-.637.89.011a2.89 2.89 0 0 0 2.924-2.924l-.01-.89.636-.622a2.89 2.89 0 0 0 0-4.134l-.637-.622.011-.89a2.89 2.89 0 0 0-2.924-2.924l-.89.01zm.287 5.984-3 3a.5.5 0 0 1-.708 0l-1.5-1.5a.5.5 0 1 1 .708-.708L7 8.793l2.646-2.647a.5.5 0 0 1 .708.708"
            />
          </Svg>
        </View>

        <Text style={sc.title}>{dueSplit ? 'Recorded' : 'Collected'}</Text>
        <Text style={sc.table}>{info.locationLabel}</Text>
        <Text style={sc.amount}>₹{info.total.toLocaleString('en-IN')}</Text>

        <View style={sc.divider} />

        {/* Method breakdown */}
        {isSplit ? (
          <View style={sc.methodRow}>
            {cashSplit && (
              <View style={sc.methodItem}>
                <Text style={sc.methodAmt}>₹{cashSplit.amount.toLocaleString('en-IN')}</Text>
                <Text style={sc.methodLabel}>Cash</Text>
              </View>
            )}
            {cashSplit && (upiSplit || dueSplit) && <View style={sc.methodSep} />}
            {upiSplit && (
              <View style={sc.methodItem}>
                <Text style={sc.methodAmt}>₹{upiSplit.amount.toLocaleString('en-IN')}</Text>
                <Text style={sc.methodLabel}>UPI</Text>
              </View>
            )}
            {upiSplit && dueSplit && <View style={sc.methodSep} />}
            {dueSplit && (
              <View style={sc.methodItem}>
                <Text style={sc.methodAmt}>₹{dueSplit.amount.toLocaleString('en-IN')}</Text>
                <Text style={sc.methodLabel}>Khata</Text>
              </View>
            )}
          </View>
        ) : (
          <Text style={sc.methodSingle}>{isDueOnly ? 'on khata (pay later)' : isUpiOnly ? 'via UPI' : 'via Cash'}</Text>
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
  const returnToPreviousScreen = useCallback(() => router.back(), [router]);
  const insets  = useSafeAreaInsets();
  const { staffInfo } = useAuth();
  const params  = useLocalSearchParams<{
    orderId: string; tableNumber: string; amount?: string;
    customerName: string; customerPhone: string;
    sessionId?: string;
    orderIds?: string;
    intentId?: string;
    intentMethod?: 'STAFF_COLLECT' | 'UPI_DIRECT';
    upiVpa?: string;
    upiName?: string;
    breakdown?: string;
    channel?: string;
    pickupToken?: string;
  }>();

  const orderId       = params.orderId ?? '';
  const sessionId     = params.sessionId ?? '';
  // Every pending order on the table — present ⇒ this is a whole-table collect.
  const orderIds      = useMemo<string[]>(() => {
    if (!params.orderIds) return [];
    try { const v = JSON.parse(params.orderIds); return Array.isArray(v) ? v.map(String) : []; }
    catch { return []; }
  }, [params.orderIds]);
  // Multi-order ⇒ settle the session; the single-order payment context (fetched
  // per representative order) would otherwise under-report the table total.
  const isSessionCollect = !params.intentId && !!sessionId && orderIds.length > 0;
  const isMultiOrder      = orderIds.length > 1;
  const tableNumber   = Number(params.tableNumber ?? 0);
  const channel       = params.channel ?? 'DINE_IN';
  const pickupToken   = params.pickupToken ?? null;
  const locationLabel = isOffPremise(channel)
    ? (pickupToken ?? channelLabel(channel))
    : `Table ${tableNumber}`;
  const total         = Number(params.amount ?? 0);
  const customerName  = params.customerName && params.customerName.length > 0 ? params.customerName : null;
  const customerPhone = params.customerPhone ?? '';
  const intentId      = params.intentId ?? '';
  const intentMethod  = (params.intentMethod as 'STAFF_COLLECT' | 'UPI_DIRECT' | undefined) ?? undefined;
  const breakdown: BillBreakdown | null = useMemo(() => {
    if (!params.breakdown) return null;
    try { return JSON.parse(params.breakdown) as BillBreakdown; } catch { return null; }
  }, [params.breakdown]);
  const [paymentContext, setPaymentContext] = useState<CrewOrderPaymentContext | null>(null);
  const [isLoadingPaymentContext, setIsLoadingPaymentContext] = useState(false);
  const [paymentContextError, setPaymentContextError] = useState<string | null>(null);

  const [mode, setMode]           = useState<Mode>('normal');
  const [step, setStep]           = useState<Step>('choose');
  const [pending, setPending]     = useState<PendingPayment | null>(null);
  const [cashInput, setCashInput] = useState('');
  const [loading, setLoading]     = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [isLoadingUpi, setIsLoadingUpi] = useState(true);
  const [partnerUpi, setPartnerUpi]     = useState<{ vpa: string | null; merchantName: string | null }>({ vpa: null, merchantName: null });
  const [successInfo, setSuccessInfo]   = useState<SuccessInfo | null>(null);

  // ── Khata (due) mode state ────────────────────────────────────────────────
  // "Received now" is optional — 0 means the whole bill goes on the khata.
  const [khataPaidInput, setKhataPaidInput]   = useState('');
  const [khataPaidMethod, setKhataPaidMethod] = useState<'CASH' | 'UPI_DIRECT'>('CASH');
  const [khataPhone, setKhataPhone]           = useState('');
  const [khataName, setKhataName]             = useState('');

  useEffect(() => {
    const restaurantId = staffInfo?.restaurantId;
    const fallbackVpa = normalizeOptionalText(params.upiVpa);
    const fallbackName = normalizeOptionalText(params.upiName);
    if (!restaurantId) {
      setPartnerUpi({ vpa: fallbackVpa, merchantName: fallbackName });
      setIsLoadingUpi(false);
      return;
    }
    restaurantApi.getBranding(restaurantId)
      .then(r => {
        const fromBrandingVpa = normalizeOptionalText(r?.data?.upiId);
        const fromDisplayName = normalizeOptionalText(r?.data?.upiDisplayName);
        const fromRestaurantName = normalizeOptionalText(r?.data?.name);
        setPartnerUpi({
          vpa: fromBrandingVpa ?? fallbackVpa,
          merchantName: fromDisplayName ?? fromRestaurantName ?? fallbackName,
        });
      })
      .catch(() => {
        setPartnerUpi({ vpa: fallbackVpa, merchantName: fallbackName });
      })
      .finally(() => setIsLoadingUpi(false));
  }, [staffInfo?.restaurantId, params.upiVpa, params.upiName]);

  useEffect(() => {
    let alive = true;
    const loadPaymentContext = async () => {
      // For a multi-order (whole-table) collect the per-order context would
      // under-report the total — rely on the summed card amount/breakdown.
      if (!orderId || isMultiOrder) return;
      setIsLoadingPaymentContext(true);
      setPaymentContextError(null);
      try {
        const res = await crewOrders.getPaymentContext(orderId);
        if (!alive) return;
        setPaymentContext(res.data);
      } catch (err: any) {
        if (!alive) return;
        setPaymentContextError(err?.message ?? 'Could not load payment details.');
      } finally {
        if (alive) setIsLoadingPaymentContext(false);
      }
    };
    void loadPaymentContext();
    return () => { alive = false; };
  }, [orderId, isMultiOrder]);

  const resolvedTotal = isMultiOrder ? total : (paymentContext?.total ?? total);
  const resolvedBreakdown: BillBreakdown | null = useMemo(() => {
    if (paymentContext && !isMultiOrder) {
      return {
        subtotal: paymentContext.subtotal,
        discount: 0,
        chargesTotal: paymentContext.service_charge,
        taxRate: paymentContext.subtotal > 0 ? (paymentContext.tax / paymentContext.subtotal) * 100 : 0,
        taxAmount: paymentContext.tax,
        tip: 0,
        total: paymentContext.total,
        currency: 'INR',
      };
    }
    return breakdown;
  }, [paymentContext, breakdown, isMultiOrder]);

  const cashNum    = Number(cashInput || 0);
  const upiNum     = Math.max(0, resolvedTotal - cashNum);
  const remaining  = resolvedTotal - cashNum;
  const splitValid = mode === 'split' && cashNum > 0 && upiNum > 0 && Math.abs(cashNum + upiNum - resolvedTotal) <= 1;

  const qrAmount = mode === 'normal' ? resolvedTotal : upiNum;
  const upiUri   = useMemo(() => {
    if (!partnerUpi.vpa || qrAmount <= 0) return '';
    return buildUpiUri(partnerUpi.vpa, partnerUpi.merchantName ?? 'Merchant', qrAmount);
  }, [partnerUpi.vpa, partnerUpi.merchantName, qrAmount]);

  const splitsSig = (splits: { method: CollectSplitMethod; amount: number }[]) =>
    splits.map(s => `${s.method}:${Number(s.amount).toFixed(2)}`).join('|');
  const buildCollectIdempotencyKey = (splits: { method: CollectSplitMethod; amount: number }[]) =>
    `crew-collect:${orderId}:${splitsSig(splits)}`;
  const buildSessionIdempotencyKey = (splits: { method: CollectSplitMethod; amount: number }[]) =>
    `crew-collect-session:${sessionId}:${[...orderIds].sort().join(',')}:${splitsSig(splits)}`;

  const submit = async (splits: { method: CollectSplitMethod; amount: number }[], dueOptions?: CollectDueOptions | null) => {
    const staffId = staffInfo?.id;
    if (!staffId) { Alert.alert('Not signed in', 'Please reopen the app and sign in again.'); return; }
    setLoading(true);
    try {
      if (intentId) {
        if (splits.length > 0 && intentMethod === 'UPI_DIRECT' && splits[0].method !== 'UPI_DIRECT') {
          Alert.alert('Invalid method', 'This request must be confirmed as UPI Direct.');
          setLoading(false);
          return;
        }
        await crewPayments.confirmPaymentIntent(intentId);
      } else if (isSessionCollect) {
        // Whole-table: settle every pending order the card was showing.
        await crewPayments.collectSessionPayment(sessionId, orderIds, staffId, splits, buildSessionIdempotencyKey(splits), null, dueOptions ?? null);
      } else {
        await crewPayments.collectPayment(orderId, staffId, splits, buildCollectIdempotencyKey(splits), null, dueOptions ?? null);
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSuccessInfo({ tableNumber, locationLabel, total: resolvedTotal, splits });
    } catch (err: any) {
      const code = String(err?.code ?? err?.message ?? '');
      if (code.includes('ALREADY_COLLECTED')) {
        Alert.alert('Already collected', 'This table has already been settled.', [{ text: 'OK', onPress: () => router.back() }]);
      } else if (code.includes('STALE_ORDERS')) {
        Alert.alert('Bill changed', 'A new order arrived for this table. Reopen the card to collect the updated total.', [{ text: 'OK', onPress: () => router.back() }]);
      } else {
        Alert.alert('Could not record payment', err?.message ?? 'Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCancelIntent = async () => {
    if (!intentId || isRejecting) return;
    setIsRejecting(true);
    try {
      await crewPayments.rejectPaymentIntent(intentId, 'Cancelled by staff');
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      router.back();
    } catch (err: any) {
      Alert.alert('Could not cancel request', err?.message ?? 'Please try again.');
    } finally {
      setIsRejecting(false);
    }
  };

  const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;

  /** Stage a payment for confirmation. Nothing is sent until `confirmPending`. */
  const stage = (p: PendingPayment) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPending(p);
    setStep('confirm');
  };
  const cancelPending  = () => { setPending(null); setStep('choose'); };
  const confirmPending = () => { if (pending) void submit(pending.splits, pending.dueOptions ?? null); };

  const handleUpiPay      = () => stage({
    splits: [{ method: 'UPI_DIRECT', amount: resolvedTotal }],
    question: `${rupees(resolvedTotal)} received via UPI?`,
    tone: 'upi',
  });
  const handleCashTap     = () => stage({
    splits: [{ method: 'CASH', amount: resolvedTotal }],
    question: `${rupees(resolvedTotal)} received in cash?`,
    tone: 'cash',
  });
  const handleSplitPaid   = () => {
    if (!splitValid) return;
    stage({
      splits: [{ method: 'CASH', amount: cashNum }, { method: 'UPI_DIRECT', amount: upiNum }],
      question: `${rupees(cashNum)} in cash and ${rupees(upiNum)} via UPI received?`,
      tone: 'split',
    });
  };
  const enterSplitMode    = () => {
    if (intentId) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setMode('split'); setStep('choose'); setPending(null); setCashInput('');
  };
  const exitSplitMode     = () => { setMode('normal'); setStep('choose'); setPending(null); setCashInput(''); setKhataPaidInput(''); Keyboard.dismiss(); };

  // ── Khata (due) mode ─────────────────────────────────────────────────────
  const enterKhataMode = () => {
    if (intentId) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setMode('khata');
    setStep('choose');
    setPending(null);
    setKhataPaidInput('');
    setKhataPaidMethod('CASH');
    // Prefill from the session's known customer; staff can overwrite.
    setKhataPhone((customerPhone || '').replace(/^\+91|[\s\-()]/g, '').slice(0, 10));
    setKhataName(customerName ?? '');
  };

  const khataPaidNum   = Number(khataPaidInput || 0);
  const khataDueAmount = Math.max(0, resolvedTotal - khataPaidNum);
  const khataPhoneValid = /^[6-9]\d{9}$/.test(khataPhone);
  const khataValid = khataPhoneValid && khataDueAmount > 0 && khataPaidNum >= 0 && khataPaidNum < resolvedTotal;

  const handleKhataConfirm = () => {
    if (!khataValid || loading) return;
    const splits: { method: CollectSplitMethod; amount: number }[] = [];
    if (khataPaidNum > 0) splits.push({ method: khataPaidMethod, amount: khataPaidNum });
    splits.push({ method: 'DUE', amount: khataDueAmount });
    // Khata is credit extended to a named person, not money in the drawer, so
    // the question names who is on the hook rather than what was received.
    const who = khataName.trim() || khataPhone;
    stage({
      splits,
      dueOptions: { customerPhone: khataPhone, customerName: khataName.trim() || null },
      question: khataPaidNum > 0
        ? `${rupees(khataPaidNum)} received now and ${rupees(khataDueAmount)} on ${who}'s khata?`
        : `${rupees(khataDueAmount)} on ${who}'s khata?`,
      tone: 'khata',
    });
  };

  const splitHint =
    cashInput.length === 0 ? null
    : splitValid           ? 'Exact'
    : remaining > 0        ? `₹${remaining.toLocaleString('en-IN')} remaining`
    : `₹${Math.abs(remaining).toLocaleString('en-IN')} over`;

  const splitHintColor =
    splitValid    ? QuinckleColors.success
    : remaining < 0 ? QuinckleColors.danger
    : QuinckleColors.textTertiary;
  const paymentReady = resolvedTotal > 0 && !isLoadingPaymentContext;

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={[s.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.6} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={24} color={QuinckleColors.textPrimary} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Collect Payment</Text>
        {mode === 'normal' && !intentId ? (
          <TouchableOpacity onPress={enterSplitMode} activeOpacity={0.6} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={s.splitLink}>Split</Text>
          </TouchableOpacity>
        ) : mode !== 'normal' ? (
          <TouchableOpacity onPress={exitSplitMode} activeOpacity={0.6} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={s.cancelLink}>Cancel</Text>
          </TouchableOpacity>
        ) : (
          <View style={{ width: 44 }} />
        )}
      </View>

      {/* Order summary */}
      <View style={[s.summary, { paddingHorizontal: Spacing.xl }]}>
        <Text style={s.tableLabel}>{locationLabel}</Text>
        <Text style={s.totalAmount}>₹{resolvedTotal.toLocaleString('en-IN')}</Text>
        <View style={s.customerRow}>
          <Text style={s.customerText}>{customerName ?? 'Guest'}</Text>
          {customerPhone ? (
            <TouchableOpacity onPress={() => Linking.openURL(`tel:${customerPhone}`).catch(() => {})} activeOpacity={0.6}>
              <Text style={s.phoneText}>{customerPhone}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        {resolvedBreakdown && (resolvedBreakdown.chargesTotal !== 0 || resolvedBreakdown.taxAmount > 0 || resolvedBreakdown.discount > 0 || resolvedBreakdown.tip > 0) && (
          <View style={s.breakdownWrap}>
            <BillBreakdownView breakdown={resolvedBreakdown} compact />
          </View>
        )}
        {paymentContextError && (
          <Text style={s.contextWarning}>{paymentContextError}</Text>
        )}
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
                  {upiUri ? <QRCode value={upiUri} size={200} backgroundColor="#ffffff" color="#000000" /> : null}
                </View>
                <Text style={s.qrAmt}>₹{resolvedTotal.toLocaleString('en-IN')}</Text>
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
        {step === 'choose' && mode === 'split' && (
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
            {upiNum > 0 && !isLoadingUpi && partnerUpi.vpa && upiUri && (
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

        {/* Khata (due) mode */}
        {step === 'choose' && mode === 'khata' && (
          <View style={s.splitSection}>
            <Text style={s.splitTitle}>Add to khata</Text>
            <Text style={s.splitSub}>The unpaid amount is recorded against the customer&apos;s phone — collect it later from the Dues screen.</Text>

            {/* Customer phone (required) + name */}
            <View style={{ gap: Spacing.md }}>
              <View>
                <Text style={s.splitColLabel}>Customer phone *</Text>
                <View style={[s.splitField, s.splitFieldActive]}>
                  <Text style={s.splitCurrency}>+91</Text>
                  <TextInput
                    value={khataPhone}
                    onChangeText={raw => setKhataPhone(raw.replace(/[^\d]/g, '').slice(0, 10))}
                    keyboardType="phone-pad"
                    placeholder="10-digit mobile"
                    placeholderTextColor={QuinckleColors.textTertiary}
                    style={s.splitInput}
                    autoFocus={!khataPhone}
                  />
                  {khataPhoneValid && <Ionicons name="checkmark-circle" size={18} color={QuinckleColors.success} />}
                </View>
              </View>
              <View>
                <Text style={s.splitColLabel}>Customer name (optional)</Text>
                <View style={s.splitField}>
                  <TextInput
                    value={khataName}
                    onChangeText={setKhataName}
                    placeholder="Name"
                    placeholderTextColor={QuinckleColors.textTertiary}
                    style={s.splitInput}
                    autoCapitalize="words"
                  />
                </View>
              </View>
            </View>

            {/* Received now (optional) */}
            <View style={{ marginTop: Spacing.lg }}>
              <Text style={s.splitColLabel}>Received now (optional)</Text>
              <View style={s.splitRow}>
                <View style={[s.splitCol, { flex: 1.4 }]}>
                  <View style={s.splitField}>
                    <Text style={s.splitCurrency}>₹</Text>
                    <TextInput
                      value={khataPaidInput}
                      onChangeText={raw => setKhataPaidInput(raw.replace(/[^\d]/g, '').slice(0, 7))}
                      keyboardType="number-pad"
                      placeholder="0"
                      placeholderTextColor={QuinckleColors.textTertiary}
                      style={s.splitInput}
                    />
                  </View>
                </View>
                <View style={[s.splitCol, { flexDirection: 'row', gap: Spacing.sm }]}>
                  {(['CASH', 'UPI_DIRECT'] as const).map(m => (
                    <TouchableOpacity
                      key={m}
                      onPress={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setKhataPaidMethod(m); }}
                      style={[s.khataMethodChip, khataPaidMethod === m && s.khataMethodChipActive]}
                      activeOpacity={0.8}
                      disabled={m === 'UPI_DIRECT' && !partnerUpi.vpa}
                    >
                      <Text style={[s.khataMethodChipText, khataPaidMethod === m && s.khataMethodChipTextActive]}>
                        {m === 'CASH' ? 'Cash' : 'UPI'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </View>

            {/* Due summary */}
            <View style={s.khataSummary}>
              <View style={{ flex: 1 }}>
                <Text style={s.khataSummaryLabel}>Goes on khata</Text>
                <Text style={s.khataSummaryHint}>
                  {khataPaidNum > 0 ? `₹${khataPaidNum.toLocaleString('en-IN')} received via ${khataPaidMethod === 'CASH' ? 'cash' : 'UPI'}` : 'Nothing received now'}
                </Text>
              </View>
              <Text style={[s.khataSummaryAmount, khataPaidNum >= resolvedTotal && { color: QuinckleColors.danger }]}>
                ₹{khataDueAmount.toLocaleString('en-IN')}
              </Text>
            </View>
            {khataPaidNum >= resolvedTotal && resolvedTotal > 0 && (
              <Text style={[s.splitHint, { color: QuinckleColors.danger }]}>
                Received amount covers the bill — use Cash/UPI instead of khata.
              </Text>
            )}
          </View>
        )}
      </ScrollView>

      {/* Bottom actions */}
      <View style={[s.bottom, { paddingBottom: insets.bottom + 16 }]}>

        {step === 'choose' && mode === 'normal' && (
          <View style={s.btnRow}>
            {intentMethod !== 'UPI_DIRECT' && (
              <TouchableOpacity style={s.btnCash} onPress={handleCashTap} disabled={loading} activeOpacity={0.8}>
                {loading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.btnLabel}>Cash</Text>}
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[s.btnUpi, (isLoadingUpi || isLoadingPaymentContext || !partnerUpi.vpa || !paymentReady) && s.btnMuted, intentMethod === 'UPI_DIRECT' && { flex: 2 }]}
              onPress={handleUpiPay}
              disabled={loading || isLoadingUpi || isLoadingPaymentContext || !partnerUpi.vpa || !paymentReady}
              activeOpacity={0.8}
            >
              {loading
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={s.btnLabel}>{intentId ? 'Mark as Paid' : 'UPI'}</Text>}
            </TouchableOpacity>
          </View>
        )}

        {/* Khata entry — pay-later isn't available on diner-initiated intents */}
        {!intentId && mode === 'normal' && step === 'choose' && (
          <TouchableOpacity
            style={[s.khataEntryBtn, (loading || !paymentReady) && { opacity: 0.5 }]}
            onPress={enterKhataMode}
            disabled={loading || !paymentReady}
            activeOpacity={0.8}
          >
            <Ionicons name="book-outline" size={17} color={QuinckleColors.warning} />
            {/* "(pay later)" glossed a term the staff already use every shift.
                If anyone needs the gloss it belongs on the khata screen, not
                permanently on the button. */}
            <Text style={s.khataEntryText}>Put on khata</Text>
          </TouchableOpacity>
        )}

        {intentId && mode === 'normal' && step === 'choose' && (
          <TouchableOpacity
            style={[s.btnGhost, { marginTop: Spacing.sm }, isRejecting && { opacity: 0.5 }]}
            onPress={handleCancelIntent}
            disabled={isRejecting || loading}
            activeOpacity={0.8}
          >
            {isRejecting
              ? <ActivityIndicator color={QuinckleColors.textPrimary} size="small" />
              : <Text style={s.btnGhostLabel}>Cancel Request</Text>}
          </TouchableOpacity>
        )}

        {/* One confirmation for every method — cash, UPI, split and khata all
            land here. The button keeps the colour of the method being
            confirmed, so the second tap still feels like the one you chose. */}
        {step === 'confirm' && pending && (
          <View style={s.confirmWrap}>
            <Text style={s.confirmMsg}>{pending.question}</Text>
            <View style={s.btnRow}>
              <TouchableOpacity style={s.btnGhost} onPress={cancelPending} disabled={loading} activeOpacity={0.7}>
                <Text style={s.btnGhostLabel}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  pending.tone === 'cash' ? s.btnCash
                    : pending.tone === 'upi' ? s.btnUpi
                    : pending.tone === 'khata' ? s.btnKhata
                    : s.btnPrimary,
                  { flex: 2 },
                  (loading || isLoadingPaymentContext || !paymentReady) && { opacity: 0.5 },
                ]}
                onPress={confirmPending}
                disabled={loading || isLoadingPaymentContext || !paymentReady}
                activeOpacity={0.8}
              >
                {loading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.btnLabel}>Confirm</Text>}
              </TouchableOpacity>
            </View>
          </View>
        )}

        {mode === 'split' && (
          <TouchableOpacity
            style={[s.btnPrimary, (!splitValid || loading || isLoadingPaymentContext || !paymentReady) && s.btnMuted]}
            onPress={handleSplitPaid}
            disabled={!splitValid || loading || isLoadingPaymentContext || !paymentReady}
            activeOpacity={0.8}
          >
            {loading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={s.btnLabel}>Mark as Paid</Text>}
          </TouchableOpacity>
        )}

        {mode === 'khata' && (
          <TouchableOpacity
            style={[s.btnKhata, (!khataValid || loading || isLoadingPaymentContext || !paymentReady) && s.btnMuted]}
            onPress={handleKhataConfirm}
            disabled={!khataValid || loading || isLoadingPaymentContext || !paymentReady}
            activeOpacity={0.8}
          >
            {loading
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={s.btnLabel}>Record ₹{khataDueAmount.toLocaleString('en-IN')} due</Text>}
          </TouchableOpacity>
        )}
      </View>

      {successInfo && <SuccessScreen info={successInfo} onDone={returnToPreviousScreen} />}
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
  breakdownWrap: {
    marginTop: Spacing.md,
    padding: Spacing.md,
    backgroundColor: QuinckleColors.surface,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
  },

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
  contextWarning: { color: QuinckleColors.warning, fontSize: 12, fontWeight: '500', marginTop: 10 },

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

  // Khata (due) mode
  // Khata read as "odd" because it differed from Cash/UPI on four axes at once —
  // 44 vs 52 tall, 13px vs 16px label, outlined vs filled, plus an icon. It
  // SHOULD stay subordinate: it isn't a payment method, it's the decision not to
  // collect, and it's the only path needing a phone number because it's credit
  // tied to a person. But subordinate is one deliberate difference, not four.
  // Same height, radius and type size as its neighbours; outlined instead of
  // filled is the single thing that sets it apart.
  khataEntryBtn: {
    marginTop: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 52,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: QuinckleColors.warningBorder,
    backgroundColor: QuinckleColors.warningSoft,
  },
  khataEntryText: { color: QuinckleColors.warning, fontSize: 16, fontWeight: '600' },
  btnKhata: {
    height: 52, borderRadius: Radius.lg,
    backgroundColor: '#b45309',
    alignItems: 'center', justifyContent: 'center',
  },
  khataMethodChip: {
    flex: 1,
    height: 52,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    backgroundColor: QuinckleColors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  khataMethodChipActive: {
    borderColor: QuinckleColors.primarySoftBorder,
    backgroundColor: QuinckleColors.primarySoft,
  },
  khataMethodChipText: { color: QuinckleColors.textSecondary, fontSize: 13, fontWeight: '600' },
  khataMethodChipTextActive: { color: QuinckleColors.primary },
  khataSummary: {
    marginTop: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: QuinckleColors.warningSoft,
    borderWidth: 1,
    borderColor: QuinckleColors.warningBorder,
  },
  khataSummaryLabel: { color: QuinckleColors.warning, fontSize: 12, fontWeight: '700' },
  khataSummaryHint: { color: QuinckleColors.textTertiary, fontSize: 11, marginTop: 2 },
  khataSummaryAmount: { color: QuinckleColors.warning, fontSize: 24, fontWeight: '800', letterSpacing: -0.5 },
});
