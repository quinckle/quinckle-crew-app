/**
 * TipAssignSheet — who the tip is for.
 *
 * Opens straight after a bill settles, while the biller still knows who served
 * the table. The common case is one person, so that must stay ONE TAP: tapping
 * a name assigns the whole tip and closes. Tapping a second name turns the
 * sheet into a split, with an editable share each and the remainder shown live.
 *
 * SKIP IS A FIRST-CLASS OUTCOME, not a failure. A biller mid-rush should not be
 * held at this screen; an unassigned tip sits on the dashboard until someone
 * deals with it. Nothing here moves money — the tip is already on the bill.
 *
 * Tips are not a payroll input. This records who received what; that is all.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { Ionicons } from '@expo/vector-icons';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';
import { crewSessions } from '../../services/api';

interface Props {
  visible: boolean;
  sessionId: string;
  /** Dismiss without assigning. The tip stays unassigned, which is allowed. */
  onSkip: () => void;
  onDone: () => void;
  onError: (title: string, message: string) => void;
}

type Staff = { id: string; name: string; role: string };

export function TipAssignSheet({ visible, sessionId, onSkip, onDone, onError }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [amount, setAmount] = useState(0);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [shares, setShares] = useState<Record<string, string>>({});

  // Same reason as AdjustBillSheet: an inline `onError` from the parent would
  // re-run the fetch on every parent render and reset a split being edited.
  const onErrorRef = useRef(onError);
  useEffect(() => { onErrorRef.current = onError; });

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    setSelected([]);
    setShares({});
    crewSessions
      .getTip(sessionId)
      .then((res) => {
        if (cancelled) return;
        setAmount(res.data.amount);
        setStaff(res.data.staff);
        // Re-opening on an already-split tip shows the split as it stands.
        if (res.data.allocations.length > 0) {
          setSelected(res.data.allocations.map((a) => a.staffMemberId));
          setShares(
            Object.fromEntries(res.data.allocations.map((a) => [a.staffMemberId, String(a.amount)])),
          );
        }
      })
      .catch(() => { if (!cancelled) onErrorRef.current('Could not load', 'Please try again.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // Re-reads only when the sheet OPENS, or for a different session.
  }, [visible, sessionId]);

  const splitting = selected.length > 1;

  /** Even split, with the remainder on the first person so the parts still sum
   *  to the tip exactly — ₹100 across 3 is 34/33/33, never 33.33 each. */
  const evenSplit = (ids: string[]): Record<string, string> => {
    const each = Math.floor((amount / ids.length) * 100) / 100;
    const out: Record<string, string> = {};
    ids.forEach((id, i) => { out[id] = String(each); });
    const remainder = Number((amount - each * ids.length).toFixed(2));
    if (remainder > 0 && ids[0]) out[ids[0]] = String(Number((each + remainder).toFixed(2)));
    return out;
  };

  const assigned = useMemo(
    () => Number(selected.reduce((s, id) => s + (Number(shares[id]) || 0), 0).toFixed(2)),
    [selected, shares],
  );
  const remainder = Number((amount - assigned).toFixed(2));

  const save = async (ids: string[], amounts: Record<string, string>) => {
    setSaving(true);
    try {
      await crewSessions.allocateTip(
        sessionId,
        ids.map((id) => ({ staffMemberId: id, amount: Number(amounts[id]) || 0 }))
           .filter((a) => a.amount > 0),
      );
      onDone();
    } catch (e: any) {
      const code = e?.code as string | undefined;
      onError(
        'Could not assign tip',
        code === 'ALLOCATION_EXCEEDS_TIP'
          ? `The shares add up to more than the ₹${amount} tip.`
          : (typeof e?.message === 'string' && e.message) || 'Please try again.',
      );
    } finally {
      setSaving(false);
    }
  };

  const tapStaff = (id: string) => {
    // First tap on a fresh sheet: the whole tip, one tap, done.
    if (selected.length === 0) {
      void save([id], { [id]: String(amount) });
      return;
    }
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    setSelected(next);
    setShares(next.length === 0 ? {} : evenSplit(next));
  };

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onSkip}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>Tip</Text>
          <Text style={styles.title}>Who gets this ₹{amount}?</Text>
          <Text style={styles.subtitle}>
            {splitting
              ? 'Adjust each share, or tap a name to remove them.'
              : 'Tap a name. Tap a second to split it.'}
          </Text>

          {loading ? (
            <View style={styles.loading}><ActivityIndicator color={QuinckleColors.primary} /></View>
          ) : (
            <ScrollView style={{ maxHeight: 320 }} keyboardShouldPersistTaps="handled">
              {staff.length === 0 && (
                <Text style={styles.hint}>No active staff to assign this to.</Text>
              )}
              {staff.map((m) => {
                const on = selected.includes(m.id);
                return (
                  <TouchableOpacity
                    key={m.id}
                    style={[styles.row, on && styles.rowOn]}
                    onPress={() => tapStaff(m.id)}
                    activeOpacity={0.8}
                    disabled={saving}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.name, on && { color: QuinckleColors.primary }]}>{m.name}</Text>
                      <Text style={styles.role}>{m.role}</Text>
                    </View>
                    {splitting && on ? (
                      <View style={styles.shareWrap}>
                        <Text style={styles.rupee}>₹</Text>
                        <TextInput
                          style={styles.shareInput}
                          value={shares[m.id] ?? ''}
                          onChangeText={(v) =>
                            setShares((sh) => ({ ...sh, [m.id]: v.replace(/[^0-9.]/g, '') }))
                          }
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
            </ScrollView>
          )}

          {splitting && (
            <Text style={[styles.remainder, remainder < 0 && { color: QuinckleColors.danger }]}>
              {remainder > 0
                ? `₹${remainder} still unassigned`
                : remainder < 0
                  ? `₹${Math.abs(remainder)} over the tip`
                  : 'Fully assigned'}
            </Text>
          )}

          <View style={styles.footer}>
            {/* Skip is deliberately as reachable as Save. */}
            <TouchableOpacity style={styles.cancel} onPress={onSkip} disabled={saving}>
              <Text style={styles.cancelText}>Skip for now</Text>
            </TouchableOpacity>
            {splitting && (
              <TouchableOpacity
                style={[styles.confirm, (saving || remainder < 0) && { opacity: 0.6 }]}
                onPress={() => void save(selected, shares)}
                disabled={saving || remainder < 0}
                activeOpacity={0.85}
              >
                {saving
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.confirmText}>Save split</Text>}
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center', alignItems: 'center', padding: Spacing.lg,
  },
  card: {
    width: '100%', maxWidth: 420, backgroundColor: QuinckleColors.surface,
    borderRadius: Radius.xl, padding: Spacing.lg,
    borderColor: QuinckleColors.border, borderWidth: 1,
  },
  eyebrow: {
    color: QuinckleColors.textTertiary, fontSize: 10, fontWeight: '700',
    letterSpacing: 1.5, textTransform: 'uppercase',
  },
  title: {
    color: QuinckleColors.textPrimary, fontSize: 17, fontWeight: '700',
    marginTop: 4, letterSpacing: -0.3,
  },
  subtitle: {
    color: QuinckleColors.textSecondary, fontSize: 12.5,
    marginTop: 4, marginBottom: Spacing.md,
  },
  loading: { paddingVertical: Spacing.xl * 2, alignItems: 'center' },
  hint: { color: QuinckleColors.textTertiary, fontSize: 12, paddingVertical: Spacing.md },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, paddingHorizontal: 12,
    borderRadius: Radius.md, borderWidth: 1, borderColor: 'transparent',
  },
  rowOn: { borderColor: QuinckleColors.primary, backgroundColor: 'rgba(243,93,59,0.10)' },
  name: { color: QuinckleColors.textPrimary, fontSize: 14, fontWeight: '600' },
  role: { color: QuinckleColors.textTertiary, fontSize: 11, marginTop: 2 },
  shareWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: QuinckleColors.surfaceElevated,
    borderRadius: Radius.sm, borderWidth: 1, borderColor: QuinckleColors.border,
    paddingHorizontal: 8, height: 36, minWidth: 92,
  },
  rupee: { color: QuinckleColors.textSecondary, fontSize: 13, fontWeight: '600' },
  shareInput: {
    flex: 1, color: QuinckleColors.textPrimary, fontSize: 14,
    paddingHorizontal: 6, height: '100%',
  },
  remainder: {
    color: QuinckleColors.textSecondary, fontSize: 12,
    textAlign: 'center', marginTop: Spacing.md,
  },
  footer: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.lg,
  },
  cancel: { paddingHorizontal: Spacing.md, paddingVertical: 10 },
  cancelText: { color: QuinckleColors.textSecondary, fontSize: 13, fontWeight: '600' },
  confirm: {
    backgroundColor: QuinckleColors.success, borderRadius: Radius.md,
    paddingHorizontal: Spacing.lg, paddingVertical: 10,
  },
  confirmText: { color: '#fff', fontSize: 13, fontWeight: '700' },
});
