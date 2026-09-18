/**
 * AdjustBillSheet — everything that changes a bill, in ONE bottom sheet.
 *
 * Party size, the charges a biller types per order (container, delivery), the
 * tip, and who the tip is for. Previously these were four separate surfaces
 * opened at three different moments; a biller thinks "container ₹40, tip ₹50"
 * as one action, so it is one sheet with one Save.
 *
 * A BottomSheet rather than a centred dialog because that is what this app
 * uses — sixteen other sheets do — and because it brings KeyboardAvoidingView
 * with it, which a form of number inputs on a phone genuinely needs.
 *
 * Tips are not a payroll input. Assignment here records who received what, and
 * stops there.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheet } from './BottomSheet';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';
import { crewSessions } from '../../services/api';

type VariableCharge = {
  id: string;
  name: string;
  amount: number | null;
  taxTreatment: 'FOLLOW_ITEMS' | 'FIXED_RATE' | 'EXEMPT';
  taxRatePercent: number | null;
  includesTax: boolean | null;
};

type Staff = { id: string; name: string; role: string };

interface Props {
  visible: boolean;
  onClose: () => void;
  sessionId: string;
  /** Shown under the title, e.g. the table label or pickup token. */
  subtitle?: string;
  /** Re-read the bill: totals changed and any payment request was voided. */
  onApplied: () => void;
  onError: (title: string, message: string) => void;
}

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

export function AdjustBillSheet({
  visible,
  onClose,
  sessionId,
  subtitle,
  onApplied,
  onError,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [charges, setCharges] = useState<VariableCharge[]>([]);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [covers, setCovers] = useState('');
  const [capacity, setCapacity] = useState<number | null>(null);
  const [tip, setTip] = useState('');
  const [staff, setStaff] = useState<Staff[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [shares, setShares] = useState<Record<string, string>>({});

  // What the server had when the sheet opened, so Save can tell a real edit
  // from an untouched field and skip work that would needlessly re-price the
  // session and void its payment request.
  const loaded = useRef({ covers: '', tip: '', allocations: '' });

  // The parents pass these as inline arrows — new functions on every one of
  // their renders, and the table screen re-renders constantly. Held in a ref so
  // they stay OUT of the effect below, which otherwise re-fetched on every
  // parent render and overwrote whatever was being typed.
  const onErrorRef = useRef(onError);
  useEffect(() => { onErrorRef.current = onError; });

  useEffect(() => {
    if (!visible) return;
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
        setSelected(t.allocations.map((x) => x.staffMemberId));
        setShares(Object.fromEntries(t.allocations.map((x) => [x.staffMemberId, String(x.amount)])));

        loaded.current = {
          covers: covs,
          tip: tipStr,
          allocations: JSON.stringify(
            t.allocations.map((x) => [x.staffMemberId, x.amount]).sort(),
          ),
        };
      })
      .catch(() => { if (!cancelled) onErrorRef.current('Could not load', 'Please try again.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // Re-reads only when the sheet OPENS, or for a different session.
  }, [visible, sessionId]);

  const tipNum = Number(tip) || 0;

  /** Even split with the remainder on the first person, so ₹100 across three is
   *  34/33/33 and the parts still sum to the tip. */
  const evenSplit = (ids: string[], total: number): Record<string, string> => {
    if (ids.length === 0) return {};
    const each = Math.floor((total / ids.length) * 100) / 100;
    const out: Record<string, string> = {};
    ids.forEach((id) => { out[id] = String(each); });
    const rem = Number((total - each * ids.length).toFixed(2));
    if (rem > 0 && ids[0]) out[ids[0]] = String(Number((each + rem).toFixed(2)));
    return out;
  };

  const toggleStaff = (id: string) => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    setSelected(next);
    setShares(evenSplit(next, tipNum));
  };

  const assigned = useMemo(
    () => Number(selected.reduce((s, id) => s + (Number(shares[id]) || 0), 0).toFixed(2)),
    [selected, shares],
  );
  const tipRemainder = Number((tipNum - assigned).toFixed(2));

  const handleSave = async () => {
    // ── Validate everything BEFORE writing anything, so a bad tip cannot land
    // after the charges have already been saved. ──
    const coverCount = covers.trim() === '' ? null : Number(covers);
    if (coverCount != null && (!Number.isInteger(coverCount) || coverCount < 1 || coverCount > 200)) {
      onError('Check the party size', 'Enter a whole number of guests between 1 and 200.');
      return;
    }

    const typed: { chargeId: string; amount: number }[] = [];
    for (const c of charges) {
      const raw = (amounts[c.id] ?? '').trim();
      if (raw === '') continue;   // untouched blank ≠ a deliberate ₹0
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) {
        onError('Check the amount', `${c.name} must be a number, or left blank.`);
        return;
      }
      if (c.amount === n) continue;   // unchanged
      typed.push({ chargeId: c.id, amount: n });
    }

    if (tip.trim() !== '' && (!Number.isFinite(tipNum) || tipNum < 0)) {
      onError('Check the tip', 'Enter a tip of zero or more.');
      return;
    }
    if (tipNum > 0 && tipRemainder < 0) {
      onError('Check the split', 'The shares add up to more than the tip.');
      return;
    }

    const coversChanged = covers.trim() !== loaded.current.covers;
    const tipChanged = tip.trim() !== loaded.current.tip;
    const allocNow = JSON.stringify(
      selected
        .map((id) => [id, Number(shares[id]) || 0] as [string, number])
        .filter(([, amt]) => amt > 0)
        .sort(),
    );
    const allocChanged = allocNow !== loaded.current.allocations;

    if (!coversChanged && typed.length === 0 && !tipChanged && !allocChanged) {
      onClose();
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
        await crewSessions.allocateTip(
          sessionId,
          selected
            .map((id) => ({ staffMemberId: id, amount: Number(shares[id]) || 0 }))
            .filter((a) => a.amount > 0),
        );
      }
      onClose();
      onApplied();
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
      onError('Could not save', msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Adjust bill">
      <View style={s.body}>
        {!!subtitle && <Text style={s.subtitle}>{subtitle}</Text>}

        {loading ? (
          <View style={s.loading}><ActivityIndicator color={QuinckleColors.primary} /></View>
        ) : (
          <>
            <Text style={s.label}>Party size</Text>
            <View style={s.inputWrap}>
              <TextInput
                style={[s.input, { paddingLeft: 14 }]}
                value={covers}
                onChangeText={(v) => setCovers(v.replace(/[^0-9]/g, ''))}
                placeholder={capacity ? `e.g. ${capacity}` : 'Number of guests'}
                placeholderTextColor={QuinckleColors.textMuted}
                keyboardType="number-pad"
                returnKeyType="done"
                maxLength={3}
              />
            </View>
            <Text style={s.hint}>For per-guest charges. Leave blank if you don&apos;t charge per head.</Text>

            {charges.map((c) => (
              <View key={c.id} style={{ marginTop: Spacing.lg }}>
                <View style={s.rowHead}>
                  <Text style={s.label}>{c.name}</Text>
                  <Text style={s.taxHint}>{taxHint(c)}</Text>
                </View>
                <View style={s.inputWrap}>
                  <View style={s.prefix}><Text style={s.prefixText}>₹</Text></View>
                  <View style={s.divider} />
                  <TextInput
                    style={s.input}
                    value={amounts[c.id] ?? ''}
                    onChangeText={(v) => setAmounts((a) => ({ ...a, [c.id]: money(v) }))}
                    placeholder="0"
                    placeholderTextColor={QuinckleColors.textMuted}
                    keyboardType="decimal-pad"
                    returnKeyType="done"
                  />
                </View>
              </View>
            ))}

            {charges.length === 0 && (
              <Text style={[s.hint, { marginTop: Spacing.md }]}>
                No charges on this bill are set to be entered by staff. An owner can turn
                that on for a charge in Settings → Billing.
              </Text>
            )}

            <View style={s.sectionBreak} />

            <View style={s.rowHead}>
              <Text style={s.label}>Tip</Text>
              <Text style={s.taxHint}>Never taxed</Text>
            </View>
            <View style={s.inputWrap}>
              <View style={s.prefix}><Text style={s.prefixText}>₹</Text></View>
              <View style={s.divider} />
              <TextInput
                style={s.input}
                value={tip}
                onChangeText={(v) => {
                  const next = money(v);
                  setTip(next);
                  // Keep an existing split summing to the new amount.
                  if (selected.length > 0) setShares(evenSplit(selected, Number(next) || 0));
                }}
                placeholder="0"
                placeholderTextColor={QuinckleColors.textMuted}
                keyboardType="decimal-pad"
                returnKeyType="done"
              />
            </View>

            {/* Only worth asking once there is a tip to give away. Optional by
                design: leaving nobody selected files it as unassigned, which
                the dashboard lists for someone to sort out later. */}
            {tipNum > 0 && (
              <>
                <Text style={[s.hint, { marginTop: 10 }]}>
                  Who gets it? Tap one name, or several to split. Leave blank to decide later.
                </Text>
                {staff.map((m) => {
                  const on = selected.includes(m.id);
                  const splitting = selected.length > 1;
                  return (
                    <TouchableOpacity
                      key={m.id}
                      style={[s.staffRow, on && s.staffRowOn]}
                      onPress={() => toggleStaff(m.id)}
                      activeOpacity={0.8}
                      disabled={saving}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[s.staffName, on && { color: QuinckleColors.primary }]}>{m.name}</Text>
                        <Text style={s.staffRole}>{m.role}</Text>
                      </View>
                      {splitting && on ? (
                        <View style={s.shareWrap}>
                          <Text style={s.prefixText}>₹</Text>
                          <TextInput
                            style={s.shareInput}
                            value={shares[m.id] ?? ''}
                            onChangeText={(v) => setShares((sh) => ({ ...sh, [m.id]: money(v) }))}
                            keyboardType="decimal-pad"
                            returnKeyType="done"
                          />
                        </View>
                      ) : on ? (
                        <Ionicons name="checkmark-circle" size={20} color={QuinckleColors.primary} />
                      ) : null}
                    </TouchableOpacity>
                  );
                })}
                {selected.length > 1 && (
                  <Text style={[s.hint, tipRemainder < 0 && { color: QuinckleColors.danger }]}>
                    {tipRemainder > 0
                      ? `₹${tipRemainder} still unassigned`
                      : tipRemainder < 0
                        ? `₹${Math.abs(tipRemainder)} over the tip`
                        : 'Fully assigned'}
                  </Text>
                )}
              </>
            )}

            <TouchableOpacity
              style={[s.save, saving && { opacity: 0.6 }]}
              onPress={() => void handleSave()}
              disabled={saving}
              activeOpacity={0.85}
            >
              {saving
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={s.saveText}>Save</Text>}
            </TouchableOpacity>
          </>
        )}
      </View>
    </BottomSheet>
  );
}

const s = StyleSheet.create({
  body: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.lg },
  subtitle: { color: QuinckleColors.textSecondary, fontSize: 12.5, marginBottom: Spacing.md },
  loading: { paddingVertical: Spacing.xl * 2, alignItems: 'center' },
  rowHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  label: { color: QuinckleColors.textSecondary, fontSize: 12, fontWeight: '600', marginBottom: 6 },
  taxHint: { color: QuinckleColors.textTertiary, fontSize: 11 },
  hint: { color: QuinckleColors.textTertiary, fontSize: 11.5, marginTop: 6, lineHeight: 16 },
  sectionBreak: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: QuinckleColors.border,
    marginVertical: Spacing.lg,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: QuinckleColors.surfaceElevated,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: QuinckleColors.border,
    height: 48,
    overflow: 'hidden',
  },
  prefix: { paddingHorizontal: 12, height: '100%', justifyContent: 'center' },
  prefixText: { color: QuinckleColors.textSecondary, fontSize: 14, fontWeight: '600' },
  divider: { width: 1, height: '60%', backgroundColor: QuinckleColors.border },
  input: { flex: 1, color: QuinckleColors.textPrimary, fontSize: 15, paddingHorizontal: 12, height: '100%' },
  staffRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: 'transparent',
    marginTop: 4,
  },
  staffRowOn: { borderColor: QuinckleColors.primary, backgroundColor: 'rgba(243,93,59,0.10)' },
  staffName: { color: QuinckleColors.textPrimary, fontSize: 14, fontWeight: '600' },
  staffRole: { color: QuinckleColors.textTertiary, fontSize: 11, marginTop: 2 },
  shareWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: QuinckleColors.surfaceElevated,
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: QuinckleColors.border,
    paddingHorizontal: 8,
    height: 36,
    minWidth: 92,
  },
  shareInput: { flex: 1, color: QuinckleColors.textPrimary, fontSize: 14, paddingHorizontal: 6, height: '100%' },
  save: {
    backgroundColor: QuinckleColors.success,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 13,
    marginTop: Spacing.xl,
  },
  saveText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
