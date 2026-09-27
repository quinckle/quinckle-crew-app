/**
 * PrintOptionsSheet — bottom sheet replacing the "Print KOT / Print Invoice"
 * popover on the table-detail screen. Two square cards side by side, plus an
 * optional recipient-GSTIN capture for B2B tax invoices.
 */

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheet } from './BottomSheet';
import { useCardKeyboard } from '../../hooks/useCardKeyboard';
import { KeyLabels } from '../../constants/keyLabels';
import { QuinckleColors, Radius, Spacing, Typography } from '../../constants/Colors';

/** Recipient (buyer) details for a B2B tax invoice. `undefined` = plain B2C bill. */
export interface InvoiceBuyer {
  gstin: string;
  name: string | null;
}

interface Props {
  visible: boolean;
  onPrintKot: () => void;
  onPrintInvoice: (buyer?: InvoiceBuyer) => void;
  onClose: () => void;
  /** Prefill from a session that already has a buyer GSTIN saved. */
  initialBuyerGstin?: string | null;
  initialBuyerName?: string | null;
  /**
   * Desktop: drive the two cards from the keyboard — I invoice, K KOT,
   * ← → to move, ↵ to take the highlighted one, Esc to back out. Invoice
   * starts highlighted; it is the print a table reaches for when closing out.
   */
  keyboard?: boolean;
}

// Same GSTIN format the backend enforces (partner tax-config + crew buyer route).
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

// Exported so a quick, no-frills print prompt (the takeaway grid card's own
// print icon, in a CenteredModal — no GSTIN capture, no keyboard rail) can
// reuse the exact same card instead of a re-skinned copy.
export function PrintCard({
  icon,
  label,
  onPress,
  selected,
  accelerator,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  /** null = no keyboard in play, so draw nothing. */
  selected?: boolean | null;
  accelerator?: string;
}) {
  return (
    <TouchableOpacity
      style={[styles.card, selected && styles.cardSelected]}
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!selected }}
    >
      {selected != null && !!accelerator && (
        <View style={[styles.keyCap, selected && styles.keyCapSelected]}>
          <Text style={[styles.keyCapText, selected && styles.keyCapTextSelected]}>
            {accelerator}
          </Text>
        </View>
      )}
      <View style={styles.iconWrap}>
        <Ionicons
          name={icon}
          size={22}
          color={selected ? QuinckleColors.primary : QuinckleColors.textSecondary}
        />
      </View>
      <Text style={styles.cardLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

export function PrintOptionsSheet({
  visible,
  onPrintKot,
  onPrintInvoice,
  onClose,
  initialBuyerGstin,
  initialBuyerName,
  keyboard = false,
}: Props) {
  const [gstin, setGstin] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Re-seed the fields each time the sheet opens so a saved buyer shows up and
  // a stale entry from a prior table never leaks in.
  useEffect(() => {
    if (visible) {
      setGstin((initialBuyerGstin ?? '').toUpperCase());
      setName(initialBuyerName ?? '');
      setError(null);
    }
  }, [visible, initialBuyerGstin, initialBuyerName]);

  const handlePrintInvoice = () => {
    const g = gstin.trim().toUpperCase();
    if (g && !GSTIN_RE.test(g)) {
      setError('Enter a valid 15-character GSTIN, or leave it blank.');
      return;
    }
    setError(null);
    onPrintInvoice(g ? { gstin: g, name: name.trim() || null } : undefined);
  };

  // Both keyboard paths land on handlePrintInvoice rather than onPrintInvoice,
  // so a GSTIN that was typed in is validated and carried either way — I and ↵
  // print the same invoice the card does.
  const selected = useCardKeyboard({
    active: visible && keyboard,
    count: 2,
    initial: 1,
    accelerators: { k: 0, i: 1 },
    onConfirm: (i) => (i === 0 ? onPrintKot() : handlePrintInvoice()),
    onCancel: onClose,
  });

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Print">
      <View style={styles.buyerBlock}>
        <Text style={styles.buyerLabel}>Recipient GSTIN — business invoice (optional)</Text>
        <TextInput
          style={[styles.input, error ? styles.inputError : null]}
          value={gstin}
          onChangeText={(t) => { setGstin(t.toUpperCase()); if (error) setError(null); }}
          placeholder="e.g. 29ABCDE1234F1Z5"
          placeholderTextColor={QuinckleColors.textMuted}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={15}
          returnKeyType="done"
          // While this field has focus the sheet's own keyboard stands down
          // (a letter here is a letter), so Enter has to reach the invoice
          // from inside it — otherwise a typed GSTIN can only be printed with
          // the mouse.
          onSubmitEditing={handlePrintInvoice}
        />
        {gstin.trim().length > 0 && (
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Business name (optional)"
            placeholderTextColor={QuinckleColors.textMuted}
            autoCapitalize="words"
            returnKeyType="done"
            onSubmitEditing={handlePrintInvoice}
          />
        )}
        {error && <Text style={styles.errorText}>{error}</Text>}
      </View>

      <View style={styles.grid}>
        <PrintCard
          icon="restaurant-outline" label="Print KOT" onPress={onPrintKot}
          selected={selected == null ? null : selected === 0} accelerator="K"
        />
        <PrintCard
          icon="receipt-outline" label="Print invoice" onPress={handlePrintInvoice}
          selected={selected == null ? null : selected === 1} accelerator="I"
        />
      </View>
      {selected != null && (
        <Text style={styles.keyHint}>← → choose   {KeyLabels.enter} print   Esc close</Text>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  buyerBlock: {
    paddingHorizontal: Spacing.xl,
    marginBottom: Spacing.lg,
    gap: Spacing.sm,
  },
  buyerLabel: {
    ...Typography.caption,
    color: QuinckleColors.textSecondary,
  },
  input: {
    ...Typography.body,
    color: QuinckleColors.textPrimary,
    backgroundColor: QuinckleColors.surfaceMutedHover,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  inputError: {
    borderColor: QuinckleColors.dangerBorder,
    backgroundColor: QuinckleColors.dangerSoft,
  },
  errorText: {
    ...Typography.caption,
    color: QuinckleColors.danger,
  },
  grid: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.xl,
    gap: Spacing.md,
    marginBottom: Spacing.sm,
  },
  card: {
    flex: 1,
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: QuinckleColors.surfaceElevated,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.sm,
  },
  cardSelected: {
    borderColor: QuinckleColors.primary,
    backgroundColor: QuinckleColors.primarySoft,
  },
  // Top-right of the card, out of the icon's way.
  keyCap: {
    position: 'absolute', top: 6, right: 6,
    minWidth: 18, height: 18, paddingHorizontal: 4,
    borderRadius: 5, borderWidth: 1, borderColor: QuinckleColors.border,
    backgroundColor: QuinckleColors.surfaceMuted,
    alignItems: 'center', justifyContent: 'center',
  },
  keyCapSelected: {
    borderColor: QuinckleColors.primarySoftBorder,
    backgroundColor: 'rgba(243,93,59,0.18)',
  },
  keyCapText: { fontSize: 10, fontWeight: '700', color: QuinckleColors.textTertiary },
  keyCapTextSelected: { color: QuinckleColors.primary },
  keyHint: {
    textAlign: 'center', marginTop: Spacing.sm,
    fontSize: 11, fontWeight: '500', color: QuinckleColors.textMuted,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    backgroundColor: QuinckleColors.surfaceMutedHover,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardLabel: {
    ...Typography.bodyStrong,
    color: QuinckleColors.textPrimary,
    textAlign: 'center',
  },
});
