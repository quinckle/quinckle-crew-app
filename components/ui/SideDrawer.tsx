import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';
import { CAP, type Capability } from '../../constants/capabilities';
import { useAuth } from '../../context/AuthContext';

const DRAWER_WIDTH = Math.min(Dimensions.get('window').width * 0.78, 320);

type NavItem = {
  key: string;
  label: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: string;
  /** Omit to always show (printer, profile — never gated, per plan §2). */
  capability?: Capability;
};

const NAV_ITEMS: NavItem[] = [
  { key: 'expenses',     label: 'Expenses',     subtitle: 'Log petty cash & supplier payments', icon: 'wallet-outline',  route: '/(staff)/expenses',     capability: CAP.EXPENSES },
  { key: 'order-ledger', label: 'Order Ledger', subtitle: 'All sessions & order history',        icon: 'receipt-outline', route: '/(staff)/order-ledger', capability: CAP.ORDERS_LEDGER },
  { key: 'kot-printer',  label: 'KOT Printer',  subtitle: 'Pair or manage Bluetooth printer',    icon: 'print-outline',   route: '/printer' },
  { key: 'memberships',  label: 'Memberships',  subtitle: 'Enrol a customer by phone',           icon: 'ribbon-outline',  route: '/memberships',         capability: CAP.MEMBERSHIPS },
];

type Props = {
  visible: boolean;
  onClose: () => void;
  venueName?: string | null;
  realtimeOk: boolean;
};

export function SideDrawer({ visible, onClose, venueName, realtimeOk }: Props) {
  const insets = useSafeAreaInsets();
  const { can, staffInfo, role, switchRole } = useAuth();

  // The drawer IS the personalised module list (plan §5) — no separate launcher.
  const navItems = NAV_ITEMS.filter((item) => !item.capability || can(item.capability));

  // A staffer holding BOTH kitchen and floor duties could never move between
  // them: (cook) and (staff) are separate route groups chosen once at login.
  // Only offer the switch when they genuinely hold both.
  const showFloorKitchenSwitch = can(CAP.KITCHEN) && can(CAP.TABLES);
  const inKitchen = role === 'cook';
  // modalMounted stays true through the close animation so the modal
  // doesn't vanish before the slide-out finishes.
  const [modalMounted, setModalMounted] = useState(false);
  const slideAnim = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      // Reset to off-screen, mount the modal, then animate in.
      slideAnim.setValue(-DRAWER_WIDTH);
      backdropAnim.setValue(0);
      setModalMounted(true);
      Animated.parallel([
        Animated.spring(slideAnim, {
          toValue: 0,
          useNativeDriver: true,
          stiffness: 260,
          damping: 28,
          mass: 0.9,
          overshootClamping: false,
        }),
        Animated.timing(backdropAnim, {
          toValue: 1,
          duration: 240,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      // Animate out first, then unmount.
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: -DRAWER_WIDTH,
          duration: 220,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(backdropAnim, {
          toValue: 0,
          duration: 220,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) setModalMounted(false);
      });
    }
  }, [visible, slideAnim, backdropAnim]);

  const handleNav = (route: string) => {
    onClose();
    setTimeout(() => router.push(route as any), 230);
  };

  return (
    <Modal
      visible={modalMounted}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.overlay}>
        <Animated.View style={[styles.backdrop, { opacity: backdropAnim }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>

        <Animated.View
          style={[
            styles.drawer,
            { paddingTop: insets.top + Spacing.lg, paddingBottom: insets.bottom + Spacing.lg },
            { transform: [{ translateX: slideAnim }] },
          ]}
        >
          {/* Header: venue name + live status */}
          <View style={styles.drawerHeader}>
            <View style={styles.drawerHeaderLeft}>
              <Text style={styles.venueName} numberOfLines={1}>
                {venueName ?? 'Quinckle'}
              </Text>
              <View style={styles.statusRow}>
                <View
                  style={[
                    styles.statusDot,
                    { backgroundColor: realtimeOk ? QuinckleColors.success : QuinckleColors.warning },
                  ]}
                />
                <Text style={[styles.statusText, { color: realtimeOk ? QuinckleColors.success : QuinckleColors.warning }]}>
                  {realtimeOk ? 'Live' : 'No live updates'}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={onClose}
              activeOpacity={0.7}
              style={styles.closeBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close" size={20} color={QuinckleColors.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={styles.divider} />

          {/* Floor ⇄ Kitchen — only for staff who hold both duties */}
          {showFloorKitchenSwitch && (
            <>
              <TouchableOpacity
                style={styles.switchRow}
                onPress={() => {
                  onClose();
                  setTimeout(() => switchRole(inKitchen ? 'staff' : 'cook'), 230);
                }}
                activeOpacity={0.6}
              >
                <View style={styles.switchIconWrap}>
                  <Ionicons name="swap-horizontal" size={18} color={QuinckleColors.primary} />
                </View>
                <View style={styles.navTextGroup}>
                  <Text style={styles.navTitle}>{inKitchen ? 'Go to Floor' : 'Go to Kitchen'}</Text>
                  <Text style={styles.navSubtitle}>
                    {inKitchen ? 'Tables, orders & bills' : 'Kitchen ticket queue'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={QuinckleColors.textTertiary} />
              </TouchableOpacity>
              <View style={styles.divider} />
            </>
          )}

          {/* Nav items */}
          <View style={styles.navList}>
            {navItems.map((item) => (
              <TouchableOpacity
                key={item.key}
                style={styles.navRow}
                onPress={() => handleNav(item.route)}
                activeOpacity={0.6}
              >
                <View style={styles.navIconWrap}>
                  <Ionicons name={item.icon} size={18} color="white" />
                </View>
                <View style={styles.navTextGroup}>
                  <Text style={styles.navTitle}>{item.label}</Text>
                  <Text style={styles.navSubtitle}>{item.subtitle}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={QuinckleColors.textTertiary} />
              </TouchableOpacity>
            ))}
          </View>

          {/* Read-only "Your access" — transparency, not a launcher (plan §5). */}
          {staffInfo?.designation ? (
            <View style={styles.accessFooter}>
              <Text style={styles.accessLabel}>Your role</Text>
              <Text style={styles.accessValue}>{staffInfo.designation}</Text>
            </View>
          ) : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    flexDirection: 'row',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  drawer: {
    width: DRAWER_WIDTH,
    backgroundColor: QuinckleColors.surface,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: QuinckleColors.border,
    paddingHorizontal: Spacing.lg,
  },
  drawerHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  drawerHeaderLeft: {
    flex: 1,
    gap: 6,
  },
  venueName: {
    color: QuinckleColors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '500',
  },
  closeBtn: {
    padding: 4,
    marginTop: 2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: QuinckleColors.border,
    marginBottom: Spacing.lg,
  },
  navList: {
    gap: 4,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.lg,
    gap: Spacing.md,
    backgroundColor: 'rgba(243,93,59,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(243,93,59,0.18)',
    marginBottom: Spacing.lg,
  },
  switchIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: 'rgba(243,93,59,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  accessFooter: {
    marginTop: 'auto',
    paddingTop: Spacing.lg,
    gap: 2,
  },
  accessLabel: {
    color: QuinckleColors.textTertiary,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  accessValue: {
    color: QuinckleColors.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.lg,
    gap: Spacing.md,
  },
  navIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navTextGroup: {
    flex: 1,
  },
  navTitle: {
    color: QuinckleColors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  navSubtitle: {
    color: QuinckleColors.textTertiary,
    fontSize: 12,
    marginTop: 2,
  },
});
