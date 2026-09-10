import React, { useState, useEffect, useMemo } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useAuth } from '../../context/AuthContext';
import { CAPABILITY_LABELS, ROLE_COLOR_FALLBACK } from '../../constants/capabilities';
import { crewAuth } from '../../services/api';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';
import { ThemedDialog } from '../../components/ui/themed-dialog';
import ProfileHeader from '../../components/ui/ProfileHeader';

const STAFF_BADGE_COLORS = {
  bg: 'rgba(99, 102, 241, 0.25)',
  border: 'rgba(129, 140, 248, 0.55)',
  text: '#C7D2FE',
};

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
  const { logout, staffInfo, setPhotoUrl, capabilities } = useAuth();
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
  const [joinedAt, setJoinedAt] = useState<string | null>(null);

  const [dialog, setDialog] = useState<{
    visible: boolean;
    title: string;
    message: string;
    actions: { label: string; variant?: 'default' | 'danger' | 'primary'; onPress: () => void }[];
  }>({
    visible: false,
    title: '',
    message: '',
    actions: [],
  });

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

  const handlePickAndUploadPhoto = async () => {
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

  const handleRemovePhoto = async () => {
    setDialog(prev => ({ ...prev, visible: false }));
    setIsUploadingPhoto(true);
    try {
      await crewAuth.removePhoto();
      setPhotoUrl('');
    } catch (err) {
      setDialog({
        visible: true,
        title: 'Couldn\'t remove photo',
        message: err instanceof Error ? err.message : 'Please try again.',
        actions: [{ label: 'OK', variant: 'primary', onPress: () => setDialog(prev => ({ ...prev, visible: false })) }]
      });
    } finally {
      setIsUploadingPhoto(false);
    }
  };

  const handlePhotoButtonPress = () => {
    if (!staffInfo?.photoUrl) {
      handlePickAndUploadPhoto();
      return;
    }
    setDialog({
      visible: true,
      title: 'Profile Photo',
      message: 'Change or remove your profile photo.',
      actions: [
        { label: 'Cancel', variant: 'default', onPress: () => setDialog(prev => ({ ...prev, visible: false })) },
        { label: 'Remove', variant: 'danger', onPress: handleRemovePhoto },
        { label: 'Change', variant: 'primary', onPress: () => { setDialog(prev => ({ ...prev, visible: false })); handlePickAndUploadPhoto(); } },
      ]
    });
  };

  const staffRole = useMemo(() => {
    const role = staffInfo?.role ?? 'STAFF';
    return role.charAt(0) + role.slice(1).toLowerCase();
  }, [staffInfo?.role]);

  return (
    <View style={styles.container}>
      <View style={[styles.topBar, { paddingTop: insets.top + Spacing.md }]}>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={24} color={QuinckleColors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topBarTitle} numberOfLines={1}>Profile</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingTop: Spacing.lg, paddingBottom: insets.bottom + Spacing.huge }}
        showsVerticalScrollIndicator={false}
      >

        <ProfileHeader
          photoUrl={staffInfo?.photoUrl}
          name={staffInfo?.name ?? 'Staff Member'}
          roleLabel={staffInfo?.designation ?? staffRole}
          badgeColors={STAFF_BADGE_COLORS}
          restaurantName={staffInfo?.restaurantName}
          phone={formatPhone(staffInfo?.phone) || null}
          onChangePhoto={handlePhotoButtonPress}
          isUploadingPhoto={isUploadingPhoto}
          bannerColor={staffInfo?.designationColor ?? ROLE_COLOR_FALLBACK}
        />

                {/* Module rows and app utilities moved to the Menu screen
            (app/(staff)/more.tsx). Profile is identity only, per plan §5 —
            keeping launchers in two places meant filtering one and not the
            other just relocated the modules instead of hiding them. */}

        {/* ─── YOUR ACCESS (read-only) ───
            Transparency, not a launcher: when a module disappears from this
            screen, this explains why rather than leaving the staffer to
            wonder whether the app is broken. `capabilities` is undefined on an
            older backend, in which case we show nothing at all. */}
        {Array.isArray(capabilities) && (
          <View style={styles.section}>
            <View style={styles.sectionRow}>
              <View style={styles.sectionRowLeft}>
                <View style={styles.sectionIconWrap}>
                  <Ionicons name="key-outline" size={18} color="white" />
                </View>
                <View style={styles.sectionTextGroup}>
                  <Text style={styles.sectionTitle}>Your access</Text>
                  <Text style={styles.sectionSubtitle}>
                    {staffInfo?.designation
                      ? `${staffInfo.designation} · ${capabilities.length} permissions`
                      : `${capabilities.length} permissions`}
                  </Text>
                  <Text style={[styles.sectionSubtitle, { marginTop: 6, lineHeight: 18 }]}>
                    {capabilities.length === 0
                      ? 'No permissions yet — ask your manager.'
                      : capabilities.map((c) => CAPABILITY_LABELS[c] ?? c).join(' · ')}
                  </Text>
                </View>
              </View>
            </View>
          </View>
        )}

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
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
    gap: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: QuinckleColors.border,
  },
  topBarTitle: {
    flex: 1,
    textAlign: 'center',
    color: QuinckleColors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
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
