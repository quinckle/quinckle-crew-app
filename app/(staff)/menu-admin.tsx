// Manage menu — crew with MENU_EDIT add and edit items and combos here, the
// same way the owner does in the partner app. The edit screens are ports of
// the partner ones (menu-item-edit / menu-combo-edit / menu-modifiers) and hit
// the same backend routes, so an owner and a staffer can never disagree about
// what a field means. Every change is recorded under the person's name and
// shows up in the History tab (and in the owner's apps).

import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { QuinckleColors, Radius, Spacing, Typography } from '@/constants/Colors';
import { ChangeHistory } from '@/components/menu-admin/ChangeHistory';
import {
  adminCombos,
  adminMenu,
  type DineCombo,
  type DineMenuCategory,
  type DineMenuItem,
} from '@/services/menuAdmin';

type Tab = 'items' | 'combos' | 'history';

/** Clients append -thumb to the stored base URL (same contract as the partner app). */
const thumb = (url: string | null | undefined) => (url ? `${url}-thumb.webp` : null);

export default function MenuAdminScreen() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('items');
  const [categories, setCategories] = useState<DineMenuCategory[]>([]);
  const [combos, setCombos] = useState<DineCombo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [toggling, setToggling] = useState<string | null>(null);
  // Bumped on every focus so the History tab refetches after an edit.
  const [historyKey, setHistoryKey] = useState(0);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [menu, comboRes] = await Promise.all([adminMenu.getMenu(), adminCombos.list()]);
      setCategories(menu);
      setCombos(comboRes.data ?? []);
    } catch (e: any) {
      setError(e?.message ?? 'Could not load the menu');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Refetch whenever we come back from an edit screen.
  useFocusEffect(useCallback(() => {
    void load();
    setHistoryKey((k) => k + 1);
  }, [load]));

  const categoryNames = useMemo(() => categories.map((c) => c.name), [categories]);

  const openItem = (item: DineMenuItem, categoryName: string) => {
    router.push({
      pathname: '/(staff)/menu-item-edit',
      params: {
        id: item.id,
        name: item.name,
        description: item.description ?? '',
        price: parseFloat(item.price).toString(),
        originalPrice: item.originalPrice ? parseFloat(item.originalPrice).toString() : '',
        takeawayPrice: item.takeawayPrice ? parseFloat(item.takeawayPrice).toString() : '',
        // The grouped menu response strips item.category; use the group name.
        category: categoryName,
        isVeg: item.isVeg ? 'true' : 'false',
        spiceLevel: item.spiceLevel,
        imageUrl: item.imageUrl ?? '',
        channels: JSON.stringify(item.channels ?? []),
        categories: JSON.stringify(categoryNames),
        taxRatePercent: item.taxRatePercent != null ? String(item.taxRatePercent) : '',
        taxCategory: item.taxCategory ?? '',
        hsnSac: item.hsnSac ?? '',
        schedule: JSON.stringify({
          scheduleEnabled: item.scheduleEnabled ?? false,
          availabilityWindows: item.availabilityWindows ?? null,
          validFrom: item.validFrom ?? null,
          validUntil: item.validUntil ?? null,
          lastOrderCutoffMin: item.lastOrderCutoffMin ?? null,
          dailyQtyCap: item.dailyQtyCap ?? null,
          hideWhenUnavailable: item.hideWhenUnavailable ?? false,
        }),
      },
    });
  };

  const openNewItem = () =>
    router.push({ pathname: '/(staff)/menu-item-edit', params: { categories: JSON.stringify(categoryNames) } });

  const openCombo = (combo: DineCombo) => {
    router.push({
      pathname: '/(staff)/menu-combo-edit',
      params: {
        id: combo.id,
        title: combo.title,
        description: combo.description ?? '',
        tag: combo.tag,
        imageUrl: combo.imageUrl ?? '',
        itemDetailsJson: JSON.stringify(combo.itemDetails),
        rulesJson: JSON.stringify({
          channels: combo.channels,
          scheduleEnabled: combo.scheduleEnabled,
          availableDays: combo.availableDays,
          windowStartMinute: combo.windowStartMinute,
          windowEndMinute: combo.windowEndMinute,
          validFrom: combo.validFrom,
          validUntil: combo.validUntil,
          dailyCap: combo.dailyCap,
          dailyCapMode: combo.dailyCapMode,
          lifetimeCap: combo.lifetimeCap,
          lifetimeRedeemed: combo.lifetimeRedeemed,
        }),
      },
    });
  };

  const toggleItem = async (item: DineMenuItem) => {
    setToggling(item.id);
    const next = !item.isAvailable;
    // Optimistic — revert on failure.
    const patch = (value: boolean) =>
      setCategories((prev) => prev.map((c) => ({
        ...c,
        items: c.items.map((i) => (i.id === item.id ? { ...i, isAvailable: value } : i)),
      })));
    patch(next);
    try {
      await adminMenu.toggleAvailability(item.id, next);
    } catch {
      patch(!next);
    } finally {
      setToggling(null);
    }
  };

  const q = search.trim().toLowerCase();
  const visibleCategories = categories
    .map((c) => ({ ...c, items: q ? c.items.filter((i) => i.name.toLowerCase().includes(q)) : c.items }))
    .filter((c) => c.items.length > 0);
  const visibleCombos = q ? combos.filter((c) => c.title.toLowerCase().includes(q)) : combos;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={22} color={QuinckleColors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.title}>Manage menu</Text>
        {tab !== 'history' ? (
          <TouchableOpacity
            onPress={tab === 'items' ? openNewItem : () => router.push('/(staff)/menu-combo-edit')}
            style={styles.addBtn}
            activeOpacity={0.8}
          >
            <Ionicons name="add" size={18} color={QuinckleColors.textPrimary} />
            <Text style={styles.addText}>{tab === 'items' ? 'Item' : 'Combo'}</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.headerBtn} />
        )}
      </View>

      <View style={styles.tabs}>
        {(['items', 'combos', 'history'] as Tab[]).map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.tab, tab === t && styles.tabActive]}
            onPress={() => setTab(t)}
            activeOpacity={0.8}
          >
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === 'items' ? 'Items' : t === 'combos' ? 'Combos' : 'History'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab !== 'history' && (
        <View style={styles.searchBox}>
          <Ionicons name="search" size={16} color={QuinckleColors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder={tab === 'items' ? 'Search items' : 'Search combos'}
            placeholderTextColor={QuinckleColors.textMuted}
            value={search}
            onChangeText={setSearch}
          />
        </View>
      )}

      {loading ? (
        <ActivityIndicator style={{ marginTop: Spacing.xl }} color={QuinckleColors.primary} />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.xl }]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); void load(); setHistoryKey((k) => k + 1); }}
              tintColor={QuinckleColors.primary}
            />
          }
        >
          {error && <Text style={styles.error}>{error}</Text>}

          {tab === 'items' && visibleCategories.map((cat) => (
            <View key={cat.name} style={styles.section}>
              <Text style={styles.sectionTitle}>{cat.name} · {cat.items.length}</Text>
              {cat.items.map((item) => (
                <TouchableOpacity key={item.id} style={styles.row} onPress={() => openItem(item, cat.name)} activeOpacity={0.75}>
                  {item.imageUrl ? (
                    <Image source={{ uri: thumb(item.imageUrl)! }} style={styles.thumb} />
                  ) : (
                    <View style={[styles.thumb, styles.thumbEmpty]}>
                      <Ionicons name="restaurant-outline" size={16} color={QuinckleColors.textMuted} />
                    </View>
                  )}
                  <View style={styles.rowBody}>
                    <Text style={[styles.rowName, !item.isAvailable && styles.dim]} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.rowSub}>₹{parseFloat(item.price)}{item.isAvailable ? '' : ' · Unavailable'}</Text>
                  </View>
                  <Switch
                    value={item.isAvailable}
                    disabled={toggling === item.id}
                    onValueChange={() => toggleItem(item)}
                    trackColor={{ true: QuinckleColors.success, false: QuinckleColors.surfaceMuted }}
                  />
                </TouchableOpacity>
              ))}
            </View>
          ))}
          {tab === 'items' && visibleCategories.length === 0 && !error && (
            <Text style={styles.empty}>{q ? 'No items match.' : 'No items yet — add the first one.'}</Text>
          )}

          {tab === 'combos' && visibleCombos.map((combo) => (
            <TouchableOpacity key={combo.id} style={styles.row} onPress={() => openCombo(combo)} activeOpacity={0.75}>
              {combo.imageUrl ? (
                <Image source={{ uri: thumb(combo.imageUrl)! }} style={styles.thumb} />
              ) : (
                <View style={[styles.thumb, styles.thumbEmpty]}>
                  <Ionicons name="fast-food-outline" size={16} color={QuinckleColors.textMuted} />
                </View>
              )}
              <View style={styles.rowBody}>
                <Text style={[styles.rowName, !combo.isActive && styles.dim]} numberOfLines={1}>{combo.title}</Text>
                <Text style={styles.rowSub} numberOfLines={1}>
                  ₹{Number(combo.price)} · {combo.items.join(', ')}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={QuinckleColors.textMuted} />
            </TouchableOpacity>
          ))}
          {tab === 'combos' && visibleCombos.length === 0 && !error && (
            <Text style={styles.empty}>{q ? 'No combos match.' : 'No combos yet.'}</Text>
          )}

          {tab === 'history' && <ChangeHistory key={historyKey} filter={{}} showEntity />}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: QuinckleColors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
  },
  headerBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  title: { ...Typography.title, color: QuinckleColors.textPrimary, flex: 1 },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: QuinckleColors.primary,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
  },
  addText: { ...Typography.bodyStrong, color: QuinckleColors.textPrimary },
  tabs: {
    flexDirection: 'row',
    marginHorizontal: Spacing.md,
    backgroundColor: QuinckleColors.surface,
    borderRadius: Radius.pill,
    padding: 3,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
  },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: Radius.pill },
  tabActive: { backgroundColor: QuinckleColors.primarySoft, borderWidth: 1, borderColor: QuinckleColors.primarySoftBorder },
  tabText: { ...Typography.label, color: QuinckleColors.textSecondary },
  tabTextActive: { color: QuinckleColors.primary },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    margin: Spacing.md,
    marginBottom: 0,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: QuinckleColors.surface,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
  },
  searchInput: { flex: 1, paddingVertical: 10, color: QuinckleColors.textPrimary, ...Typography.body },
  content: { padding: Spacing.md },
  section: { marginBottom: Spacing.lg },
  sectionTitle: { ...Typography.label, color: QuinckleColors.textTertiary, marginBottom: Spacing.sm, textTransform: 'uppercase' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.sm,
    marginBottom: Spacing.sm,
    borderRadius: Radius.md,
    backgroundColor: QuinckleColors.surface,
    borderWidth: 1,
    borderColor: QuinckleColors.borderSubtle,
  },
  thumb: { width: 44, height: 44, borderRadius: Radius.sm, backgroundColor: QuinckleColors.surfaceMuted },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1, minWidth: 0 },
  rowName: { ...Typography.bodyStrong, color: QuinckleColors.textPrimary },
  rowSub: { ...Typography.caption, color: QuinckleColors.textSecondary, marginTop: 2 },
  dim: { color: QuinckleColors.textMuted },
  empty: { ...Typography.body, color: QuinckleColors.textMuted, textAlign: 'center', marginTop: Spacing.xl },
  error: { ...Typography.caption, color: QuinckleColors.danger, marginBottom: Spacing.md },
});
