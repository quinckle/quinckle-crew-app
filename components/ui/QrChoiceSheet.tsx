/**
 * QrChoiceSheet — bottom sheet asking which UPI QR to print on the bill:
 *   • With amount  → exact-total QR (diner pays the exact bill)
 *   • Static QR    → payee-only QR (diner types the amount)
 *
 * Two identical boxy cards side by side (matches PrintOptionsSheet), no icons,
 * no accent — neither option is presented as the "preferred" one.
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { BottomSheet } from './BottomSheet';
import { useCardKeyboard } from '../../hooks/useCardKeyboard';
import { KeyLabels } from '../../constants/keyLabels';
import { QuinckleColors, Radius, Spacing, Typography } from '../../constants/Colors';

type QrMode = 'amount' | 'static';

interface Props {
  visible: boolean;
  /** Bill total shown on the "with amount" option. */
  amount: number;
  onPick: (mode: QrMode) => void;
  onClose: () => void;
  /**
   * Desktop: ← → to choose, ↵ to take it, Esc to cancel. "With amount" starts
   * highlighted — it is the one that needs no explanation at the table, so ↵
   * straight after I prints the exact-total QR.
   */
  keyboard?: boolean;
}

function OptionCard({
  title,
  subtitle,
  onPress,
  selected,
}: {
  title: string;
  subtitle: string;
  onPress: () => void;
  /** null = no keyboard in play, so draw nothing. */
  selected?: boolean | null;
}) {
  return (
    <TouchableOpacity
      style={[styles.card, selected && styles.cardSelected]}
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      accessibilityState={{ selected: !!selected }}
    >
      {selected ? (
        <View style={styles.keyCap}><Text style={styles.keyCapText}>{KeyLabels.enter}</Text></View>
      ) : null}
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardSub}>{subtitle}</Text>
    </TouchableOpacity>
  );
}

export function QrChoiceSheet({ visible, amount, onPick, onClose, keyboard = false }: Props) {
  const selected = useCardKeyboard({
    active: visible && keyboard,
    count: 2,
    initial: 0,
    onConfirm: (i) => onPick(i === 0 ? 'amount' : 'static'),
    onCancel: onClose,
  });

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Payment QR">
      <View style={styles.cards}>
        <OptionCard
          title="With amount"
          subtitle={`Exact total · ₹${Math.round(amount)}`}
          onPress={() => onPick('amount')}
          selected={selected == null ? null : selected === 0}
        />
        <OptionCard
          title="Static QR"
          subtitle="Diner enters amount"
          onPress={() => onPick('static')}
          selected={selected == null ? null : selected === 1}
        />
      </View>
      {selected != null && (
        <Text style={styles.keyHint}>← → choose   {KeyLabels.enter} print   Esc cancel</Text>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  cards: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.xl,
    gap: Spacing.md,
    marginBottom: Spacing.sm,
  },
  card: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 88,
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
  keyCap: {
    position: 'absolute', top: 6, right: 6,
    minWidth: 18, height: 18, paddingHorizontal: 4,
    borderRadius: 5, borderWidth: 1, borderColor: QuinckleColors.primarySoftBorder,
    backgroundColor: 'rgba(243,93,59,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  keyCapText: { fontSize: 10, fontWeight: '700', color: QuinckleColors.primary },
  keyHint: {
    textAlign: 'center', marginTop: Spacing.sm,
    fontSize: 11, fontWeight: '500', color: QuinckleColors.textMuted,
  },
  cardTitle: {
    ...Typography.bodyStrong,
    color: QuinckleColors.textPrimary,
    textAlign: 'center',
  },
  cardSub: {
    ...Typography.micro,
    color: QuinckleColors.textMuted,
    textAlign: 'center',
  },
});
