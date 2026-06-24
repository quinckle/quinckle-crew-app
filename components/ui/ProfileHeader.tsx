import React from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';

type BadgeColors = { bg: string; border: string; text: string };

type Props = {
  photoUrl?: string | null;
  name: string;
  roleLabel: string;
  badgeColors: BadgeColors;
  restaurantName?: string | null;
  phone?: string | null;
  onChangePhoto: () => void;
  isUploadingPhoto: boolean;
};

export default function ProfileHeader({
  photoUrl,
  name,
  roleLabel,
  badgeColors,
  restaurantName,
  phone,
  onChangePhoto,
  isUploadingPhoto,
}: Props) {
  const initials = name
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <View style={styles.card}>
      <View style={styles.avatarWrap}>
        {photoUrl ? (
          <Image source={{ uri: photoUrl }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarInitials}>{initials}</Text>
          </View>
        )}
        <TouchableOpacity
          style={styles.cameraBtn}
          onPress={onChangePhoto}
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

      <Text style={styles.name} numberOfLines={1}>{name}</Text>

      <View style={[styles.badge, { backgroundColor: badgeColors.bg, borderColor: badgeColors.border }]}>
        <Text style={[styles.badgeText, { color: badgeColors.text }]}>{roleLabel}</Text>
      </View>

      {restaurantName ? (
        <View style={styles.metaRow}>
          <Ionicons name="storefront-outline" size={13} color={QuinckleColors.textTertiary} />
          <Text style={styles.metaText} numberOfLines={1}>{restaurantName}</Text>
        </View>
      ) : null}

      {phone ? (
        <View style={styles.metaRow}>
          <Ionicons name="call-outline" size={13} color={QuinckleColors.textTertiary} />
          <Text style={styles.metaText}>{phone}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    marginHorizontal: Spacing.lg,
    backgroundColor: QuinckleColors.surface,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    paddingTop: Spacing.xxl,
    paddingBottom: Spacing.xxl + Spacing.sm,
    paddingHorizontal: Spacing.lg,
    marginBottom: Spacing.lg,
    gap: 6,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 16,
    elevation: 8,
  },
  avatarWrap: {
    position: 'relative',
    width: 104,
    height: 104,
    marginBottom: Spacing.sm,
  },
  avatar: {
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: QuinckleColors.surfaceMuted,
  },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  cameraBtn: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: QuinckleColors.primary,
    borderWidth: 2,
    borderColor: QuinckleColors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {
    color: QuinckleColors.textPrimary,
    fontSize: 19,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    marginVertical: 4,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  metaText: {
    color: QuinckleColors.textSecondary,
    fontSize: 13,
    fontWeight: '500',
  },
});
