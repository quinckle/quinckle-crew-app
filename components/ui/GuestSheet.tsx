/**
 * GuestSheet — who the order is for (name + phone), opened from the footer pill
 * on the manual order screen. Replaces the separate "Guest details" screen that
 * used to sit between the menu and placing the order.
 *
 * Same presentation as the order summary (CartReviewSheet): a right-hand drawer
 * on tablet-landscape / desktop, a bottom sheet on phones. Everything is
 * optional — a blank sheet places a walk-in order.
 *
 * Stateless on purpose: the phone lookup, prefill from the table's saved
 * customer, and the placing itself all live in order-menu, so this only draws
 * the fields and the CRM card.
 */

import React from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { QuinckleColors, Radius, Spacing, Typography } from '../../constants/Colors';
import { BottomSheet } from './BottomSheet';
import { RightDrawer } from './CartReviewSheet';

export interface GuestSheetProps {
  visible: boolean;
  onClose: () => void;
  /** true on tablet-landscape / desktop → right-side drawer; else bottom sheet. */
  isWide: boolean;
  phone: string;
  name: string;
  onPhoneChange: (digits: string) => void;
  onNameChange: (name: string) => void;
  /** Diner + membership lookup in flight for a full 10-digit number. */
  looking: boolean;
  /** true = known guest, false = new guest, null = not looked up yet. */
  found: boolean | null;
  lookupFailed: boolean;
  visits: number | null;
  member: boolean | null;
  error: string | null;
}

export function GuestSheet(props: GuestSheetProps) {
  const { visible, onClose, isWide } = props;
  const insets = useSafeAreaInsets();

  if (!isWide) {
    return (
      <BottomSheet visible={visible} onClose={onClose} title="Customer" maxHeightRatio={0.85}>
        <GuestForm {...props} />
      </BottomSheet>
    );
  }

  return (
    <RightDrawer visible={visible} onClose={onClose} insetsTop={insets.top} insetsBottom={insets.bottom}>
      <View style={styles.drawerHeader}>
        <Text style={styles.drawerTitle}>Customer</Text>
        <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={8} activeOpacity={0.7}>
          <Ionicons name="close" size={20} color={QuinckleColors.textSecondary} />
        </TouchableOpacity>
      </View>
      <View style={styles.drawerDivider} />
      <GuestForm {...props} />
    </RightDrawer>
  );
}

function GuestForm({
  onClose, phone, name, onPhoneChange, onNameChange, looking, found, lookupFailed, visits, member, error,
}: GuestSheetProps) {
  const complete = phone.length === 10;
  return (
    <View style={styles.body}>
      <Text style={styles.hint}>Optional — leave blank to place a walk-in order.</Text>

      {/* Phone */}
      <View style={styles.inputWrap}>
        <View style={styles.code}><Text style={styles.codeText}>+91</Text></View>
        <View style={styles.divider} />
        <TextInput
          style={styles.input}
          value={phone}
          onChangeText={onPhoneChange}
          placeholder="10-digit mobile"
          placeholderTextColor={QuinckleColors.textMuted}
          keyboardType="phone-pad"
          maxLength={10}
          autoFocus
        />
        {looking && <ActivityIndicator size="small" color={QuinckleColors.primary} style={{ marginRight: 12 }} />}
      </View>

      {found === false && !lookupFailed && complete && (
        <Text style={styles.note}>New guest — enter name below</Text>
      )}
      {lookupFailed && complete && (
        <Text style={styles.note}>Couldn’t check — enter the name to continue</Text>
      )}
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {/* Name */}
      <View style={[styles.inputWrap, { marginTop: 10 }]}>
        <TextInput
          style={[styles.input, { flex: 1, paddingHorizontal: 14 }]}
          value={name}
          onChangeText={onNameChange}
          placeholder="Guest name (optional)"
          placeholderTextColor={QuinckleColors.textMuted}
          returnKeyType="done"
          onSubmitEditing={onClose}
        />
        {found === true && (
          <Ionicons name="checkmark-circle" size={18} color={QuinckleColors.success} style={{ marginRight: 12 }} />
        )}
      </View>

      {/* CRM — visit history + membership status */}
      {complete && !looking && (found !== null || member !== null) && (
        <View style={styles.crmCard}>
          <View style={styles.crmRow}>
            <View style={styles.crmCol}>
              <Text style={styles.crmLabel}>VISITS HERE</Text>
              <View style={styles.crmValueRow}>
                <Text style={styles.crmValueNum}>{visits ?? 0}</Text>
                <Text style={styles.crmValueUnit}>{visits === 1 ? 'time' : 'times'}</Text>
              </View>
            </View>
            <View style={styles.crmDivider} />
            <View style={styles.crmCol}>
              <Text style={styles.crmLabel}>MEMBERSHIP</Text>
              {member ? (
                <View style={styles.crmMemberRow}>
                  <Ionicons name="ribbon" size={14} color={QuinckleColors.warning} />
                  <Text style={styles.crmMemberText}>Member</Text>
                </View>
              ) : (
                <Text style={styles.crmNotMemberText}>Not a member</Text>
              )}
            </View>
          </View>
          {member && (
            <View style={styles.crmDiscountStrip}>
              <Ionicons name="pricetag" size={13} color={QuinckleColors.warning} />
              <Text style={styles.crmDiscountText}>Membership discount applied at billing</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: Spacing.xl, paddingTop: Spacing.sm, paddingBottom: Spacing.xl },
  hint: { ...Typography.caption, color: QuinckleColors.textTertiary, marginBottom: Spacing.md },

  inputWrap: {
    flexDirection: 'row', alignItems: 'center', height: 48, overflow: 'hidden',
    backgroundColor: QuinckleColors.surfaceElevated, borderRadius: Radius.md,
    borderWidth: 1, borderColor: QuinckleColors.border,
  },
  code: { paddingHorizontal: 12, height: '100%', justifyContent: 'center' },
  codeText: { ...Typography.body, color: QuinckleColors.textSecondary, fontWeight: '600' },
  divider: { width: 1, height: '60%', backgroundColor: QuinckleColors.border },
  input: { flex: 1, color: QuinckleColors.textPrimary, fontSize: 15, paddingHorizontal: 12, height: '100%' },
  note: { fontSize: 12, color: QuinckleColors.textMuted, marginTop: 6, fontStyle: 'italic' },
  errorText: { fontSize: 12, color: QuinckleColors.danger, marginTop: 6 },

  crmCard: { marginTop: 14, backgroundColor: QuinckleColors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: QuinckleColors.border, overflow: 'hidden' },
  crmRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 16 },
  crmCol: { flex: 1 },
  crmDivider: { width: 1, height: 34, backgroundColor: QuinckleColors.border, marginHorizontal: 14 },
  crmLabel: { fontSize: 11, color: QuinckleColors.textSecondary, marginBottom: 3 },
  crmValueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 5 },
  crmValueNum: { fontSize: 20, fontWeight: '700', color: QuinckleColors.textPrimary },
  crmValueUnit: { fontSize: 12, color: QuinckleColors.textSecondary },
  crmMemberRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  crmMemberText: { fontSize: 14, fontWeight: '700', color: QuinckleColors.warning },
  crmNotMemberText: { fontSize: 13, color: QuinckleColors.textSecondary },
  crmDiscountStrip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: QuinckleColors.warningSoft, borderTopWidth: 1, borderTopColor: QuinckleColors.warningBorder, paddingVertical: 8, paddingHorizontal: 16 },
  crmDiscountText: { fontSize: 12, fontWeight: '600', color: QuinckleColors.warning },

  // Drawer chrome — mirrors the order summary's header so the two read as a pair.
  drawerHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl, paddingBottom: Spacing.md,
  },
  drawerTitle: { ...Typography.subtitle, color: QuinckleColors.textPrimary },
  closeBtn: { padding: 4 },
  drawerDivider: { height: StyleSheet.hairlineWidth, backgroundColor: QuinckleColors.border, marginBottom: Spacing.sm },
});
