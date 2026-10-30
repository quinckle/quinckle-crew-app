import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Image,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import {
  adminModifiers,
  uploadMenuImage,
  type AppModifierGroup,
} from '@/services/menuAdmin';
import { QuinckleColors, Spacing, Radius, Typography } from '@/constants/Colors';
import { AlertProvider, useAlert } from '@/components/menu-admin/AppAlert';
import { useAuth } from '@/context/AuthContext';
import { CAP } from '@/constants/capabilities';
import { BottomSheet } from '@/components/menu-admin/BottomSheet';

function selectionLabel(min: number, max: number): string {
  if (min > 0) return `Required · choose ${min === max ? min : `${min}–${max}`}`;
  return `Optional${max > 1 ? ` · up to ${max}` : ''}`;
}

// Ported from the partner app; the crew root has no AlertProvider, so each
// menu-admin screen brings its own.
export default function ModifierGroupsScreenRoute() {
  return (
    <AlertProvider>
      <ModifierGroupsScreen />
    </AlertProvider>
  );
}

function ModifierGroupsScreen() {
  const insets = useSafeAreaInsets();
  const alert = useAlert();
  // Deleting is its own capability (MENU_DELETE) — the server refuses it
  // regardless; hiding the control just saves a staffer the 403.
  const canDelete = useAuth().can(CAP.MENU_DELETE);
  const params = useLocalSearchParams<{ itemId: string; itemName?: string }>();

  const [groups, setGroups] = useState<AppModifierGroup[]>([]);
  const [loading, setLoading] = useState(true);

  // Add/Edit group sheet
  const [groupSheetOpen, setGroupSheetOpen] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [groupName, setGroupName] = useState('');
  const [groupMin, setGroupMin] = useState('0');
  const [groupMax, setGroupMax] = useState('1');
  const [groupHasImages, setGroupHasImages] = useState(false);
  const [savingGroup, setSavingGroup] = useState(false);

  // Add/Edit option sheet
  const [optionSheetGroupId, setOptionSheetGroupId] = useState<string | null>(null);
  const [editingOptionId, setEditingOptionId] = useState<string | null>(null);
  const [optName, setOptName] = useState('');
  const [optPrice, setOptPrice] = useState('');
  const [optDefault, setOptDefault] = useState(false);
  const [optImageUrl, setOptImageUrl] = useState<string | null>(null);
  const [uploadingOptImage, setUploadingOptImage] = useState(false);
  const [savingOption, setSavingOption] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    adminModifiers.getGroups(params.itemId)
      .then(setGroups)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [params.itemId]);

  useEffect(() => { if (params.itemId) load(); }, [params.itemId, load]);

  // ── Group sheet ─────────────────────────────────────────────────────────────

  const openAddGroup = () => {
    setEditingGroupId(null);
    setGroupName('');
    setGroupMin('0');
    setGroupMax('1');
    setGroupHasImages(false);
    setGroupSheetOpen(true);
  };

  const openEditGroup = (g: AppModifierGroup) => {
    setEditingGroupId(g.id);
    setGroupName(g.name);
    setGroupMin(String(g.minSelections || 0));
    setGroupMax(String(g.maxSelections || 1));
    setGroupHasImages(!!g.hasImages);
    setGroupSheetOpen(true);
  };

  const saveGroup = async () => {
    if (!groupName.trim()) return;
    setSavingGroup(true);
    try {
      const payload = {
        name: groupName.trim(),
        minSelections: parseInt(groupMin) || 0,
        maxSelections: parseInt(groupMax) || 1,
        hasImages: groupHasImages,
      };
      if (editingGroupId) {
        const updated = await adminModifiers.updateGroup(params.itemId, editingGroupId, payload);
        setGroups(prev => prev.map(g => (g.id === editingGroupId ? { ...g, ...updated } : g)));
      } else {
        const g = await adminModifiers.createGroup(params.itemId, { ...payload, sortOrder: groups.length });
        setGroups(prev => [...prev, { ...g, options: [] }]);
      }
      setGroupSheetOpen(false);
    } catch (e: any) {
      alert.error(e.message ?? 'Failed to save group');
    } finally {
      setSavingGroup(false);
    }
  };

  const deleteGroup = (groupId: string) => {
    alert.confirm('Delete group', 'Remove this modifier group and all its options?', async () => {
      try {
        await adminModifiers.deleteGroup(params.itemId, groupId);
        setGroups(prev => prev.filter(g => g.id !== groupId));
      } catch (e: any) { alert.error(e.message ?? 'Failed to delete'); }
    }, { danger: true, confirmText: 'Delete' });
  };

  const toggleGroupActive = async (groupId: string) => {
    const group = groups.find(g => g.id === groupId);
    if (!group) return;
    const next = !group.isActive;
    setGroups(prev => prev.map(g => (g.id === groupId ? { ...g, isActive: next } : g)));
    try {
      await adminModifiers.updateGroup(params.itemId, groupId, { isActive: next });
    } catch (e: any) {
      setGroups(prev => prev.map(g => (g.id === groupId ? { ...g, isActive: group.isActive } : g)));
      alert.error(e.message ?? 'Failed to update group');
    }
  };

  const moveGroup = async (groupId: string, dir: 'up' | 'down') => {
    const idx = groups.findIndex(g => g.id === groupId);
    if (idx < 0) return;
    if (dir === 'up' && idx === 0) return;
    if (dir === 'down' && idx === groups.length - 1) return;
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
    const next = [...groups];
    [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
    const sortA = next[idx].sortOrder;
    const sortB = next[swapIdx].sortOrder;
    next[idx] = { ...next[idx], sortOrder: sortB };
    next[swapIdx] = { ...next[swapIdx], sortOrder: sortA };
    setGroups(next);
    try {
      await Promise.all([
        adminModifiers.updateGroup(params.itemId, next[idx].id, { sortOrder: sortB }),
        adminModifiers.updateGroup(params.itemId, next[swapIdx].id, { sortOrder: sortA }),
      ]);
    } catch (e: any) {
      alert.error(e.message ?? 'Failed to reorder groups');
      load();
    }
  };

  // ── Option sheet ────────────────────────────────────────────────────────────

  const openAddOption = (groupId: string) => {
    setOptionSheetGroupId(groupId);
    setEditingOptionId(null);
    setOptName('');
    setOptPrice('');
    setOptDefault(false);
    setOptImageUrl(null);
  };

  const openEditOption = (groupId: string, optionId: string) => {
    const g = groups.find(x => x.id === groupId);
    const o = g?.options.find(x => x.id === optionId);
    if (!o) return;
    setOptionSheetGroupId(groupId);
    setEditingOptionId(optionId);
    setOptName(o.name);
    setOptPrice(String(parseFloat(o.priceAdjustment || '0')));
    setOptDefault(!!o.isDefault);
    setOptImageUrl(o.imageUrl ?? null);
  };

  const pickOptionImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      alert.info('Allow access to your photo library to add an option image.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;
    const uri = result.assets[0].uri;
    setUploadingOptImage(true);
    try {
      const ext = uri.split('.').pop() ?? 'jpg';
      const mime = ext === 'png' ? 'image/png' : 'image/jpeg';
      const url = await uploadMenuImage(uri, mime);
      setOptImageUrl(url);
    } catch (e: any) {
      alert.error(e.message ?? 'Image upload failed');
    } finally {
      setUploadingOptImage(false);
    }
  };

  const saveOption = async () => {
    if (!optName.trim() || !optionSheetGroupId) return;
    setSavingOption(true);
    try {
      if (editingOptionId) {
        const opt = await adminModifiers.updateOption(params.itemId, optionSheetGroupId, editingOptionId, {
          name: optName.trim(),
          priceAdjustment: parseFloat(optPrice) || 0,
          isDefault: optDefault,
          imageUrl: optImageUrl,
        });
        setGroups(prev => prev.map(g => g.id === optionSheetGroupId
          ? { ...g, options: g.options.map(o => o.id === editingOptionId ? opt : o) }
          : g));
      } else {
        const group = groups.find(g => g.id === optionSheetGroupId);
        const opt = await adminModifiers.createOption(params.itemId, optionSheetGroupId, {
          name: optName.trim(),
          priceAdjustment: parseFloat(optPrice) || 0,
          isDefault: optDefault,
          sortOrder: group?.options.length ?? 0,
          imageUrl: optImageUrl,
        });
        setGroups(prev => prev.map(g => g.id === optionSheetGroupId ? { ...g, options: [...g.options, opt] } : g));
      }
      setOptionSheetGroupId(null);
    } catch (e: any) {
      alert.error(e.message ?? 'Failed to save option');
    } finally {
      setSavingOption(false);
    }
  };

  const deleteOption = async (groupId: string, optionId: string) => {
    try {
      await adminModifiers.deleteOption(params.itemId, groupId, optionId);
      setGroups(prev => prev.map(g => g.id === groupId ? { ...g, options: g.options.filter(o => o.id !== optionId) } : g));
    } catch (e: any) { alert.error(e.message ?? 'Failed to delete option'); }
  };

  const moveOption = async (groupId: string, optionId: string, dir: 'up' | 'down') => {
    const group = groups.find(g => g.id === groupId);
    if (!group) return;
    const idx = group.options.findIndex(o => o.id === optionId);
    if (idx < 0) return;
    if (dir === 'up' && idx === 0) return;
    if (dir === 'down' && idx === group.options.length - 1) return;
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
    const next = [...group.options];
    [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
    const sortA = next[idx].sortOrder;
    const sortB = next[swapIdx].sortOrder;
    next[idx] = { ...next[idx], sortOrder: sortB };
    next[swapIdx] = { ...next[swapIdx], sortOrder: sortA };
    setGroups(prev => prev.map(g => g.id === groupId ? { ...g, options: next } : g));
    try {
      await Promise.all([
        adminModifiers.updateOption(params.itemId, groupId, next[idx].id, { sortOrder: sortB }),
        adminModifiers.updateOption(params.itemId, groupId, next[swapIdx].id, { sortOrder: sortA }),
      ]);
    } catch (e: any) {
      alert.error(e.message ?? 'Failed to reorder options');
      load();
    }
  };

  const toggleOptionAvailable = async (groupId: string, optionId: string) => {
    const g = groups.find(x => x.id === groupId);
    const o = g?.options.find(x => x.id === optionId);
    if (!o) return;
    try {
      const updated = await adminModifiers.updateOption(params.itemId, groupId, optionId, { isAvailable: !o.isAvailable });
      setGroups(prev => prev.map(x => x.id === groupId ? { ...x, options: x.options.map(k => k.id === optionId ? updated : k) } : x));
    } catch (e: any) { alert.error(e.message ?? 'Failed to update option'); }
  };

  const optionSheetGroup = groups.find(g => g.id === optionSheetGroupId) ?? null;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={22} color={QuinckleColors.textPrimary} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Modifiers</Text>
            {!!params.itemName && <Text style={styles.subtitle} numberOfLines={1}>{params.itemName}</Text>}
          </View>
          <View style={{ width: 40 }} />
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + Spacing.huge }]}
        >
          {loading ? (
            <ActivityIndicator size="small" color={QuinckleColors.primary} style={{ marginTop: Spacing.xxl }} />
          ) : groups.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="options-outline" size={32} color={QuinckleColors.textMuted} />
              <Text style={styles.emptyTitle}>No modifier groups yet</Text>
              <Text style={styles.emptySub}>Add size, toppings or add-on choices for this item.</Text>
            </View>
          ) : (
            groups.map((group, gi) => (
              <View key={group.id} style={[styles.groupCard, !group.isActive && styles.groupCardInactive]}>
                <View style={styles.groupHeader}>
                  <View style={styles.reorderCol}>
                    <TouchableOpacity onPress={() => moveGroup(group.id, 'up')} disabled={gi === 0} hitSlop={8}>
                      <Ionicons name="chevron-up" size={16} color={gi === 0 ? QuinckleColors.textMuted : QuinckleColors.textSecondary} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => moveGroup(group.id, 'down')} disabled={gi === groups.length - 1} hitSlop={8}>
                      <Ionicons name="chevron-down" size={16} color={gi === groups.length - 1 ? QuinckleColors.textMuted : QuinckleColors.textSecondary} />
                    </TouchableOpacity>
                  </View>

                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={styles.groupName} numberOfLines={1}>{group.name}</Text>
                      {group.hasImages && <Ionicons name="image-outline" size={13} color={QuinckleColors.textMuted} />}
                    </View>
                    <Text style={styles.groupMeta}>
                      {selectionLabel(group.minSelections, group.maxSelections)} · {group.options.length} option{group.options.length !== 1 ? 's' : ''}
                    </Text>
                  </View>

                  <TouchableOpacity onPress={() => toggleGroupActive(group.id)} hitSlop={8} activeOpacity={0.7} style={styles.groupHeaderBtn}>
                    <Ionicons
                      name={group.isActive ? 'toggle' : 'toggle-outline'}
                      size={26}
                      color={group.isActive ? QuinckleColors.success : QuinckleColors.textMuted}
                    />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => openEditGroup(group)} hitSlop={8} activeOpacity={0.7} style={styles.groupHeaderBtn}>
                    <Ionicons name="pencil-outline" size={18} color={QuinckleColors.textSecondary} />
                  </TouchableOpacity>
                  {canDelete && (
                    <TouchableOpacity onPress={() => deleteGroup(group.id)} hitSlop={8} activeOpacity={0.7} style={styles.groupHeaderBtn}>
                      <Ionicons name="trash-outline" size={18} color={QuinckleColors.danger} />
                    </TouchableOpacity>
                  )}
                </View>

                {group.options.length === 0 ? (
                  <Text style={styles.optionsEmpty}>No options yet.</Text>
                ) : (
                  <View style={styles.optionsList}>
                    {group.options.map((opt, oi) => (
                      <View key={opt.id} style={[styles.optionRow, oi > 0 && styles.optionRowBorder]}>
                        <View style={styles.reorderCol}>
                          <TouchableOpacity onPress={() => moveOption(group.id, opt.id, 'up')} disabled={oi === 0} hitSlop={8}>
                            <Ionicons name="chevron-up" size={14} color={oi === 0 ? QuinckleColors.textMuted : QuinckleColors.textSecondary} />
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => moveOption(group.id, opt.id, 'down')} disabled={oi === group.options.length - 1} hitSlop={8}>
                            <Ionicons name="chevron-down" size={14} color={oi === group.options.length - 1 ? QuinckleColors.textMuted : QuinckleColors.textSecondary} />
                          </TouchableOpacity>
                        </View>

                        {group.hasImages && (
                          opt.imageUrl
                            ? <Image source={{ uri: opt.imageUrl }} style={styles.optionThumb} />
                            : <View style={[styles.optionThumb, styles.optionThumbEmpty]}>
                                <Ionicons name="image-outline" size={14} color={QuinckleColors.textMuted} />
                              </View>
                        )}

                        <View style={{ flex: 1 }}>
                          <Text style={styles.optionName} numberOfLines={1}>{opt.name}</Text>
                          <View style={styles.optionTagsRow}>
                            <Text style={styles.optionPrice}>
                              {parseFloat(opt.priceAdjustment) > 0 ? `+₹${parseFloat(opt.priceAdjustment).toFixed(0)}` :
                               parseFloat(opt.priceAdjustment) < 0 ? `-₹${Math.abs(parseFloat(opt.priceAdjustment)).toFixed(0)}` : 'Free'}
                            </Text>
                            {opt.isDefault && <Text style={styles.optionDefaultTag}>Default</Text>}
                          </View>
                        </View>

                        <TouchableOpacity onPress={() => toggleOptionAvailable(group.id, opt.id)} hitSlop={8} activeOpacity={0.7} style={styles.optionActionBtn}>
                          <Ionicons
                            name={opt.isAvailable ? 'toggle' : 'toggle-outline'}
                            size={22}
                            color={opt.isAvailable ? QuinckleColors.success : QuinckleColors.textMuted}
                          />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => openEditOption(group.id, opt.id)} hitSlop={8} activeOpacity={0.7} style={styles.optionActionBtn}>
                          <Ionicons name="pencil-outline" size={16} color={QuinckleColors.textSecondary} />
                        </TouchableOpacity>
                        {canDelete && (
                          <TouchableOpacity onPress={() => deleteOption(group.id, opt.id)} hitSlop={8} activeOpacity={0.7} style={styles.optionActionBtn}>
                            <Ionicons name="close" size={17} color={QuinckleColors.textMuted} />
                          </TouchableOpacity>
                        )}
                      </View>
                    ))}
                  </View>
                )}

                <TouchableOpacity style={styles.addOptionBtn} onPress={() => openAddOption(group.id)} activeOpacity={0.7}>
                  <Ionicons name="add" size={16} color={QuinckleColors.primary} />
                  <Text style={styles.addOptionText}>Add option</Text>
                </TouchableOpacity>
              </View>
            ))
          )}

          <TouchableOpacity style={styles.addGroupBtn} onPress={openAddGroup} activeOpacity={0.7}>
            <Ionicons name="add-circle-outline" size={18} color={QuinckleColors.primary} />
            <Text style={styles.addGroupText}>Add modifier group</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>

      {/* Add/Edit group */}
      <BottomSheet
        visible={groupSheetOpen}
        onClose={() => setGroupSheetOpen(false)}
        title={editingGroupId ? 'Edit group' : 'New group'}
      >
        <View style={styles.sheetBody}>
          <Text style={styles.sheetFieldLabel}>Group name</Text>
          <TextInput
            style={styles.sheetInput}
            value={groupName}
            onChangeText={setGroupName}
            placeholder="e.g. Size, Toppings"
            placeholderTextColor={QuinckleColors.textMuted}
            autoCorrect={false}
          />

          <View style={styles.sheetRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.sheetFieldLabel}>Min selections</Text>
              <TextInput
                style={styles.sheetInput}
                value={groupMin}
                onChangeText={setGroupMin}
                placeholder="0"
                placeholderTextColor={QuinckleColors.textMuted}
                keyboardType="number-pad"
              />
              <Text style={styles.sheetHint}>0 = optional</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.sheetFieldLabel}>Max selections</Text>
              <TextInput
                style={styles.sheetInput}
                value={groupMax}
                onChangeText={setGroupMax}
                placeholder="1"
                placeholderTextColor={QuinckleColors.textMuted}
                keyboardType="number-pad"
              />
              <Text style={styles.sheetHint}>1 = single choice</Text>
            </View>
          </View>

          <TouchableOpacity
            style={styles.sheetToggleRow}
            onPress={() => setGroupHasImages(v => !v)}
            activeOpacity={0.7}
          >
            <Ionicons
              name={groupHasImages ? 'toggle' : 'toggle-outline'}
              size={26}
              color={groupHasImages ? QuinckleColors.primary : QuinckleColors.textMuted}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.sheetToggleLabel}>Show images for options</Text>
              <Text style={styles.sheetHint}>e.g. flavour photos</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.sheetSaveBtn, (savingGroup || !groupName.trim()) && { opacity: 0.5 }]}
            onPress={saveGroup}
            disabled={savingGroup || !groupName.trim()}
            activeOpacity={0.85}
          >
            {savingGroup ? <ActivityIndicator size="small" color="#fff" /> : (
              <Text style={styles.sheetSaveText}>{editingGroupId ? 'Save group' : 'Add group'}</Text>
            )}
          </TouchableOpacity>
        </View>
      </BottomSheet>

      {/* Add/Edit option */}
      <BottomSheet
        visible={!!optionSheetGroupId}
        onClose={() => setOptionSheetGroupId(null)}
        title={editingOptionId ? 'Edit option' : 'New option'}
      >
        <View style={styles.sheetBody}>
          {optionSheetGroup?.hasImages && (
            <TouchableOpacity style={styles.optImagePickerLarge} onPress={pickOptionImage} activeOpacity={0.8}>
              {uploadingOptImage ? (
                <ActivityIndicator size="small" color={QuinckleColors.primary} />
              ) : optImageUrl ? (
                <Image source={{ uri: optImageUrl }} style={styles.optImagePickerLargeImg} />
              ) : (
                <>
                  <Ionicons name="camera-outline" size={22} color={QuinckleColors.textMuted} />
                  <Text style={styles.sheetHint}>Add photo</Text>
                </>
              )}
            </TouchableOpacity>
          )}

          <Text style={styles.sheetFieldLabel}>Option name</Text>
          <TextInput
            style={styles.sheetInput}
            value={optName}
            onChangeText={setOptName}
            placeholder="e.g. Large, Extra cheese"
            placeholderTextColor={QuinckleColors.textMuted}
            autoCorrect={false}
          />

          <Text style={styles.sheetFieldLabel}>Price adjustment (₹)</Text>
          <TextInput
            style={styles.sheetInput}
            value={optPrice}
            onChangeText={setOptPrice}
            placeholder="0"
            placeholderTextColor={QuinckleColors.textMuted}
            keyboardType="decimal-pad"
          />

          <TouchableOpacity
            style={styles.sheetToggleRow}
            onPress={() => setOptDefault(v => !v)}
            activeOpacity={0.7}
          >
            <Ionicons
              name={optDefault ? 'toggle' : 'toggle-outline'}
              size={26}
              color={optDefault ? QuinckleColors.primary : QuinckleColors.textMuted}
            />
            <Text style={styles.sheetToggleLabel}>Default selection</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.sheetSaveBtn, (savingOption || !optName.trim()) && { opacity: 0.5 }]}
            onPress={saveOption}
            disabled={savingOption || !optName.trim()}
            activeOpacity={0.85}
          >
            {savingOption ? <ActivityIndicator size="small" color="#fff" /> : (
              <Text style={styles.sheetSaveText}>{editingOptionId ? 'Save option' : 'Add option'}</Text>
            )}
          </TouchableOpacity>
        </View>
      </BottomSheet>
    </KeyboardAvoidingView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: QuinckleColors.background },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    gap: Spacing.sm,
  },
  headerBtn: {
    width: 40, height: 40,
    borderRadius: Radius.pill,
    justifyContent: 'center', alignItems: 'center',
  },
  title: { ...Typography.subtitle, color: QuinckleColors.textPrimary },
  subtitle: { ...Typography.micro, color: QuinckleColors.textSecondary, marginTop: 1 },

  scroll: { padding: Spacing.xl, gap: Spacing.lg },

  emptyState: {
    alignItems: 'center',
    gap: Spacing.xs,
    paddingVertical: Spacing.xxl,
  },
  emptyTitle: { ...Typography.bodyStrong, color: QuinckleColors.textPrimary, marginTop: Spacing.sm },
  emptySub: { ...Typography.caption, color: QuinckleColors.textSecondary, textAlign: 'center', paddingHorizontal: Spacing.xl },

  groupCard: {
    backgroundColor: QuinckleColors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  groupCardInactive: { opacity: 0.55 },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  groupHeaderBtn: { padding: 2 },
  reorderCol: { alignItems: 'center', gap: 2, marginRight: Spacing.xs },
  groupName: { ...Typography.bodyStrong, color: QuinckleColors.textPrimary, fontSize: 15 },
  groupMeta: { ...Typography.caption, color: QuinckleColors.textSecondary, marginTop: 2 },

  optionsEmpty: { ...Typography.caption, color: QuinckleColors.textMuted, fontStyle: 'italic' },
  optionsList: {
    backgroundColor: QuinckleColors.surfaceElevated,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: QuinckleColors.borderSubtle,
  },
  optionRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.md,
    gap: Spacing.sm,
  },
  optionRowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: QuinckleColors.borderSubtle },
  optionThumb: { width: 36, height: 36, borderRadius: Radius.sm },
  optionThumbEmpty: { backgroundColor: QuinckleColors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: QuinckleColors.border },
  optionName: { ...Typography.body, color: QuinckleColors.textPrimary },
  optionTagsRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: 2 },
  optionPrice: { ...Typography.caption, color: QuinckleColors.textSecondary },
  optionDefaultTag: { ...Typography.micro, color: QuinckleColors.primary, fontWeight: '700' },
  optionActionBtn: { padding: 2 },

  addOptionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: Spacing.sm,
  },
  addOptionText: { ...Typography.caption, color: QuinckleColors.primary, fontWeight: '700' },

  addGroupBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm,
    borderRadius: Radius.lg,
    borderWidth: 1, borderColor: QuinckleColors.border, borderStyle: 'dashed',
    paddingVertical: Spacing.lg,
  },
  addGroupText: { ...Typography.bodyStrong, color: QuinckleColors.primary },

  // Bottom sheet forms
  sheetBody: { paddingHorizontal: Spacing.xl, paddingBottom: Spacing.lg, gap: Spacing.md },
  sheetFieldLabel: { ...Typography.label, color: QuinckleColors.textSecondary, marginBottom: Spacing.xs },
  sheetInput: {
    backgroundColor: QuinckleColors.surfaceElevated,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    ...Typography.body,
    color: QuinckleColors.textPrimary,
  },
  sheetHint: { ...Typography.micro, color: QuinckleColors.textMuted, marginTop: 4 },
  sheetRow: { flexDirection: 'row', gap: Spacing.md },
  sheetToggleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  sheetToggleLabel: { ...Typography.body, color: QuinckleColors.textPrimary },
  sheetSaveBtn: {
    backgroundColor: QuinckleColors.primary,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    alignItems: 'center', justifyContent: 'center',
    marginTop: Spacing.sm,
  },
  sheetSaveText: { ...Typography.bodyStrong, color: '#fff' },

  optImagePickerLarge: {
    width: 88, height: 88,
    borderRadius: Radius.lg,
    backgroundColor: QuinckleColors.surfaceElevated,
    borderWidth: 1, borderColor: QuinckleColors.border, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center',
    alignSelf: 'center',
    overflow: 'hidden',
  },
  optImagePickerLargeImg: { width: '100%', height: '100%' },
});
