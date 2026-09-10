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
import { QuinckleColors, Radius, Spacing, Typography } from '../../constants/Colors';

type QrMode = 'amount' | 'static';

interface Props {
  visible: boolean;
  /** Bill total shown on the "with amount" option. */
  amount: number;
  onPick: (mode: QrMode) => void;
  onClose: () => void;
}

function OptionCard({
  title,
  subtitle,
  onPress,
}: {
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.8}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardSub}>{subtitle}</Text>
    </TouchableOpacity>
  );
}

export function QrChoiceSheet({ visible, amount, onPick, onClose }: Props) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Payment QR">
      <View style={styles.cards}>
        <OptionCard
          title="With amount"
          subtitle={`Exact total · ₹${Math.round(amount)}`}
          onPress={() => onPick('amount')}
        />
        <OptionCard
          title="Static QR"
          subtitle="Diner enters amount"
          onPress={() => onPick('static')}
        />
      </View>
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
