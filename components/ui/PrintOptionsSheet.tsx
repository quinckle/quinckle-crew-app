/**
 * PrintOptionsSheet — bottom sheet replacing the "Print KOT / Print Invoice"
 * popover on the table-detail screen. Two square cards side by side, plus an
 * optional recipient-GSTIN capture for B2B tax invoices.
 */

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheet } from './BottomSheet';
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
}

// Same GSTIN format the backend enforces (partner tax-config + crew buyer route).
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

function PrintCard({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.iconWrap}>
        <Ionicons name={icon} size={22} color={QuinckleColors.textSecondary} />
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
        />
        {gstin.trim().length > 0 && (
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Business name (optional)"
            placeholderTextColor={QuinckleColors.textMuted}
            autoCapitalize="words"
          />
        )}
        {error && <Text style={styles.errorText}>{error}</Text>}
      </View>

      <View style={styles.grid}>
        <PrintCard icon="restaurant-outline" label="Print KOT" onPress={onPrintKot} />
        <PrintCard icon="receipt-outline" label="Print invoice" onPress={handlePrintInvoice} />
      </View>
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
