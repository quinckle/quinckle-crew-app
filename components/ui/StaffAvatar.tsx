/**
 * StaffAvatar — a staff member's profile photo, or their initials.
 *
 * `photoUrl` is self-serve: each person uploads their own from the profile
 * screen, and a cook who never opens the app never will. So the initials are
 * not a fallback for a rare failure — they are what most rows render, and they
 * get the same care as the photo.
 *
 * The tint is derived from the id rather than picked at random, so the same
 * person is the same colour on every screen, every shift. That, not the two
 * letters, is what makes a list of six names scannable at a glance.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';

/** Dark fill + light ink, so both sit legibly on the app's dark surfaces. */
const TINTS = [
  { bg: '#26215C', fg: '#AFA9EC' },
  { bg: '#04342C', fg: '#5DCAA5' },
  { bg: '#4A1B0C', fg: '#F0997B' },
  { bg: '#0C447C', fg: '#85B7EB' },
  { bg: '#4B1528', fg: '#ED93B1' },
  { bg: '#412402', fg: '#EF9F27' },
];

function tintFor(id: string) {
  let h = 7;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return TINTS[h % TINTS.length]!;
}

export function initialsOf(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

interface Props {
  id: string;
  name: string;
  photoUrl?: string | null;
  size?: number;
}

export function StaffAvatar({ id, name, photoUrl, size = 40 }: Props) {
  const tint = tintFor(id);
  return (
    // The initials sit UNDER the image, not beside it: a photo that is slow,
    // cached-out or 404 then shows a name rather than an empty disc.
    <View
      style={[
        styles.wrap,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: tint.bg },
      ]}
    >
      <Text style={[styles.initials, { fontSize: Math.round(size * 0.32), color: tint.fg }]}>
        {initialsOf(name)}
      </Text>
      {photoUrl ? (
        <Image
          source={{ uri: photoUrl }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={120}
          cachePolicy="memory-disk"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  initials: { fontWeight: '700', letterSpacing: -0.2 },
});
