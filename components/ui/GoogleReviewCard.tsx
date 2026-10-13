/**
 * Full-screen "rate us on Google" card the crew turns round to the guest.
 *
 * The guest scans the QR with their own phone on purpose: opening the review
 * link on the crew phone would post the review from the crew member's Google
 * account, which reads as fake and Google may take down. White, not the app's
 * dark theme, because a dark QR on a dim café table is hard for cameras.
 *
 * The link is the owner's `googleReviewUrl` (partner profile); the floor only
 * shows the header star when one is set.
 */

import React from 'react';
import { Image, Modal, StatusBar, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';
import { QuinckleColors } from '../../constants/Colors';

type Props = {
  visible: boolean;
  onClose: () => void;
  url: string;
  venueName: string;
  logoUrl?: string | null;
};

const INK = '#141416';
const STAR = '#F5B400';

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? 'Q').slice(0, 2)).toUpperCase();
}

export function GoogleReviewCard({ visible, onClose, url, venueName, logoUrl }: Props) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  // Big enough to scan from across a table, small enough to leave room for
  // the copy on a short phone or a landscape tablet.
  const qrSize = Math.round(Math.min(width * 0.68, height * 0.4, 320));

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <StatusBar barStyle="dark-content" />
      <View style={[s.screen, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }]}>
        <TouchableOpacity
          onPress={onClose}
          style={s.closeBtn}
          activeOpacity={0.7}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityLabel="Close"
        >
          <Ionicons name="close" size={22} color="#444441" />
        </TouchableOpacity>

        <View style={s.body}>
          {logoUrl ? (
            <Image source={{ uri: logoUrl }} style={s.logo} resizeMode="cover" />
          ) : (
            <View style={[s.logo, s.logoFallback]}>
              <Text style={s.logoText}>{initials(venueName)}</Text>
            </View>
          )}

          <Text style={s.title}>Enjoyed your meal?</Text>
          <Text style={s.sub}>Scan to rate {venueName} on Google</Text>

          <View style={s.qrFrame}>
            <QRCode value={url} size={qrSize} backgroundColor="#ffffff" color={INK} />
          </View>

          <View style={s.stars} accessibilityLabel="Five stars">
            {[0, 1, 2, 3, 4].map((i) => (
              <Ionicons key={i} name="star" size={26} color={STAR} />
            ))}
          </View>
          <Text style={s.foot}>Takes 30 seconds · thank you</Text>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#ffffff' },
  closeBtn: {
    alignSelf: 'flex-start',
    marginLeft: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F1EFE8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  logo: { width: 64, height: 64, borderRadius: 18, marginBottom: 16 },
  logoFallback: { backgroundColor: QuinckleColors.primary, alignItems: 'center', justifyContent: 'center' },
  logoText: { color: '#ffffff', fontSize: 22, fontWeight: '700' },
  title: { color: INK, fontSize: 26, fontWeight: '700', textAlign: 'center' },
  sub: { color: '#5F5E5A', fontSize: 15, marginTop: 6, marginBottom: 24, textAlign: 'center' },
  qrFrame: {
    padding: 14,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#D3D1C7',
    backgroundColor: '#ffffff',
  },
  stars: { flexDirection: 'row', gap: 4, marginTop: 24 },
  foot: { color: '#888780', fontSize: 13, marginTop: 8 },
});
