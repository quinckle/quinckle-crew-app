/**
 * GiveDiscountModal — crew-applied PERCENT/FLAT discount on one session.
 *
 * Posts to the same session-scoped endpoint the table screen uses
 * (POST /api/crew/sessions/:id/discount). That service is channel-agnostic —
 * it resolves the session, recomputes each unpaid order through
 * computeFinalTotal, and reads the channel off the order itself — so a
 * tableless TAKEAWAY session goes through it unchanged.
 *
 * Deliberately a SEPARATE component from the discount modal inlined in
 * app/(staff)/[tableId].tsx rather than a shared extraction of it: this shipped
 * to give the takeaway board the feature without editing a live dine-in money
 * path. The two are expected to converge later; until then, a change to the
 * exemption rules has to be made in both.
 */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';
import { crewSessions } from '../../services/api';
import { ReasonChips } from './ReasonSheet';
import { useManagerApproval } from './ManagerPinSheet';
import {
  EXEMPTION_REASONS,
  isReasonComplete,
  toReasonPayload,
  wouldZeroBill,
} from '../../constants/adjustmentReasons';

type DiscountType = 'PERCENT' | 'FLAT';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Session the order hangs off. The caller must not open this without one. */
  sessionId: string;
  /** Current payable, used only to decide whether this zeroes the bill. */
  currentTotal: number;
  /** Crew portion already applied — prefills the sheet when editing. */
  currentManualDiscount?: number;
  currentNote?: string | null;
  isAdmin: boolean;
  /** Shown under the title, e.g. the pickup token. */
  subtitle?: string;
  onApplied: () => void;
  onError: (title: string, message: string) => void;
}

export function GiveDiscountModal({
  visible,
  onClose,
  sessionId,
  currentTotal,
  currentManualDiscount = 0,
  currentNote,
  isAdmin,
  subtitle = "Applies to this order's unpaid amount.",
  onApplied,
  onError,
}: Props) {
  const { sheet: managerPinSheet, runWithApproval } = useManagerApproval();

  const [type, setType] = useState<DiscountType>('PERCENT');
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [exemptCode, setExemptCode] = useState<string | null>(null);
  const [exemptText, setExemptText] = useState('');
  const [applying, setApplying] = useState(false);

  // Re-seed on every open so a previous order's numbers never carry over.
  // An existing crew discount prefills as FLAT: the stored column is rupees,
  // and re-deriving the percent someone originally typed is guesswork.
  useEffect(() => {
    if (!visible) return;
    const editing = currentManualDiscount > 0;
    setType(editing ? 'FLAT' : 'PERCENT');
    setValue(editing ? String(currentManualDiscount) : '');
    setNote(currentNote ?? '');
    setExemptCode(null);
    setExemptText('');
    setApplying(false);
  }, [visible, currentManualDiscount, currentNote]);

  const zeroesBill = wouldZeroBill(type, Number(value), currentTotal);
  const canApply =
    parseFloat(value) > 0 &&
    !applying &&
    (!zeroesBill || isReasonComplete(exemptCode, exemptText));

  const handleApply = async () => {
    const v = Number(value);
    if (!Number.isFinite(v) || v <= 0) {
      onError('Invalid amount', 'Enter a discount greater than zero.');
      return;
    }
    if (type === 'PERCENT' && v > 100) {
      onError('Invalid percentage', 'Percentage cannot exceed 100%.');
      return;
    }
    // Clearing the whole bill is an exemption, not a discount: the backend
    // gates it and records it on the adjustments ledger.
    if (zeroesBill && !isReasonComplete(exemptCode, exemptText)) return;
    const coded = zeroesBill ? toReasonPayload(exemptCode!, exemptText) : undefined;

    setApplying(true);
    try {
      await runWithApproval({ action: 'EXEMPT_SESSION', amount: currentTotal }, async (mint) => {
        const grantId = mint ? await mint(sessionId, null) : undefined;
        await crewSessions.applyDiscount(sessionId, type, v, note.trim() || null, coded, grantId);
      });
      onClose();
      onApplied();
    } catch (e: any) {
      const code = e?.code as string | undefined;
      const msg =
        code === 'NO_DISCOUNTABLE_ORDERS'
          ? 'This order is already paid — nothing to discount.'
          : code === 'ADMIN_REQUIRED' || code === 'AUTHORIZATION_REQUIRED'
            ? 'A manager must approve clearing the whole bill.'
            : (typeof e?.message === 'string' && e.message) || 'Please try again.';
      onError('Could not apply discount', msg);
    } finally {
      setApplying(false);
    }
  };

  return (
    <>
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <Text style={styles.eyebrow}>Discount</Text>
            <Text style={styles.title}>
              {currentManualDiscount > 0 ? 'Edit discount' : 'Give a discount'}
            </Text>
            <Text style={styles.subtitle}>{subtitle}</Text>

            <View style={styles.segToggle}>
              <TouchableOpacity
                style={[styles.segBtn, type === 'PERCENT' && styles.segBtnActive]}
                onPress={() => setType('PERCENT')}
                activeOpacity={0.85}
              >
                <Text style={[styles.segBtnText, type === 'PERCENT' && styles.segBtnTextActive]}>
                  Percentage
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.segBtn, type === 'FLAT' && styles.segBtnActive]}
                onPress={() => setType('FLAT')}
                activeOpacity={0.85}
              >
                <Text style={[styles.segBtnText, type === 'FLAT' && styles.segBtnTextActive]}>
                  Flat ₹
                </Text>
              </TouchableOpacity>
            </View>

            <View style={[styles.inputWrap, { marginTop: 14 }]}>
              <View style={styles.prefix}>
                <Text style={styles.prefixText}>{type === 'PERCENT' ? '%' : '₹'}</Text>
              </View>
              <View style={styles.divider} />
              <TextInput
                style={styles.input}
                value={value}
                onChangeText={(v) => setValue(v.replace(/[^0-9.]/g, ''))}
                placeholder={type === 'PERCENT' ? 'e.g. 10' : 'e.g. 50'}
                placeholderTextColor={QuinckleColors.textMuted}
                keyboardType="decimal-pad"
                returnKeyType="done"
                autoFocus
              />
            </View>

            <View style={[styles.inputWrap, { marginTop: 10 }]}>
              <TextInput
                style={[styles.input, { paddingLeft: 14 }]}
                value={note}
                onChangeText={setNote}
                placeholder="Reason (optional)"
                placeholderTextColor={QuinckleColors.textMuted}
                maxLength={200}
                returnKeyType="done"
              />
            </View>

            {/* Zeroing the bill is an exemption, not a discount — say why. A
                non-admin can still do it; a manager approves with the PIN. */}
            {zeroesBill && (
              <>
                <ReasonChips
                  reasons={EXEMPTION_REASONS}
                  prompt="This clears the whole bill. Why?"
                  code={exemptCode}
                  text={exemptText}
                  onPickCode={setExemptCode}
                  onChangeText={setExemptText}
                  disabled={applying}
                />
                {!isAdmin && (
                  <Text style={styles.adminNote}>A manager will be asked to approve this.</Text>
                )}
              </>
            )}

            <View style={styles.footer}>
              <TouchableOpacity
                style={styles.cancel}
                onPress={onClose}
                activeOpacity={0.8}
                disabled={applying}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirm, !canApply && { opacity: 0.4 }]}
                onPress={handleApply}
                disabled={!canApply}
                activeOpacity={0.85}
              >
                {applying ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.confirmText}>Apply</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      {/* Sibling, not nested: the PIN prompt opens while this modal is still up,
          matching how the table screen stacks them. */}
      {managerPinSheet}
    </>
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
  segToggle: {
    flexDirection: 'row',
    marginTop: 16,
    borderRadius: Radius.md,
    backgroundColor: QuinckleColors.surface,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    overflow: 'hidden',
  },
  segBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 10 },
  segBtnActive: { backgroundColor: 'rgba(243,93,59,0.16)' },
  segBtnText: { color: QuinckleColors.textTertiary, fontSize: 13, fontWeight: '600' },
  segBtnTextActive: { color: QuinckleColors.primary },
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
  adminNote: {
    fontSize: 12,
    color: QuinckleColors.warning,
    textAlign: 'center',
    marginTop: 12,
    lineHeight: 17,
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
