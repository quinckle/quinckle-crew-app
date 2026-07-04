/**
 * QrChoiceSheet — bottom sheet asking which UPI QR to print on the bill:
 *   • With amount  → exact-total QR (diner pays the exact bill)
 *   • Static QR    → payee-only QR (diner types the amount)
 *
 * Two tappable option cards, no Cancel button — tapping the backdrop or
 * dragging down dismisses (handled by BottomSheet.onClose).
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheet } from './BottomSheet';
import { QuinckleColors, Radius, Spacing, Typography } from '../../constants/Colors';

type QrMode = 'amount' | 'static';

interface Props {
  visible: boolean;
  /** Bill total shown on the "with amount" option. */
  amount: number;
  /** Remembered default — its card gets the accent ring. */
  defaultMode: QrMode;
  onPick: (mode: QrMode) => void;
  onClose: () => void;
}

function OptionCard({
  icon,
  title,
  subtitle,
  accent,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  accent: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.card, accent && styles.cardAccent]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <View style={[styles.iconWrap, accent && styles.iconWrapAccent]}>
        <Ionicons
          name={icon}
          size={22}
          color={accent ? QuinckleColors.primary : QuinckleColors.textSecondary}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardSub}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={QuinckleColors.textTertiary} />
    </TouchableOpacity>
  );
}

export function QrChoiceSheet({ visible, amount, defaultMode, onPick, onClose }: Props) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Payment QR">
      <Text style={styles.sub}>Which UPI QR should the bill show?</Text>
      <View style={styles.cards}>
        <OptionCard
          icon="pricetag-outline"
          title={`With amount · ₹${Math.round(amount)}`}
          subtitle="Diner scans and pays the exact total"
          accent={defaultMode === 'amount'}
          onPress={() => onPick('amount')}
        />
        <OptionCard
          icon="qr-code-outline"
          title="Static QR"
          subtitle="Diner scans and enters the amount"
          accent={defaultMode === 'static'}
          onPress={() => onPick('static')}
        />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  sub: {
    ...Typography.caption,
    color: QuinckleColors.textMuted,
    paddingHorizontal: Spacing.xl,
    marginBottom: Spacing.lg,
  },
  cards: {
    paddingHorizontal: Spacing.xl,
    gap: Spacing.md,
    marginBottom: Spacing.sm,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: QuinckleColors.surfaceElevated,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: 'transparent',
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.lg,
  },
  cardAccent: {
    borderColor: QuinckleColors.primary,
    backgroundColor: QuinckleColors.primarySoft,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    backgroundColor: QuinckleColors.surfaceMutedHover,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapAccent: {
    backgroundColor: QuinckleColors.surface,
  },
  cardTitle: {
    ...Typography.bodyStrong,
    color: QuinckleColors.textPrimary,
  },
  cardSub: {
    ...Typography.micro,
    color: QuinckleColors.textMuted,
    marginTop: 2,
  },
});
