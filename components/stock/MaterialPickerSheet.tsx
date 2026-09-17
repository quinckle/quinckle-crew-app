/**
 * Pick a material — used by the recipe editor (CREW_STOCK_PLAN.md §3).
 *
 * Materials already on the recipe are hidden rather than shown disabled: the
 * server rejects a duplicate outright (`DUPLICATE_MATERIAL`), so offering one
 * would only ever end in an error.
 */

import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheet } from '../ui/BottomSheet';
import { QuinckleColors as C, Radius, Spacing } from '../../constants/Colors';
import { fmtQty } from '../../constants/stock';
import type { CrewMaterial } from '../../services/api';
import { sheetStyles } from './pieces';

export function MaterialPickerSheet({ visible, materials, exclude, onClose, onPick }: {
  visible: boolean;
  materials: CrewMaterial[];
  /** stockItemIds already on the recipe. */
  exclude: string[];
  onClose: () => void;
  onPick: (m: CrewMaterial) => void;
}) {
  const [search, setSearch] = useState('');

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return materials
      .filter((m) => !exclude.includes(m.id))
      .filter((m) => !q || m.name.toLowerCase().includes(q));
  }, [materials, exclude, search]);

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Add material" maxHeightRatio={0.8}>
      <TextInput
        style={sheetStyles.input} value={search} onChangeText={setSearch}
        placeholder="Search materials" placeholderTextColor={C.textMuted} autoFocus
      />
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ marginTop: Spacing.sm }}>
        {rows.length === 0 && (
          <Text style={[sheetStyles.hint, { marginTop: Spacing.md }]}>
            {materials.length === exclude.length ? 'Every material is already on this dish.' : 'Nothing matches.'}
          </Text>
        )}
        {rows.map((m) => (
          <TouchableOpacity
            key={m.id} style={st.row} activeOpacity={0.75}
            onPress={() => { onPick(m); setSearch(''); }}
          >
            <Text style={st.name} numberOfLines={1}>{m.name}</Text>
            <Text style={st.qty}>{fmtQty(m.currentQty, m.unit)}</Text>
            <Ionicons name="add" size={18} color={C.primary} />
          </TouchableOpacity>
        ))}
        <View style={{ height: Spacing.xl }} />
      </ScrollView>
    </BottomSheet>
  );
}

const st = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.borderSubtle,
  },
  name: { flex: 1, color: C.textPrimary, fontSize: 14.5, fontWeight: '600' },
  qty: { color: C.textSecondary, fontSize: 12.5, fontVariant: ['tabular-nums'] },
});
