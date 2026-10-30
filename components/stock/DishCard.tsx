/**
 * A dish as a card on the Menu linking tab (CREW_STOCK_PLAN.md §12).
 *
 * Picture on top, an amber ribbon across anything unlinked. Plenty of dishes
 * have no image — `imageUrl` is nullable on MenuItem — so the placeholder is
 * the same fast-food tile the order-menu screen already uses, rather than a
 * broken frame or a fallback URL that 404s.
 *
 * The card carries a material COUNT where the row carried chips. That is the
 * trade this direction makes: recognisable at a glance, but you open a dish to
 * see what is actually in it.
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { QuinckleColors as C, Radius, Spacing } from '../../constants/Colors';
import type { CrewDish } from '../../services/api';

export function DishCard({ dish, imageUrl, soldUnits, width, onPress }: {
  dish: CrewDish;
  imageUrl?: string | null;
  /** Units sold recently — only known for dishes on the priority list. */
  soldUnits?: number;
  width: number;
  onPress: () => void;
}) {
  const linked = dish.materials > 0;
  return (
    <TouchableOpacity style={[s.card, { width }]} onPress={onPress} activeOpacity={0.8}>
      <View style={s.imgWrap}>
        {imageUrl ? (
          // expo-image caches on disk, so the second pass through a long menu
          // costs nothing. `transition` hides the first paint's pop-in.
          <Image source={{ uri: imageUrl }} style={s.img} contentFit="cover" transition={120} />
        ) : (
          <View style={[s.img, s.imgPlaceholder]}>
            <Ionicons name="fast-food-outline" size={22} color={C.textMuted} />
          </View>
        )}
        {!linked && (
          <View style={s.ribbon}>
            <Text style={s.ribbonText}>NOT LINKED</Text>
          </View>
        )}
      </View>

      <View style={s.body}>
        <Text style={s.name} numberOfLines={1}>{dish.name}</Text>
        <View style={s.metaRow}>
          <Text style={[s.meta, !linked && { color: C.warning }]} numberOfLines={1}>
            {linked
              ? `${dish.materials} material${dish.materials === 1 ? '' : 's'}`
              : soldUnits
                ? `${soldUnits} sold`
                : 'no recipe'}
          </Text>
          {dish.estimated > 0 && <Text style={s.est}>{dish.estimated} est</Text>}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  card: {
    borderRadius: Radius.md, borderWidth: 1, borderColor: C.border,
    backgroundColor: C.surface, overflow: 'hidden',
  },
  imgWrap: { width: '100%', aspectRatio: 16 / 10, position: 'relative' },
  img: { width: '100%', height: '100%' },
  imgPlaceholder: { backgroundColor: C.surfaceMutedHover, alignItems: 'center', justifyContent: 'center' },
  ribbon: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    backgroundColor: 'rgba(245,158,11,0.92)', paddingVertical: 2, alignItems: 'center',
  },
  ribbonText: { color: '#2B1C00', fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  body: { paddingHorizontal: Spacing.sm, paddingTop: 7, paddingBottom: 9 },
  name: { color: C.textPrimary, fontSize: 12.5, fontWeight: '600' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  meta: { flex: 1, color: C.textTertiary, fontSize: 10.5 },
  est: {
    color: C.warning, fontSize: 9, fontWeight: '700',
    backgroundColor: C.warningSoft, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1,
  },
});
