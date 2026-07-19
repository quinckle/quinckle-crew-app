import React, { useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';
import { useAuth } from '../../context/AuthContext';
import { crewAuth } from '../../services/api';
import { ThemedDialog } from '../../components/ui/themed-dialog';
import ProfileHeader from '../../components/ui/ProfileHeader';

const COOK_BADGE_COLORS = {
  bg: 'rgba(139, 92, 246, 0.25)',
  border: 'rgba(167, 139, 250, 0.55)',
  text: '#E9D5FF',
};

export default function CookProfile() {
  const insets = useSafeAreaInsets();
  const { staffInfo, logout, setPhotoUrl } = useAuth();
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);

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
          name={staffInfo?.name ?? 'Kitchen Staff'}
          roleLabel="Kitchen"
          badgeColors={COOK_BADGE_COLORS}
          restaurantName={staffInfo?.restaurantName}
          onChangePhoto={handlePhotoButtonPress}
          isUploadingPhoto={isUploadingPhoto}
        />

        <View style={styles.body}>
          <Text style={styles.adminText}>
            Contact your restaurant administrator to update profile details.
          </Text>

          {/* KOT Printer */}
          <TouchableOpacity
            style={styles.printerBtn}
            onPress={() => router.push('/printer')}
            activeOpacity={0.75}
          >
            <Ionicons name="print-outline" size={18} color={QuinckleColors.textPrimary} />
            <Text style={styles.printerBtnText}>KOT Printer</Text>
            <Ionicons name="chevron-forward" size={16} color={QuinckleColors.textTertiary} style={{ marginLeft: 'auto' }} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.logoutBtn} onPress={logout} activeOpacity={0.7}>
            <Ionicons name="log-out-outline" size={18} color={QuinckleColors.danger} />
            <Text style={styles.logoutBtnText}>Log Out</Text>
          </TouchableOpacity>
        </View>
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
  body: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.lg,
  },
  adminText: {
    color: QuinckleColors.textTertiary,
    fontSize: 12,
    textAlign: 'center',
  },
  printerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    backgroundColor: QuinckleColors.surface,
  },
  printerBtnText: {
    color: QuinckleColors.textPrimary,
    fontSize: 14,
    fontWeight: '500',
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
