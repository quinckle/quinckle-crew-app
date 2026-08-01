/**
 * Cancellation reason capture — confirm a cancel AND record why, in one step.
 *
 * Replaces the plain "are you sure?" confirm that used to front item cancels.
 * Folding the reason into the existing confirm keeps the flow at the same
 * number of taps for the crew (pick a reason = confirm) instead of adding a
 * second sheet on top of a destructive action they already have to think about.
 *
 * Confirm stays disabled until the selection is something the server will
 * accept, so the backend's 400s (INVALID_REASON / REASON_TEXT_REQUIRED) are
 * unreachable from this UI — the crew never sees a cancel fail on validation.
 *
 * Two exports:
 *   • CancelReasonPicker — just the body. For hosts that already own a sheet
 *     (TakeawayManageSheet renders it as one mode of its state machine, since
 *     stacking a second BottomSheet would fight the first's backdrop + drag).
 *   • CancelReasonSheet   — the picker wrapped in its own BottomSheet.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheet } from './BottomSheet';
import { CANCEL_REASONS, REASON_TEXT_MAX, type CancelReason, type CancelReasonCode } from '../../constants/cancelReasons';
import { QuinckleColors } from '../../constants/Colors';

interface PickerProps {
  /** Headline, e.g. "Cancel this item?". Omit when the host sheet has a title. */
  title?: string | null;
  /** What is being cancelled — item or order name. */
  subject?: string | null;
  /** Consequence line, e.g. "₹240 will be removed from the bill." */
  note?: string | null;
  /** Confirm button label. Defaults to "Cancel item". */
  confirmLabel?: string;
  /** Dismiss button label. Defaults to "Keep". */
  cancelLabel?: string;
  busy?: boolean;
  /** Reset the selection whenever this changes — see the note in the effect. */
  resetKey?: string | number | null;
  onConfirm: (reason: CancelReason) => void;
  onCancel: () => void;
}

export function CancelReasonPicker({
  title,
  subject,
  note,
  confirmLabel = 'Cancel item',
  cancelLabel = 'Keep',
  busy = false,
  resetKey,
  onConfirm,
  onCancel,
}: PickerProps) {
  const [code, setCode] = useState<CancelReasonCode | null>(null);
  const [text, setText] = useState('');

  // Never carry a previous cancellation's reason into the next one — that is
  // how a whole shift ends up tagged "Out of stock".
  useEffect(() => {
    setCode(null);
    setText('');
  }, [resetKey]);

  const trimmed = text.trim();
  const canConfirm = useMemo(() => {
    if (busy || !code) return false;
    return code !== 'OTHER' || trimmed.length > 0;
  }, [busy, code, trimmed]);

  const handleConfirm = () => {
    if (!canConfirm || !code) return;
    onConfirm(code === 'OTHER' ? { reason_code: code, reason_text: trimmed } : { reason_code: code });
  };

  return (
    <View style={styles.body}>
      {title ? (
        <>
          <View style={styles.icon}>
            <Ionicons name="trash-outline" size={22} color={QuinckleColors.danger} />
          </View>
          <Text style={styles.title}>{title}</Text>
        </>
      ) : null}
      {subject ? <Text style={styles.subject}>{subject}</Text> : null}
      {note ? <Text style={styles.note}>{note}</Text> : null}

      <Text style={styles.prompt}>Why is it being cancelled?</Text>

      <View style={styles.grid}>
        {CANCEL_REASONS.map((r) => {
          const active = code === r.code;
          return (
            <TouchableOpacity
              key={r.code}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => setCode(r.code)}
              activeOpacity={0.8}
              disabled={busy}
            >
              <Ionicons
                name={r.icon as any}
                size={15}
                color={active ? QuinckleColors.danger : QuinckleColors.textSecondary}
              />
              <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
                {r.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {code === 'OTHER' ? (
        <TextInput
          style={styles.input}
          placeholder="Say what happened"
          placeholderTextColor={QuinckleColors.textMuted}
          value={text}
          onChangeText={setText}
          maxLength={REASON_TEXT_MAX}
          autoFocus
          editable={!busy}
          returnKeyType="done"
          onSubmitEditing={handleConfirm}
        />
      ) : null}

      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.keep}
          onPress={() => { if (!busy) onCancel(); }}
          activeOpacity={0.8}
          disabled={busy}
        >
          <Text style={styles.keepText}>{cancelLabel}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.confirm, !canConfirm && styles.confirmDisabled]}
          onPress={handleConfirm}
          activeOpacity={0.85}
          disabled={!canConfirm}
        >
          {busy ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.confirmText}>{confirmLabel}</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

interface SheetProps extends Omit<PickerProps, 'onCancel' | 'resetKey' | 'title'> {
  visible: boolean;
  title: string;
  onClose: () => void;
}

export function CancelReasonSheet({ visible, busy = false, onClose, ...rest }: SheetProps) {
  // Bump only on open. The sheet keeps its children mounted while it animates
  // out, so resetting on close too would visibly deselect the chips on the way
  // down. `openCount` changing is what tells the picker to start clean.
  const [openCount, setOpenCount] = useState(0);
  useEffect(() => {
    if (visible) setOpenCount((n) => n + 1);
  }, [visible]);

  return (
    <BottomSheet visible={visible} onClose={() => { if (!busy) onClose(); }}>
      <CancelReasonPicker {...rest} busy={busy} resetKey={openCount} onCancel={onClose} />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 22, paddingTop: 4, paddingBottom: 8, alignItems: 'center' },
  icon: {
    width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center',
    backgroundColor: QuinckleColors.dangerSoft, marginBottom: 14,
  },
  title: { fontSize: 17, fontWeight: '800', color: QuinckleColors.textPrimary, marginBottom: 6 },
  subject: { fontSize: 15, fontWeight: '600', color: QuinckleColors.textPrimary, textAlign: 'center', marginBottom: 4 },
  note: { fontSize: 13, color: QuinckleColors.textSecondary, textAlign: 'center', lineHeight: 19, paddingHorizontal: 6 },
  prompt: {
    fontSize: 13, fontWeight: '700', color: QuinckleColors.textSecondary,
    alignSelf: 'flex-start', marginTop: 20, marginBottom: 10,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignSelf: 'stretch' },
  chip: {
    flexBasis: '48%', flexGrow: 1, flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: QuinckleColors.surfaceElevated, borderRadius: 12,
    borderWidth: 1.5, borderColor: 'transparent', paddingVertical: 12, paddingHorizontal: 12,
  },
  chipActive: { borderColor: QuinckleColors.dangerBorder, backgroundColor: QuinckleColors.dangerSoft },
  chipText: { flexShrink: 1, fontSize: 13, fontWeight: '600', color: QuinckleColors.textSecondary },
  chipTextActive: { color: QuinckleColors.textPrimary },
  input: {
    alignSelf: 'stretch', marginTop: 10, paddingHorizontal: 14, paddingVertical: 12,
    backgroundColor: QuinckleColors.surfaceElevated, borderRadius: 12,
    borderWidth: 1, borderColor: QuinckleColors.border,
    fontSize: 14, color: QuinckleColors.textPrimary,
  },
  actions: { flexDirection: 'row', gap: 12, alignSelf: 'stretch', marginTop: 22 },
  keep: {
    flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1,
    borderColor: QuinckleColors.border, alignItems: 'center', justifyContent: 'center',
  },
  keepText: { fontSize: 14, fontWeight: '700', color: QuinckleColors.textSecondary },
  confirm: {
    flex: 1, paddingVertical: 14, borderRadius: 12, backgroundColor: QuinckleColors.danger,
    alignItems: 'center', justifyContent: 'center',
  },
  confirmDisabled: { opacity: 0.4 },
  confirmText: { fontSize: 14, fontWeight: '800', color: '#fff' },
});
