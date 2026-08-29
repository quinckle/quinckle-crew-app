/**
 * Menu screen — what the burger icon opens (STAFF_CAPABILITIES_HR_PLAN §5).
 *
 * Replaces the SideDrawer modal AND the module rows that used to live on the
 * profile screen. Profile is identity; this is navigation. Keeping modules in
 * two places meant filtering one and not the other just moved them rather than
 * hiding them.
 *
 * Sections are capability-filtered and disappear entirely when empty, so a
 * steward with three permissions sees three rows, not a wall of headers.
 *
 * UX ONLY — the server enforces every one of these independently.
 */

import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Image } from 'expo-image';
import { useAuth } from '../../context/AuthContext';
import UpdateStatus from '../../components/ui/UpdateStatus';
import { CAP, ROLE_COLOR_FALLBACK, type Capability } from '../../constants/capabilities';
import { QuinckleColors, Spacing, Radius } from '../../constants/Colors';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

type Row = { label: string; sub: string; icon: IoniconName; route: string; cap?: Capability };
type Group = { title: string; rows: Row[] };

const GROUPS: Group[] = [
  {
    title: 'Service',
    rows: [
      { label: 'Order ledger', sub: 'Sessions & order history', icon: 'receipt-outline', route: '/(staff)/order-ledger', cap: CAP.ORDERS_LEDGER },
      { label: 'Outstanding', sub: 'Uncollected money', icon: 'alert-circle-outline', route: '/(staff)/outstanding', cap: CAP.OUTSTANDING },
    ],
  },
  {
    title: 'Billing & cash',
    rows: [
      { label: 'Cash drawer', sub: 'Open, close & count', icon: 'file-tray-full-outline', route: '/(staff)/cash-drawer', cap: CAP.CASH_DRAWER },
      { label: 'Cash ledger', sub: 'Every cash movement', icon: 'swap-vertical-outline', route: '/(staff)/cash-ledger', cap: CAP.CASH_DRAWER },
      { label: 'Day-end report', sub: 'Z-report for the shift', icon: 'document-text-outline', route: '/(staff)/z-report', cap: CAP.CASH_DRAWER },
      { label: 'Dues', sub: 'Khata & udhaar', icon: 'book-outline', route: '/(staff)/dues', cap: CAP.DUES },
    ],
  },
  {
    // Delivery is rolling out venue-by-venue behind a feature flag. This row is
    // capability-gated only: a staffer at a venue without the flag who somehow
    // holds DELIVERY sees the row and the screen explains it isn't switched on,
    // which is friendlier than a silently missing menu item. Capability checks
    // here are UX only anyway — the backend enforces both gates.
    title: 'Delivery',
    rows: [
      { label: 'Deliveries', sub: 'Orders, riders & rider cash', icon: 'bicycle-outline', route: '/(staff)/delivery', cap: CAP.DELIVERY },
    ],
  },
  {
    title: 'Menu & catalog',
    rows: [
      { label: 'Menu & combos', sub: 'Items, prices & combos', icon: 'restaurant-outline', route: '/(staff)/menu', cap: CAP.MENU_EDIT },
      { label: 'Highlighted', sub: 'Featured on the diner menu', icon: 'sparkles-outline', route: '/(staff)/featured', cap: CAP.MENU_EDIT },
      { label: 'Stock', sub: 'Counts, 86 & wastage', icon: 'cube-outline', route: '/(staff)/stock', cap: CAP.STOCK },
    ],
  },
  {
    title: 'Records',
    rows: [
      { label: 'Expenses', sub: 'Petty cash & supplier payments', icon: 'wallet-outline', route: '/(staff)/expenses', cap: CAP.EXPENSES },
      { label: 'Memberships', sub: 'Enrol a customer by phone', icon: 'ribbon-outline', route: '/memberships', cap: CAP.MEMBERSHIPS },
      // Only the designated station device holds ATTENDANCE_STATION, so this row
      // is invisible on every other phone — which is the point: attendance is
      // recorded in one place, not from whoever happens to be holding a device.
      { label: 'Attendance station', sub: 'Staff clock in & out here', icon: 'time-outline', route: '/(staff)/attendance-station', cap: CAP.ATTENDANCE_STATION },
    ],
  },
  {
    title: 'Device',
    // No capability: printer setup is never gated (plan §2).
    rows: [
      { label: 'KOT printer', sub: 'Pair or manage the printer', icon: 'print-outline', route: '/printer' },
    ],
  },
];

export default function MoreScreen() {
  const insets = useSafeAreaInsets();
  const { staffInfo, can, logout, switchRole, role } = useAuth();

  const groups = GROUPS
    .map(g => ({ ...g, rows: g.rows.filter(r => !r.cap || can(r.cap)) }))
    .filter(g => g.rows.length > 0);

  const showSwitch = can(CAP.KITCHEN) && can(CAP.TABLES);
  const inKitchen = role === 'cook';
  const initials = (staffInfo?.name ?? 'S').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

  return (
    <View style={[styles.container, { paddingTop: insets.top + Spacing.sm }]}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="arrow-back" size={22} color={QuinckleColors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>Menu</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: Spacing.lg, paddingBottom: insets.bottom + Spacing.xl }}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile — the only way in now that the header avatar is gone. */}
        <TouchableOpacity style={styles.profileCard} onPress={() => router.push('/(staff)/profile')} activeOpacity={0.7}>
          <View style={[styles.avatar, { backgroundColor: staffInfo?.designationColor ?? ROLE_COLOR_FALLBACK }]}>
            {staffInfo?.photoUrl ? (
              <Image source={{ uri: staffInfo.photoUrl }} style={styles.avatarImg} contentFit="cover" />
            ) : (
              <Text style={styles.avatarInitials}>{initials}</Text>
            )}
          </View>
          <View style={styles.profileText}>
            <Text style={styles.profileName} numberOfLines={1}>{staffInfo?.name ?? 'Your profile'}</Text>
            <Text style={styles.profileSub} numberOfLines={1}>
              {[staffInfo?.designation, staffInfo?.restaurantName].filter(Boolean).join(' · ') || 'View profile'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={17} color={QuinckleColors.textTertiary} />
        </TouchableOpacity>

        {showSwitch && (
          <TouchableOpacity
            style={styles.switchRow}
            onPress={() => switchRole(inKitchen ? 'staff' : 'cook')}
            activeOpacity={0.7}
          >
            <View style={styles.switchIcon}>
              <Ionicons name="swap-horizontal" size={18} color={QuinckleColors.primary} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowLabel}>{inKitchen ? 'Go to floor' : 'Go to kitchen'}</Text>
              <Text style={styles.rowSub}>{inKitchen ? 'Tables, orders & bills' : 'Kitchen ticket queue'}</Text>
            </View>
            <Ionicons name="chevron-forward" size={17} color={QuinckleColors.textTertiary} />
          </TouchableOpacity>
        )}

        {groups.map(group => (
          <View key={group.title} style={styles.group}>
            <Text style={styles.groupTitle}>{group.title.toUpperCase()}</Text>
            <View style={styles.groupCard}>
              {group.rows.map((row, i) => (
                <React.Fragment key={row.label}>
                  {i > 0 && <View style={styles.divider} />}
                  <TouchableOpacity style={styles.row} onPress={() => router.push(row.route as any)} activeOpacity={0.6}>
                    <View style={styles.rowIcon}>
                      <Ionicons name={row.icon} size={18} color="white" />
                    </View>
                    <View style={styles.rowText}>
                      <Text style={styles.rowLabel}>{row.label}</Text>
                      <Text style={styles.rowSub}>{row.sub}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={17} color={QuinckleColors.textTertiary} />
                  </TouchableOpacity>
                </React.Fragment>
              ))}
            </View>
          </View>
        ))}

        {/* Utilities — not modules, so never capability-gated. */}
        <View style={styles.group}>
          <Text style={styles.groupTitle}>APP</Text>
          <View style={styles.groupCard}>
            <TouchableOpacity style={styles.row} onPress={() => Linking.openURL('https://quinckle.com/support')} activeOpacity={0.6}>
              <View style={styles.rowIcon}><Ionicons name="help-circle-outline" size={18} color="white" /></View>
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>Help & support</Text>
                <Text style={styles.rowSub}>Get help or contact us</Text>
              </View>
              <Ionicons name="open-outline" size={16} color={QuinckleColors.textTertiary} />
            </TouchableOpacity>
            <View style={styles.divider} />
            <TouchableOpacity style={styles.row} onPress={() => Linking.openURL('https://quinckle.com/policies/terms')} activeOpacity={0.6}>
              <View style={styles.rowIcon}><Ionicons name="document-outline" size={18} color="white" /></View>
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>Terms & policies</Text>
                <Text style={styles.rowSub}>How Quinckle handles your data</Text>
              </View>
              <Ionicons name="open-outline" size={16} color={QuinckleColors.textTertiary} />
            </TouchableOpacity>
          </View>
        </View>

        {/* OTA update status + installer. Lived on the profile screen before
            modules moved here; it's app plumbing, not identity. */}
        <View style={styles.group}>
          <UpdateStatus />
        </View>

        <TouchableOpacity style={styles.logout} onPress={logout} activeOpacity={0.8}>
          <Ionicons name="log-out-outline" size={17} color={QuinckleColors.danger} />
          <Text style={styles.logoutText}>Log out</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: QuinckleColors.background },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: QuinckleColors.border,
  },
  topBarTitle: { color: QuinckleColors.textPrimary, fontSize: 16, fontWeight: '600' },

  profileCard: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    padding: Spacing.md, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: QuinckleColors.border,
    marginBottom: Spacing.lg,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImg: { width: '100%', height: '100%' },
  avatarInitials: { color: '#fff', fontSize: 15, fontWeight: '700' },
  profileText: { flex: 1, minWidth: 0 },
  profileName: { color: QuinckleColors.textPrimary, fontSize: 15, fontWeight: '600' },
  profileSub: { color: QuinckleColors.textTertiary, fontSize: 12, marginTop: 2 },

  switchRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    padding: Spacing.md, borderRadius: Radius.lg,
    backgroundColor: 'rgba(243,93,59,0.06)', borderWidth: 1, borderColor: 'rgba(243,93,59,0.18)',
    marginBottom: Spacing.lg,
  },
  switchIcon: {
    width: 38, height: 38, borderRadius: 12,
    backgroundColor: 'rgba(243,93,59,0.10)', alignItems: 'center', justifyContent: 'center',
  },

  group: { marginBottom: Spacing.lg },
  groupTitle: {
    color: QuinckleColors.textTertiary, fontSize: 11, letterSpacing: 0.6,
    marginBottom: Spacing.sm, marginLeft: 2,
  },
  groupCard: { borderRadius: Radius.lg, borderWidth: 1, borderColor: QuinckleColors.border, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md },
  rowIcon: {
    width: 38, height: 38, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: QuinckleColors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  rowText: { flex: 1, minWidth: 0 },
  rowLabel: { color: QuinckleColors.textPrimary, fontSize: 14, fontWeight: '600' },
  rowSub: { color: QuinckleColors.textTertiary, fontSize: 12, marginTop: 2 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: QuinckleColors.border, marginLeft: 38 + Spacing.md * 2 },

  logout: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    paddingVertical: Spacing.lg, borderRadius: Radius.lg,
    borderWidth: 1, borderColor: 'rgba(239,68,68,0.25)',
  },
  logoutText: { color: QuinckleColors.danger, fontSize: 14, fontWeight: '600' },
});
