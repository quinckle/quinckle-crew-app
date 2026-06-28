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

const DRAWER_WIDTH = Math.min(Dimensions.get('window').width * 0.78, 320);

type NavItem = {
  key: string;
  label: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  route: string;
};

const NAV_ITEMS: NavItem[] = [
  { key: 'expenses',     label: 'Expenses',     subtitle: 'Log petty cash & supplier payments', icon: 'wallet-outline',  route: '/(staff)/expenses' },
  { key: 'order-ledger', label: 'Order Ledger', subtitle: 'All sessions & order history',        icon: 'receipt-outline', route: '/(staff)/order-ledger' },
  { key: 'kot-printer',  label: 'KOT Printer',  subtitle: 'Pair or manage Bluetooth printer',    icon: 'print-outline',   route: '/printer' },
  { key: 'memberships',  label: 'Memberships',  subtitle: 'Enrol a customer by phone',           icon: 'ribbon-outline',  route: '/memberships' },
];

type Props = {
  visible: boolean;
  onClose: () => void;
  venueName?: string | null;
  realtimeOk: boolean;
};

export function SideDrawer({ visible, onClose, venueName, realtimeOk }: Props) {
  const insets = useSafeAreaInsets();
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
  }, [visible]);

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

          {/* Nav items */}
          <View style={styles.navList}>
            {NAV_ITEMS.map((item) => (
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
