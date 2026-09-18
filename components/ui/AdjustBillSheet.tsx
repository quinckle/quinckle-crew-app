/**
 * AdjustBillSheet — the party size and the charge amounts the biller types.
 *
 * Container and delivery charges scale with the order (ten biryanis need ten
 * containers), so the amount cannot come from config. The CHARGE is configured
 * — its name, GST treatment and channel scope — and only the number is entered
 * here, which is what keeps a typed amount correctly taxed on the bill.
 *
 * Deliberately NOT manager-PIN gated, unlike GiveDiscountModal. Every action
 * behind that PIN gives money away — write off, clear the bill, refund, cancel
 * cooked food. This takes money IN, and it happens on ordinary takeaway orders,
 * so a PIN would mean fetching a manager to bill a parcel. The backend records
 * who entered each amount instead.
 *
 * Saving re-prices every unpaid order server-side and voids any mid-flight
 * payment request, so the caller MUST re-read the bill afterwards rather than
 * trusting what is on screen — see onApplied.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
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

interface Props {
  visible: boolean;
  onClose: () => void;
  sessionId: string;
  /** Shown under the title, e.g. "Table 5" or a pickup token. */
  subtitle?: string;
  /** Re-read the bill: totals have changed and any payment request was voided. */
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
  // What the server had when the sheet opened, so Save can tell a real edit
  // from an untouched field.
  const [loadedCovers, setLoadedCovers] = useState('');

  // The parents pass `onError` as an inline arrow, so it is a new function on
  // every one of their renders — and the table screen re-renders constantly
  // (a poll timer plus realtime pushes). Holding it in a ref keeps it OUT of
  // the effect below: with it in the dependency array the sheet re-fetched on
  // every parent render, flashing the spinner and — far worse — overwriting
  // whatever amount the biller was in the middle of typing.
  const onErrorRef = useRef(onError);
  useEffect(() => { onErrorRef.current = onError; });

  // Re-read on every open: another device may have billed this table since,
  // and a stale amount here would be saved back over theirs.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    crewSessions
      .getAdjustments(sessionId)
      .then((res) => {
        if (cancelled) return;
        const data = res.data;
        setCharges(data.charges);
        const covs = data.coverCount != null ? String(data.coverCount) : '';
        setCovers(covs);
        setLoadedCovers(covs);
        setCapacity(data.tableCapacity ?? null);
        setAmounts(
          Object.fromEntries(
            data.charges.map((c) => [c.id, c.amount != null ? String(c.amount) : '']),
          ),
        );
      })
      .catch(() => {
        if (!cancelled) onErrorRef.current('Could not load', 'Please try again.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Re-reads only when the sheet OPENS, or for a different session.
  }, [visible, sessionId]);

  const handleSave = async () => {
    const coverCount = covers.trim() === '' ? null : Number(covers);
    if (coverCount != null && (!Number.isInteger(coverCount) || coverCount < 1 || coverCount > 200)) {
      onError('Check the party size', 'Enter a whole number of guests between 1 and 200.');
      return;
    }

    // Only send what was actually typed. An untouched blank stays absent rather
    // than being written as a deliberate ₹0 — the two mean different things.
    const typed: { chargeId: string; amount: number }[] = [];
    for (const c of charges) {
      const raw = (amounts[c.id] ?? '').trim();
      if (raw === '') continue;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) {
        onError('Check the amount', `${c.name} must be a number, or left blank.`);
        return;
      }
      if (c.amount === n) continue; // unchanged
      typed.push({ chargeId: c.id, amount: n });
    }

    // Compare against what was loaded, not against emptiness. The old test was
    // the same condition twice, which broke it both ways: clearing a party size
    // never saved, and merely opening the sheet on a table that had one
    // re-priced the session and voided its payment request for nothing.
    const coversChanged = covers.trim() !== loadedCovers;
    if (typed.length === 0 && !coversChanged) {
      onClose();
      return;
    }

    setSaving(true);
    try {
      await crewSessions.saveAdjustments(sessionId, {
        ...(coversChanged ? { coverCount } : {}),
        ...(typed.length > 0 ? { charges: typed } : {}),
      });
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
              : (typeof e?.message === 'string' && e.message) || 'Please try again.';
      onError('Could not save', msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>Bill</Text>
          <Text style={styles.title}>Adjust bill</Text>
          {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}

          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={QuinckleColors.primary} />
            </View>
          ) : (
            <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled">
              <Text style={styles.label}>Party size</Text>
              <View style={styles.inputWrap}>
                <TextInput
                  style={[styles.input, { paddingLeft: 14 }]}
                  value={covers}
                  onChangeText={(v) => setCovers(v.replace(/[^0-9]/g, ''))}
                  placeholder={capacity ? `e.g. ${capacity}` : 'Number of guests'}
                  placeholderTextColor={QuinckleColors.textMuted}
                  keyboardType="number-pad"
                  returnKeyType="done"
                  maxLength={3}
                />
              </View>
              <Text style={styles.hint}>
                Used for per-guest charges. Leave blank if you are not charging per head.
              </Text>

              {charges.length === 0 ? (
                <Text style={[styles.hint, { marginTop: Spacing.lg }]}>
                  No charges on this bill are set to be entered by staff. An owner can
                  turn that on for a charge in Settings → Billing.
                </Text>
              ) : (
                charges.map((c) => (
                  <View key={c.id} style={{ marginTop: Spacing.lg }}>
                    <View style={styles.rowHead}>
                      <Text style={styles.label}>{c.name}</Text>
                      <Text style={styles.taxHint}>{taxHint(c)}</Text>
                    </View>
                    <View style={styles.inputWrap}>
                      <View style={styles.prefix}>
                        <Text style={styles.prefixText}>₹</Text>
                      </View>
                      <View style={styles.divider} />
                      <TextInput
                        style={styles.input}
                        value={amounts[c.id] ?? ''}
                        onChangeText={(v) =>
                          setAmounts((a) => ({ ...a, [c.id]: v.replace(/[^0-9.]/g, '') }))
                        }
                        placeholder="0"
                        placeholderTextColor={QuinckleColors.textMuted}
                        keyboardType="decimal-pad"
                        returnKeyType="done"
                      />
                    </View>
                  </View>
                ))
              )}
            </ScrollView>
          )}

          <View style={styles.footer}>
            <TouchableOpacity style={styles.cancel} onPress={onClose} disabled={saving}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.confirm, (saving || loading) && { opacity: 0.6 }]}
              onPress={handleSave}
              disabled={saving || loading}
              activeOpacity={0.85}
            >
              {saving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.confirmText}>Save</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: QuinckleColors.surface,
    borderRadius: Radius.xl,
    padding: Spacing.lg,
    borderColor: QuinckleColors.border,
    borderWidth: 1,
  },
  eyebrow: {
    color: QuinckleColors.textTertiary,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  title: {
    color: QuinckleColors.textPrimary,
    fontSize: 17,
    fontWeight: '700',
    marginTop: 4,
    letterSpacing: -0.3,
  },
  subtitle: {
    color: QuinckleColors.textSecondary,
    fontSize: 12.5,
    marginTop: 4,
    marginBottom: Spacing.md,
  },
  loading: { paddingVertical: Spacing.xl * 2, alignItems: 'center' },
  rowHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  label: {
    color: QuinckleColors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  taxHint: { color: QuinckleColors.textTertiary, fontSize: 11 },
  hint: { color: QuinckleColors.textTertiary, fontSize: 11.5, marginTop: 6, lineHeight: 16 },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: QuinckleColors.surfaceElevated,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    height: 48,
    overflow: 'hidden',
  },
  prefix: { paddingHorizontal: 12, height: '100%', justifyContent: 'center' },
  prefixText: { color: QuinckleColors.textSecondary, fontSize: 14, fontWeight: '600' },
  divider: { width: 1, height: '60%', backgroundColor: QuinckleColors.border },
  input: {
    flex: 1,
    color: QuinckleColors.textPrimary,
    fontSize: 15,
    paddingHorizontal: 12,
    height: '100%',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.lg,
  },
  cancel: { paddingHorizontal: Spacing.md, paddingVertical: 10 },
  cancelText: { color: QuinckleColors.textSecondary, fontSize: 13, fontWeight: '600' },
  confirm: {
    backgroundColor: QuinckleColors.success,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 10,
  },
  confirmText: { color: '#fff', fontSize: 13, fontWeight: '700' },
});
