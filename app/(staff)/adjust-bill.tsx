/**
 * Adjust bill — party size, the charges a biller types per order (container,
 * delivery), the tip, and who the tip is for.
 *
 * A screen rather than a sheet. It is a form with four to six number fields and
 * a keyboard open over most of them; a sheet that tall is a screen wearing a
 * grabber, and a half-typed bill is not something to lose to an accidental
 * downward swipe. Back is guarded instead, which a sheet could not do.
 *
 * The tip's staff list lives behind one row (AssignTipSheet): it is the longest
 * block on the form and the least often touched, since most bills have no tip.
 *
 * Deliberately NO "new total" on screen. Charges carry their own tax treatment
 * — a ₹40 container can land as ₹44.80 — and re-deriving that here is how the
 * client and the server drift apart. The header shows the bill as it stands;
 * the true new total comes from the re-read after Save.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  KeyboardAvoidingView,
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
import { crewSessions } from '../../services/api';
import { QuinckleColors, Radius, Spacing, Typography } from '../../constants/Colors';
import { ThemedDialog } from '../../components/ui/themed-dialog';
import { AssignTipSheet, type Allocation, type Staff } from '../../components/ui/AssignTipSheet';
import { StaffAvatar } from '../../components/ui/StaffAvatar';
import { Skeleton } from '../../components/ui/Skeleton';

type VariableCharge = {
  id: string;
  name: string;
  amount: number | null;
  taxTreatment: 'FOLLOW_ITEMS' | 'FIXED_RATE' | 'EXEMPT';
  taxRatePercent: number | null;
  includesTax: boolean | null;
};

/** What the number the biller is about to type will mean on the bill. */
function taxHint(c: VariableCharge): string {
  if (c.taxTreatment === 'EXEMPT') return 'No GST';
  const incl = c.includesTax === true ? 'incl. GST' : c.includesTax === false ? '+ GST' : null;
  if (c.taxTreatment === 'FIXED_RATE' && c.taxRatePercent != null) {
    return incl ? `GST ${c.taxRatePercent}% · ${incl}` : `GST ${c.taxRatePercent}%`;
  }
  return incl ? `GST follows the food · ${incl}` : 'GST follows the food';
}

const money = (v: string) => v.replace(/[^0-9.]/g, '');

/**
 * Loading state shaped like the form it becomes — same gutter, same 48pt field
 * heights, same section rhythm — so nothing jumps when the data lands. A
 * spinner here would say "wait" without saying what for, on a screen that
 * arrives mid-lift and is mostly chrome the crew already knows.
 *
 * Charge count is unknown until the fetch returns; two is the common shape
 * (container, delivery) and guessing low avoids a collapse on arrival.
 */
function FormSkeleton() {
  const field = (key: string, labelWidth: number, hintWidth: number) => (
    <View key={key} style={s.field}>
      <View style={s.rowHead}>
        <Skeleton width={labelWidth} height={12} radius={4} />
        <Skeleton width={hintWidth} height={10} radius={4} />
      </View>
      <Skeleton width="100%" height={48} radius={Radius.md} />
    </View>
  );

  return (
    <View style={[s.scroll, { flex: 1 }]}>
      <Skeleton width={72} height={10} radius={4} style={{ marginTop: Spacing.xl, marginBottom: Spacing.md }} />
      {field('a', 78, 96)}
      <Skeleton width="88%" height={10} radius={4} style={{ marginTop: 2, marginBottom: Spacing.lg }} />
      {field('b', 68, 118)}
      {field('c', 58, 52)}

      <Skeleton width={40} height={10} radius={4} style={{ marginTop: Spacing.xl, marginBottom: Spacing.md }} />
      {field('d', 62, 74)}
    </View>
  );
}


export default function AdjustBillScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ sessionId: string; subtitle?: string; total?: string }>();
  const sessionId = String(params.sessionId ?? '');
  const subtitle = params.subtitle ? String(params.subtitle) : '';
  const billTotal = params.total != null ? Number(params.total) : null;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [charges, setCharges] = useState<VariableCharge[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [covers, setCovers] = useState('');
  const [capacity, setCapacity] = useState<number | null>(null);
  const [tip, setTip] = useState('');
  const [staff, setStaff] = useState<Staff[]>([]);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [assignOpen, setAssignOpen] = useState(false);

  // Lift and fade. The stack cross-fades the whole transparent screen in; this
  // drives the card rising the last few pixels and the backdrop darkening, so
  // it reads as growing out of the control that was tapped rather than sliding
  // in from somewhere off-screen.
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 260,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
      useNativeDriver: true,
    }).start();
  }, [enter]);

  const [dialog, setDialog] = useState<{ title: string; message: string } | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);

  // What the server had on open, so Save can tell a real edit from an untouched
  // field and skip work that would needlessly re-price the session and void its
  // payment request.
  const loaded = useRef({ covers: '', tip: '', allocations: '' });

  const allocKey = useCallback(
    (list: Allocation[]) =>
      JSON.stringify(
        list
          .filter((a) => a.amount > 0)
          .map((a) => [a.staffMemberId, a.amount] as [string, number])
          .sort(),
      ),
    [],
  );

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([crewSessions.getAdjustments(sessionId), crewSessions.getTip(sessionId)])
      .then(([adj, tp]) => {
        if (cancelled) return;
        const a = adj.data;
        const t = tp.data;

        setCharges(a.charges);
        setAmounts(Object.fromEntries(
          a.charges.map((c) => [c.id, c.amount != null ? String(c.amount) : '']),
        ));
        const covs = a.coverCount != null ? String(a.coverCount) : '';
        setCovers(covs);
        setCapacity(a.tableCapacity ?? null);

        const tipStr = t.amount > 0 ? String(t.amount) : '';
        setTip(tipStr);
        setStaff(t.staff);
        const allocs = t.allocations.map((x) => ({ staffMemberId: x.staffMemberId, amount: x.amount }));
        setAllocations(allocs);

        loaded.current = { covers: covs, tip: tipStr, allocations: allocKey(allocs) };
      })
      .catch(() => {
        if (!cancelled) setDialog({ title: 'Could not load', message: 'Please try again.' });
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [sessionId, allocKey]);

  const tipNum = Number(tip) || 0;
  const assigned = useMemo(
    () => Number(allocations.reduce((s, a) => s + a.amount, 0).toFixed(2)),
    [allocations],
  );
  const tipRemainder = Number((tipNum - assigned).toFixed(2));

  const chargesChanged = useMemo(
    () => charges.some((c) => {
      const raw = (amounts[c.id] ?? '').trim();
      if (raw === '') return c.amount != null;
      return Number(raw) !== c.amount;
    }),
    [charges, amounts],
  );
  const dirty =
    covers.trim() !== loaded.current.covers ||
    tip.trim() !== loaded.current.tip ||
    allocKey(allocations) !== loaded.current.allocations ||
    chargesChanged;

  const leave = () => router.back();
  const onBack = () => { if (dirty && !saving) setConfirmLeave(true); else leave(); };

  const handleSave = async () => {
    // Validate everything BEFORE writing anything, so a bad tip cannot land
    // after the charges have already been saved.
    const coverCount = covers.trim() === '' ? null : Number(covers);
    if (coverCount != null && (!Number.isInteger(coverCount) || coverCount < 1 || coverCount > 200)) {
      setDialog({ title: 'Check the party size', message: 'Enter a whole number of guests between 1 and 200.' });
      return;
    }

    const typed: { chargeId: string; amount: number }[] = [];
    for (const c of charges) {
      const raw = (amounts[c.id] ?? '').trim();
      if (raw === '') continue;   // untouched blank ≠ a deliberate ₹0
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) {
        setDialog({ title: 'Check the amount', message: `${c.name} must be a number, or left blank.` });
        return;
      }
      if (c.amount === n) continue;   // unchanged
      typed.push({ chargeId: c.id, amount: n });
    }

    if (tip.trim() !== '' && (!Number.isFinite(tipNum) || tipNum < 0)) {
      setDialog({ title: 'Check the tip', message: 'Enter a tip of zero or more.' });
      return;
    }
    if (tipNum > 0 && tipRemainder < 0) {
      setDialog({ title: 'Check the split', message: 'The shares add up to more than the tip.' });
      return;
    }

    const coversChanged = covers.trim() !== loaded.current.covers;
    const tipChanged = tip.trim() !== loaded.current.tip;
    const allocChanged = allocKey(allocations) !== loaded.current.allocations;

    if (!coversChanged && typed.length === 0 && !tipChanged && !allocChanged) {
      leave();
      return;
    }

    setSaving(true);
    try {
      // Order matters: the charges and the tip each re-price the session, and
      // allocations can only hang off a tip that already exists.
      if (coversChanged || typed.length > 0) {
        await crewSessions.saveAdjustments(sessionId, {
          ...(coversChanged ? { coverCount } : {}),
          ...(typed.length > 0 ? { charges: typed } : {}),
        });
      }
      if (tipChanged) {
        await crewSessions.setTip(sessionId, tipNum);
      }
      if (tipNum > 0 && (allocChanged || tipChanged)) {
        await crewSessions.allocateTip(sessionId, allocations.filter((a) => a.amount > 0));
      }
      // Every caller re-reads the bill on focus, so going back IS the refresh.
      leave();
    } catch (e: any) {
      const code = e?.code as string | undefined;
      const msg =
        code === 'NO_COLLECTIBLE_ORDERS'
          ? 'This bill is already paid — nothing left to adjust.'
          : code === 'CHARGE_WRONG_CHANNEL'
            ? 'That charge does not apply to this kind of order.'
            : code === 'CHARGE_INACTIVE'
              ? 'That charge has been switched off in settings.'
              : code === 'ALLOCATION_EXCEEDS_TIP'
                ? 'The shares add up to more than the tip.'
                : (typeof e?.message === 'string' && e.message) || 'Please try again.';
      setDialog({ title: 'Could not save', message: msg });
    } finally {
      setSaving(false);
    }
  };

  // ── The one row that stands in for the whole staff list ──
  const assignedStaff = allocations
    .map((a) => staff.find((m) => m.id === a.staffMemberId))
    .filter((m): m is Staff => !!m);

  const assignSummary =
    assignedStaff.length === 0 ? 'Unassigned'
      : assignedStaff.length === 1 ? assignedStaff[0]!.name
        : assignedStaff.length === 2 ? `${assignedStaff[0]!.name} +1`
          : `${assignedStaff.length} people`;

  const field = (
    key: string,
    label: string,
    hint: string,
    prefix: React.ReactNode,
    value: string,
    onChange: (v: string) => void,
    placeholder: string,
    keyboard: 'number-pad' | 'decimal-pad',
    maxLength?: number,
  ) => (
    <View key={key} style={s.field}>
      <View style={s.rowHead}>
        <Text style={s.label}>{label}</Text>
        <Text style={s.taxHint}>{hint}</Text>
      </View>
      <View style={s.inputWrap}>
        <View style={s.prefix}>{prefix}</View>
        <View style={s.divider} />
        <TextInput
          style={s.input}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={QuinckleColors.textMuted}
          keyboardType={keyboard}
          returnKeyType="done"
          maxLength={maxLength}
          editable={!saving}
        />
      </View>
    </View>
  );

  return (
    <View style={s.fill}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* The table stays mounted underneath (transparentModal) — this dims the
          bill being adjusted, not a blank canvas. */}
      {/* Captures touches rather than passing them through: the card's rounded
          corners leave slivers of the table below exposed, and a tap there must
          not reach a screen the crew thinks is covered. */}
      <Animated.View
        style={[
          s.backdrop,
          { opacity: enter.interpolate({ inputRange: [0, 1], outputRange: [0, 0.55] }) },
        ]}
      />

      <Animated.View
        style={[
          s.root,
          { paddingTop: insets.top },
          {
            opacity: enter,
            transform: [
              { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [22, 0] }) },
              { scale: enter.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
            ],
          },
        ]}
      >

      <View style={s.header}>
        <TouchableOpacity
          onPress={onBack}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={24} color={QuinckleColors.textPrimary} />
        </TouchableOpacity>
        <View>
          <Text style={s.headerTitle}>Adjust bill</Text>
          {!!subtitle && <Text style={s.headerSub}>{subtitle}</Text>}
        </View>
        {billTotal != null
          ? <Text style={s.headerTotal}>₹{billTotal.toFixed(0)}</Text>
          : <View style={s.headerSpacer} />}
      </View>

      {loading ? (
        <FormSkeleton />
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={insets.top + 52}
        >
          <ScrollView
            style={{ flex: 1 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={s.scroll}
          >
            <Text style={s.section}>Charges</Text>

            {field(
              'covers', 'Party size', capacity ? `Table seats ${capacity}` : 'Optional',
              <Ionicons name="people-outline" size={17} color={QuinckleColors.textSecondary} />,
              covers, (v) => setCovers(v.replace(/[^0-9]/g, '')),
              'Number of guests', 'number-pad', 3,
            )}
            <Text style={s.hint}>For per-guest charges. Leave blank if you don&apos;t charge per head.</Text>

            <View style={{ height: Spacing.lg }} />

            {charges.map((c) => field(
              c.id, c.name, taxHint(c),
              <Text style={s.prefixText}>₹</Text>,
              amounts[c.id] ?? '', (v) => setAmounts((a) => ({ ...a, [c.id]: money(v) })),
              '0', 'decimal-pad',
            ))}

            {charges.length === 0 && (
              <Text style={s.hint}>
                No charges on this bill are set to be entered by staff. An owner can turn
                that on for a charge in Settings → Billing.
              </Text>
            )}

            <Text style={s.section}>Tip</Text>

            {field(
              'tip', 'Amount', 'Never taxed',
              <Text style={s.prefixText}>₹</Text>,
              tip,
              // Editing the amount never touches the split. Backspacing ₹50 to
              // ₹5 on the way to ₹60 would otherwise wipe it, and re-deciding
              // who gets what is a worse interruption than a red line saying
              // the shares are over.
              (v) => setTip(money(v)),
              '0', 'decimal-pad',
            )}

            {tipNum > 0 && (
              <>
                <TouchableOpacity
                  style={s.assignRow}
                  onPress={() => setAssignOpen(true)}
                  activeOpacity={0.75}
                  accessibilityRole="button"
                  accessibilityLabel={`Tip goes to ${assignSummary}`}
                >
                  {assignedStaff.length === 0 ? (
                    <View style={s.assignEmpty}>
                      <Ionicons name="add" size={16} color={QuinckleColors.textTertiary} />
                    </View>
                  ) : (
                    <View style={s.stack}>
                      {assignedStaff.slice(0, 3).map((m, i) => (
                        <View key={m.id} style={[s.stackItem, i > 0 && s.stackOverlap]}>
                          <StaffAvatar id={m.id} name={m.name} photoUrl={m.photoUrl} size={32} />
                        </View>
                      ))}
                    </View>
                  )}
                  <View style={s.assignWho}>
                    <Text style={s.assignLabel}>Tip goes to</Text>
                    <Text style={[s.assignValue, assignedStaff.length === 0 && s.assignValueEmpty]} numberOfLines={1}>
                      {assignSummary}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={QuinckleColors.textTertiary} />
                </TouchableOpacity>

                <Text style={[s.hint, tipRemainder < 0 && { color: QuinckleColors.danger }]}>
                  {tipRemainder < 0
                    ? `₹${Math.abs(tipRemainder).toFixed(0)} more than the tip is handed out.`
                    : tipRemainder > 0 && assignedStaff.length > 0
                      ? `₹${tipRemainder.toFixed(0)} of it is still unassigned.`
                      : 'The dashboard lists unassigned tips for someone to sort out later.'}
                </Text>
              </>
            )}
          </ScrollView>

          <View style={[s.footer, { paddingBottom: insets.bottom + Spacing.lg }]}>
            <TouchableOpacity
              style={[s.save, (saving || !dirty || tipRemainder < 0) && s.saveOff]}
              onPress={() => void handleSave()}
              disabled={saving || !dirty || tipRemainder < 0}
              activeOpacity={0.85}
            >
              {saving
                ? <ActivityIndicator size="small" color="#fff" />
                : (
                  <Text style={s.saveText}>
                    {tipRemainder < 0 ? 'Shares are over the tip'
                      : dirty ? 'Save changes'
                        : 'Nothing to save'}
                  </Text>
                )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      )}

      </Animated.View>

      <AssignTipSheet
        visible={assignOpen}
        tip={tipNum}
        staff={staff}
        value={allocations}
        onClose={() => setAssignOpen(false)}
        onDone={(next) => { setAllocations(next); setAssignOpen(false); }}
      />

      <ThemedDialog
        visible={!!dialog}
        title={dialog?.title ?? ''}
        message={dialog?.message ?? ''}
        actions={[{ label: 'OK', onPress: () => setDialog(null) }]}
        onClose={() => setDialog(null)}
      />

      <ThemedDialog
        visible={confirmLeave}
        title="Discard changes?"
        message="What you typed on this bill has not been saved."
        actions={[
          { label: 'Keep editing', onPress: () => setConfirmLeave(false) },
          { label: 'Discard', variant: 'danger', onPress: () => { setConfirmLeave(false); leave(); } },
        ]}
        onClose={() => setConfirmLeave(false)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000' },
  root: {
    flex: 1,
    backgroundColor: QuinckleColors.background,
    // Rounded while it lifts, so the dimmed table shows at the corners instead
    // of a hard square edge sliding over it.
    borderRadius: Radius.xl,
    overflow: 'hidden',
  },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg, height: 52,
  },
  headerTitle: { color: QuinckleColors.textPrimary, fontSize: 16, fontWeight: '700', textAlign: 'center' },
  headerSub: { color: QuinckleColors.textTertiary, fontSize: 11, textAlign: 'center', marginTop: 1 },
  headerTotal: {
    color: QuinckleColors.textSecondary, fontSize: 14, fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  headerSpacer: { width: 24 },

  scroll: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.xxl },

  section: {
    ...Typography.label,
    color: QuinckleColors.textTertiary,
    marginTop: Spacing.xl,
    marginBottom: Spacing.md,
  },

  field: { marginBottom: Spacing.md },
  // The margin lives here, not on the label, so the hint on the right sits
  // level with it instead of riding high.
  rowHead: {
    flexDirection: 'row', alignItems: 'baseline',
    justifyContent: 'space-between', marginBottom: 6,
  },
  label: { ...Typography.caption, color: QuinckleColors.textPrimary },
  taxHint: { fontSize: 11, color: QuinckleColors.textTertiary },
  hint: { fontSize: 11.5, lineHeight: 16, color: QuinckleColors.textTertiary, marginTop: 6 },

  inputWrap: {
    flexDirection: 'row', height: 48, overflow: 'hidden',
    backgroundColor: QuinckleColors.surfaceElevated,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: QuinckleColors.border,
  },
  // A fixed width, not height:'100%' — every field's value then starts on the
  // same left edge down the column.
  prefix: {
    width: 44, alignItems: 'center', justifyContent: 'center',
    backgroundColor: QuinckleColors.surfaceMuted,
  },
  prefixText: { fontSize: 15, color: QuinckleColors.textSecondary },
  // A fixed 20, not 60% of 48 — 28.8px lands off-pixel and renders soft.
  divider: {
    width: StyleSheet.hairlineWidth, height: 20, alignSelf: 'center',
    backgroundColor: QuinckleColors.border,
  },
  input: {
    flex: 1, height: '100%', paddingHorizontal: Spacing.md,
    fontSize: 15, color: QuinckleColors.textPrimary,
  },

  assignRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    minHeight: 60, paddingHorizontal: Spacing.lg,
    backgroundColor: QuinckleColors.surfaceElevated,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: QuinckleColors.border,
  },
  assignEmpty: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: QuinckleColors.borderStrong, borderStyle: 'dashed',
  },
  stack: { flexDirection: 'row' },
  stackItem: {
    borderRadius: 18, borderWidth: 2,
    borderColor: QuinckleColors.surfaceElevated,
  },
  stackOverlap: { marginLeft: -12 },
  assignWho: { flex: 1 },
  assignLabel: { fontSize: 12, color: QuinckleColors.textSecondary },
  assignValue: { fontSize: 14, color: QuinckleColors.textPrimary, marginTop: 2 },
  assignValueEmpty: { color: QuinckleColors.textTertiary },

  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: QuinckleColors.border,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
  },
  save: {
    height: 52, borderRadius: Radius.lg,
    alignItems: 'center', justifyContent: 'center',
    // Not success green — in this app that means money collected.
    backgroundColor: QuinckleColors.primary,
  },
  saveOff: { opacity: 0.4 },
  saveText: { ...Typography.bodyStrong, color: '#fff' },
});
