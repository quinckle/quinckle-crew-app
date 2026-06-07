import React, { useState, useEffect, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Image,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useAuth } from '../../context/AuthContext';
import { crewAuth, restaurantApi, crewPayments } from '../../services/api';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';
import { ThemedDialog } from '../../components/ui/themed-dialog';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const HERO_HEIGHT = 340;

// Format Indian phone number "+91 XXXXX XXXXX"
function formatPhone(raw?: string | null): string {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  const last10 = digits.slice(-10);
  if (last10.length !== 10) return raw;
  return `+91 ${last10.slice(0, 5)} ${last10.slice(5)}`;
}

export default function StaffProfile() {
  const insets = useSafeAreaInsets();
  const { logout, staffInfo, setPhotoUrl } = useAuth();
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [cashLedger, setCashLedger] = useState<any>(null);
  const [joinedAt, setJoinedAt] = useState<string | null>(null);

  const [dialog, setDialog] = useState<{
    visible: boolean;
    title: string;
    message: string;
    actions: Array<{ label: string; variant?: 'default' | 'danger' | 'primary'; onPress: () => void }>;
  }>({
    visible: false,
    title: '',
    message: '',
    actions: [],
  });

  // Load cash ledger
  useEffect(() => {
    if (staffInfo?.id) {
      crewPayments.getCashLedger()
        .then(res => setCashLedger(res))
        .catch(() => { });
    }
  }, [staffInfo]);

  // Fetch joinedAt (not stored in AuthContext)
  useEffect(() => {
    if (!staffInfo?.id) return;
    crewAuth.getProfile()
      .then(res => setJoinedAt(res?.data?.joinedAt ?? null))
      .catch(() => { });
  }, [staffInfo?.id]);

  const joinedLabel = useMemo(() => {
    if (!joinedAt) return null;
    const d = new Date(joinedAt);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  }, [joinedAt]);

  const handleLogout = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setDialog({
      visible: true,
      title: 'Confirm Logout',
      message: 'Are you sure you want to log out of your shift?',
      actions: [
        { label: 'Cancel', variant: 'default', onPress: () => setDialog(prev => ({ ...prev, visible: false })) },
        {
          label: 'Log Out', variant: 'danger', onPress: () => {
            setDialog(prev => ({ ...prev, visible: false }));
            logout();
          }
        }
      ]
    });
  };

  const handleChangePhoto = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        setDialog({
          visible: true,
          title: 'Permission denied',
          message: 'Media library access is required to upload photos.',
          actions: [{ label: 'OK', variant: 'primary', onPress: () => setDialog(prev => ({ ...prev, visible: false })) }]
        });
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.65,
      });
      if (res.canceled || !res.assets?.[0]?.uri) return;
      setIsUploadingPhoto(true);

      const manipulated = await ImageManipulator.manipulateAsync(
        res.assets[0].uri,
        [{ resize: { width: 400, height: 400 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      if (!manipulated.base64) throw new Error('Failed to encode image.');

      const uploadRes = await crewAuth.uploadPhoto(manipulated.base64);
      setPhotoUrl((uploadRes as any)?.data?.photoUrl ?? manipulated.uri);
      setDialog({
        visible: true,
        title: 'Success',
        message: 'Profile photo updated.',
        actions: [{ label: 'OK', variant: 'primary', onPress: () => setDialog(prev => ({ ...prev, visible: false })) }]
      });
    } catch (err) {
      setDialog({
        visible: true,
        title: 'Photo upload failed',
        message: err instanceof Error ? err.message : 'Please try again with a smaller image.',
        actions: [{ label: 'OK', variant: 'primary', onPress: () => setDialog(prev => ({ ...prev, visible: false })) }]
      });
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  const staffRole = useMemo(() => {
    const role = staffInfo?.role ?? 'STAFF';
    return role.charAt(0) + role.slice(1).toLowerCase();
  }, [staffInfo?.role]);

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.huge }}
        showsVerticalScrollIndicator={false}
        bounces={true}
      >

        {/* ─── HERO BANNER ─── */}
        <View style={styles.staffBanner}>
          <Image
            source={{ uri: 'https://images.pexels.com/photos/262978/pexels-photo-262978.jpeg' }}
            style={styles.staffBannerImage}
            resizeMode="cover"
          />
          <LinearGradient
            colors={['rgba(0,0,0,0.15)', 'rgba(0,0,0,0.45)', 'rgba(9,9,11,0.95)', QuinckleColors.background]}
            locations={[0, 0.45, 0.85, 1]}
            style={StyleSheet.absoluteFillObject}
            pointerEvents="none"
          />
          <TouchableOpacity
            style={[styles.bannerBackBtn, { top: insets.top + Spacing.sm }]}
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </TouchableOpacity>
          <View style={styles.bannerTextWrap}>
            <View style={styles.bannerRoleBadge}>
              <Text style={styles.bannerRoleBadgeText}>Staff</Text>
            </View>
            <Text style={styles.bannerRestaurantName} numberOfLines={2}>
              {staffInfo?.restaurantName ?? 'The Grill Room'}
            </Text>
          </View>
        </View>

        {/* ─── IDENTITY CARD ─── */}
        <View style={styles.identityCard}>
          <View style={styles.identityPhotoWrap}>
            {staffInfo?.photoUrl ? (
              <Image source={{ uri: staffInfo.photoUrl }} style={styles.identityPhoto} />
            ) : (
              <View style={[styles.identityPhoto, styles.identityPhotoFallback]}>
                <Text style={styles.identityPhotoInitials}>
                  {(staffInfo?.name ?? 'S')
                    .split(' ')
                    .map((w: string) => w[0])
                    .join('')
                    .slice(0, 2)
                    .toUpperCase()}
                </Text>
              </View>
            )}
            <TouchableOpacity
              style={styles.identityCameraBtn}
              onPress={handleChangePhoto}
              disabled={isUploadingPhoto}
              activeOpacity={0.7}
            >
              {isUploadingPhoto ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="camera" size={14} color="#fff" />
              )}
            </TouchableOpacity>
          </View>

          <View style={styles.identityTextCol}>
            <Text style={styles.identityName} numberOfLines={1}>
              {staffInfo?.name ?? 'Staff Member'}
            </Text>
            <View style={styles.identityMetaRow}>
              <Ionicons name="briefcase-outline" size={13} color={QuinckleColors.textTertiary} />
              <Text style={styles.identityMetaText}>{staffRole}</Text>
            </View>
            <View style={styles.identityMetaRow}>
              <Ionicons name="call-outline" size={13} color={QuinckleColors.textTertiary} />
              <Text style={styles.identityMetaText}>{formatPhone(staffInfo?.phone) || '—'}</Text>
            </View>
          </View>
        </View>

        {/* ─── KOT PRINTER ─── */}
        {/* ─── ORDER LEDGER ─── */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.sectionRow}
            onPress={() => router.push('/(staff)/order-ledger')}
            activeOpacity={0.6}
          >
            <View style={styles.sectionRowLeft}>
              <View style={[styles.sectionIconWrap]}>
                <Ionicons name="receipt-outline" size={18} color='white' />
              </View>
              <View style={styles.sectionTextGroup}>
                <Text style={styles.sectionTitle}>Order Ledger</Text>
                <Text style={styles.sectionSubtitle}>All sessions & order history</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={QuinckleColors.textTertiary} />
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <TouchableOpacity
            style={styles.sectionRow}
            onPress={() => router.push('/printer')}
            activeOpacity={0.6}
          >
            <View style={styles.sectionRowLeft}>
              <View style={[styles.sectionIconWrap]}>
                <Ionicons name="print-outline" size={18} color='white' />
              </View>
              <View style={styles.sectionTextGroup}>
                <Text style={styles.sectionTitle}>KOT Printer</Text>
                <Text style={styles.sectionSubtitle}>Pair or manage Bluetooth printer</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={QuinckleColors.textTertiary} />
          </TouchableOpacity>
        </View>

        {/* ─── MEMBERSHIPS ─── */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.sectionRow}
            onPress={() => router.push('/memberships')}
            activeOpacity={0.6}
          >
            <View style={styles.sectionRowLeft}>
              <View style={[styles.sectionIconWrap]}>
                <Ionicons name="ribbon-outline" size={18} color='white' />
              </View>
              <View style={styles.sectionTextGroup}>
                <Text style={styles.sectionTitle}>Memberships</Text>
                <Text style={styles.sectionSubtitle}>Enrol a customer by phone</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={QuinckleColors.textTertiary} />
          </TouchableOpacity>
        </View>

        {/* ─── LINKED RESTAURANT ─── */}
        <View style={styles.section}>
          <View style={styles.sectionRow}>
            <View style={styles.sectionRowLeft}>
              <View style={[styles.sectionIconWrap]}>
                <Ionicons name="storefront-outline" size={18} color='white' />
              </View>
              <View style={styles.sectionTextGroup}>
                <Text style={styles.sectionTitle}>Linked Restaurant</Text>
                <Text style={styles.sectionSubtitle}>
                  {staffInfo?.restaurantName ?? '—'}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* ─── HELP & POLICIES ─── */}
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.sectionRow}
            onPress={() => Linking.openURL('https://quinckle.com/support')}
            activeOpacity={0.6}
          >
            <View style={styles.sectionRowLeft}>
              <View style={styles.sectionIconWrap}>
                <Ionicons name="headset-outline" size={18} color="white" />
              </View>
              <View style={styles.sectionTextGroup}>
                <Text style={styles.sectionTitle}>Help & Support</Text>
                <Text style={styles.sectionSubtitle}>Get help or contact us</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={QuinckleColors.textTertiary} />
          </TouchableOpacity>
          <View style={styles.sectionDivider} />
          <TouchableOpacity
            style={styles.sectionRow}
            onPress={() => Linking.openURL('https://quinckle.com/policies/terms')}
            activeOpacity={0.6}
          >
            <View style={styles.sectionRowLeft}>
              <View style={styles.sectionIconWrap}>
                <Ionicons name="document-text-outline" size={18} color="white" />
              </View>
              <View style={styles.sectionTextGroup}>
                <Text style={styles.sectionTitle}>Policies</Text>
                <Text style={styles.sectionSubtitle}>Terms and conditions</Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={QuinckleColors.textTertiary} />
          </TouchableOpacity>
        </View>

        {/* ─── LOGOUT ─── */}
        <TouchableOpacity
          style={styles.logoutSection}
          onPress={handleLogout}
          activeOpacity={0.6}
        >
          <Ionicons name="log-out-outline" size={18} color={QuinckleColors.danger} />
          <Text style={styles.logoutText}>Log Out</Text>
        </TouchableOpacity>

        {/* Footer hint */}
        <Text style={styles.footerHint}>
          Contact restaurant admin to update profile details.
        </Text>

        {joinedLabel && (
          <Text style={styles.footerHint}>
            Joined Quinckle on {joinedLabel}
          </Text>
        )}

      </ScrollView>

      <ThemedDialog
        visible={dialog.visible}
        title={dialog.title}
        message={dialog.message}
        actions={dialog.actions}
        onClose={() => setDialog(prev => ({ ...prev, visible: false }))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: QuinckleColors.background,
  },

  /* ─── Banner ─── */
  staffBanner: {
    width: '100%',
    height: HERO_HEIGHT,
    position: 'relative',
    backgroundColor: '#111',
  },
  staffBannerImage: {
    width: '100%',
    height: '100%',
  },
  bannerBackBtn: {
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
  bannerRoleBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: 'rgba(99, 102, 241, 0.25)',
    borderWidth: 1,
    borderColor: 'rgba(129, 140, 248, 0.55)',
  },
  bannerRoleBadgeText: {
    color: '#C7D2FE',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  bannerRestaurantName: {
    color: '#fff',
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.4,
  },

  /* ─── Identity Card ─── */
  identityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.lg,
    marginTop: Spacing.md,
    marginHorizontal: Spacing.lg,
    backgroundColor: QuinckleColors.surface,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.lg,
    marginBottom: Spacing.lg,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 16,
    elevation: 8,
  },
  identityPhotoWrap: {
    position: 'relative',
    width: 72,
    height: 72,
  },
  identityPhoto: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: QuinckleColors.surfaceMuted,
  },
  identityPhotoFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  identityPhotoInitials: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  identityCameraBtn: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: QuinckleColors.primary,
    borderWidth: 2,
    borderColor: QuinckleColors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  identityTextCol: {
    flex: 1,
    flexDirection: 'column',
    gap: 4,
  },
  identityName: {
    color: QuinckleColors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  identityMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  identityMetaText: {
    color: QuinckleColors.textSecondary,
    fontSize: 13,
    fontWeight: '500',
  },

  /* ─── Section (grouped rows) ─── */
  section: {
    marginHorizontal: Spacing.lg,
    backgroundColor: QuinckleColors.surface,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    marginBottom: Spacing.md,
    overflow: 'hidden',
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.lg,
  },
  sectionRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: Spacing.md,
  },
  sectionIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.04)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTextGroup: {
    flex: 1,
  },
  sectionTitle: {
    color: QuinckleColors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  sectionSubtitle: {
    color: QuinckleColors.textTertiary,
    fontSize: 12,
    fontWeight: '400',
    marginTop: 2,
  },
  sectionDivider: {
    height: 1,
    backgroundColor: QuinckleColors.border,
    marginLeft: Spacing.lg + 38 + Spacing.md,
  },

  /* ─── Status dot ─── */
  statusDotContainer: {
    width: 14,
    height: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseDot: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: QuinckleColors.success,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },

  /* ─── Toggle ─── */
  toggleTrack: {
    width: 46,
    height: 26,
    borderRadius: 13,
    padding: 3,
    justifyContent: 'center',
  },
  toggleTrackOn: {
    backgroundColor: QuinckleColors.success,
  },
  toggleTrackOff: {
    backgroundColor: '#3f3f46',
  },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 2,
    elevation: 2,
  },
  toggleThumbOn: {
    transform: [{ translateX: 20 }],
  },
  toggleThumbOff: {
    transform: [{ translateX: 0 }],
  },

  /* ─── Week bar chart ─── */
  weekBarRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
    paddingTop: Spacing.sm,
    gap: 6,
  },
  barCol: {
    flex: 1,
    alignItems: 'center',
  },
  barTrack: {
    width: 6,
    height: 52,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 3,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  barFill: {
    width: '100%',
    borderRadius: 3,
  },
  barLabel: {
    color: QuinckleColors.textTertiary,
    fontSize: 10,
    fontWeight: '500',
    marginTop: 6,
  },
  weekTotal: {
    alignItems: 'center',
    paddingLeft: Spacing.sm,
    marginBottom: 2,
  },
  weekTotalValue: {
    color: QuinckleColors.primary,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  weekTotalLabel: {
    color: QuinckleColors.textTertiary,
    fontSize: 10,
    fontWeight: '500',
    marginTop: -1,
  },

  /* ─── Logout ─── */
  logoutSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: Spacing.lg,
    backgroundColor: QuinckleColors.surface,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.15)',
    paddingVertical: Spacing.md + 2,
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  logoutText: {
    color: QuinckleColors.danger,
    fontSize: 15,
    fontWeight: '600',
  },

  /* ─── Footer ─── */
  footerHint: {
    color: QuinckleColors.textTertiary,
    fontSize: 11,
    textAlign: 'center',
    marginTop: Spacing.sm,
    paddingHorizontal: Spacing.xxl,
  },
});
