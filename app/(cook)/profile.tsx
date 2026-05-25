import React from 'react';
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';
import { useAuth } from '../../context/AuthContext';

const BANNER_HEIGHT = 340;

export default function CookProfile() {
  const insets = useSafeAreaInsets();
  const { staffInfo, logout } = useAuth();

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.huge }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.banner}>
          <Image
            source={{ uri: 'https://images.pexels.com/photos/3298637/pexels-photo-3298637.jpeg' }}
            style={styles.bannerImage}
            resizeMode="cover"
          />
          <LinearGradient
            colors={['rgba(0,0,0,0.15)', 'rgba(0,0,0,0.45)', 'rgba(9,9,11,0.95)', QuinckleColors.background]}
            locations={[0, 0.45, 0.85, 1]}
            style={StyleSheet.absoluteFillObject}
            pointerEvents="none"
          />
          <TouchableOpacity
            style={[styles.backBtn, { top: insets.top + Spacing.sm }]}
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </TouchableOpacity>
          <View style={styles.bannerTextWrap}>
            <View style={styles.roleBadge}>
              <Text style={styles.roleBadgeText}>Kitchen</Text>
            </View>
            <Text style={styles.restaurantName} numberOfLines={2}>
              {staffInfo?.restaurantName ?? 'The Grill Room'}
            </Text>
          </View>
        </View>

        <View style={styles.body}>
          <View style={styles.card}>
            <View style={styles.venueRow}>
              <Image
                source={{ uri: 'https://images.unsplash.com/photo-1544148103-0773bf10d330?q=80&w=100&h=100&auto=format&fit=crop' }}
                style={styles.venueLogo}
              />
              <View style={styles.venueInfo}>
                <Text style={styles.venueLabel}>Linked Restaurant</Text>
                <Text style={styles.venueName}>{staffInfo?.restaurantName ?? 'The Grill Room'}</Text>
                <Text style={styles.venueId}>
                  {staffInfo?.restaurantId?.slice(0, 12).toUpperCase() ?? 'QNK-7782-GR'}
                </Text>
              </View>
            </View>
          </View>

          <Text style={styles.adminText}>
            Contact your restaurant administrator to update profile details.
          </Text>

          <TouchableOpacity style={styles.logoutBtn} onPress={logout} activeOpacity={0.7}>
            <Ionicons name="log-out-outline" size={18} color={QuinckleColors.danger} />
            <Text style={styles.logoutBtnText}>Log Out</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: QuinckleColors.background,
  },
  banner: {
    width: '100%',
    height: BANNER_HEIGHT,
    position: 'relative',
    backgroundColor: '#111',
  },
  bannerImage: {
    width: '100%',
    height: '100%',
  },
  backBtn: {
    position: 'absolute',
    left: Spacing.lg,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerTextWrap: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    bottom: Spacing.lg,
    gap: 8,
  },
  roleBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: 'rgba(139, 92, 246, 0.25)',
    borderWidth: 1,
    borderColor: 'rgba(167, 139, 250, 0.55)',
  },
  roleBadgeText: {
    color: '#E9D5FF',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  restaurantName: {
    color: '#fff',
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  body: {
    paddingHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    gap: Spacing.lg,
  },
  card: {
    backgroundColor: QuinckleColors.surface,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    padding: Spacing.lg,
  },
  venueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  venueLogo: {
    width: 56,
    height: 56,
    borderRadius: 10,
  },
  venueInfo: {
    flex: 1,
    gap: 2,
  },
  venueLabel: {
    color: QuinckleColors.textTertiary,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  venueName: {
    color: QuinckleColors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  venueId: {
    color: QuinckleColors.textTertiary,
    fontSize: 12,
    fontWeight: '500',
  },
  adminText: {
    color: QuinckleColors.textTertiary,
    fontSize: 12,
    textAlign: 'center',
  },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
  },
  logoutBtnText: {
    color: QuinckleColors.danger,
    fontSize: 14,
    fontWeight: '600',
  },
});
