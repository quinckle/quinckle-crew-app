/**
 * OrderMenuSheet — crew manual-order menu bottom sheet.
 *
 * Features:
 *  - 88% height spring bottom sheet with drag-to-dismiss
 *  - Sticky search bar + category chip tabs (non-scrolling)
 *  - FlatList of menu items: image · name · veg dot · category chip · price
 *  - Pulsing skeleton rows while menu loads
 *  - Inline modifier bottom sheet (opens on top)
 *  - Fixed footer: item count + cart total + "Place Order" CTA
 */

import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheet } from './BottomSheet';
import { Skeleton } from './Skeleton';
import type { MenuItem, ModifierGroup } from '../../services/api';
import { QuinckleColors, Radius, Spacing, Typography } from '../../constants/Colors';

// ── Skeleton row ──────────────────────────────────────────────────────────────

function MenuItemSkeleton() {
  return (
    <View style={styles.itemRow}>
      <Skeleton width={72} height={72} radius={Radius.md} style={{ flexShrink: 0 }} />
      <View style={{ flex: 1, gap: 8, paddingLeft: Spacing.md }}>
        <Skeleton width="75%" height={15} />
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <Skeleton width={60} height={11} radius={Radius.pill} />
          <Skeleton width={10} height={10} radius={5} />
        </View>
        <Skeleton width={50} height={16} />
      </View>
      <Skeleton width={72} height={32} radius={Radius.md} style={{ flexShrink: 0 }} />
    </View>
  );
}

// ── Single menu item row ──────────────────────────────────────────────────────

interface MenuItemRowProps {
  item: MenuItem;
  qty: number;
  note: string;
  modSummary: string | null;
  onAdd: () => void;
  onRemove: () => void;
  onNoteChange: (text: string) => void;
}

function MenuItemRow({ item, qty, note, modSummary, onAdd, onRemove, onNoteChange }: MenuItemRowProps) {
  const price = parseFloat(item.price);
  const hasImage = !!item.imageUrl;
  const hasMods = (item.modifierGroups?.length ?? 0) > 0;

  return (
    <View style={styles.itemRow}>
      {/* Image */}
      {hasImage ? (
        <Image source={{ uri: item.imageUrl }} style={styles.itemImg} />
      ) : (
        <View style={styles.itemImgPlaceholder}>
          <Ionicons name="fast-food-outline" size={26} color={QuinckleColors.textMuted} />
        </View>
      )}

      {/* Info */}
      <View style={styles.itemInfo}>
        <Text style={styles.itemName} numberOfLines={2}>{item.name}</Text>

        <View style={styles.itemMeta}>
          {/* Category chip */}
          <View style={styles.categoryChip}>
            <Text style={styles.categoryChipText} numberOfLines={1}>{item.category}</Text>
          </View>
          {/* Veg/non-veg dot */}
          <View style={[styles.vegDot, { backgroundColor: item.isVeg ? QuinckleColors.success : QuinckleColors.danger }]} />
          {hasMods && (
            <Text style={styles.customisable}>+ options</Text>
          )}
        </View>

        <Text style={styles.itemPrice}>₹{price.toFixed(0)}</Text>

        {/* Modifier summary */}
        {modSummary ? (
          <Text style={styles.modSummary} numberOfLines={1}>{modSummary}</Text>
        ) : null}
      </View>

      {/* Qty control */}
      {qty > 0 ? (
        <View style={styles.qtyControl}>
          <TouchableOpacity onPress={onRemove} style={styles.qtyBtn} hitSlop={6}>
            <Ionicons name="remove" size={16} color={QuinckleColors.primary} />
          </TouchableOpacity>
          <Text style={styles.qtyText}>{qty}</Text>
          <TouchableOpacity onPress={onAdd} style={styles.qtyBtn} hitSlop={6}>
            <Ionicons name="add" size={16} color={QuinckleColors.primary} />
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity onPress={onAdd} style={styles.addBtn} activeOpacity={0.8}>
          <Ionicons name="add" size={16} color={QuinckleColors.primary} />
          <Text style={styles.addBtnText}>Add</Text>
        </TouchableOpacity>
      )}

      {/* Inline note input when item is in cart */}
      {qty > 0 && (
        <TextInput
          style={[styles.noteInput, { position: 'absolute', bottom: 10, left: 72 + Spacing.md + Spacing.md, right: 84 }]}
          placeholder="Note (e.g. no onions)"
          placeholderTextColor={QuinckleColors.textMuted}
          value={note}
          onChangeText={onNoteChange}
          returnKeyType="done"
        />
      )}
    </View>
  );
}

// ── Modifier bottom sheet ─────────────────────────────────────────────────────

interface ModifierSheetProps {
  item: MenuItem | null;
  pending: Record<string, string[]>;
  onToggle: (groupId: string, optionId: string, max: number) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

function ModifierSheet({ item, pending, onToggle, onConfirm, onCancel }: ModifierSheetProps) {
  return (
    <BottomSheet visible={!!item} onClose={onCancel} title={item?.name ?? ''} maxHeightRatio={0.75}>
      {item?.modifierGroups?.map((group: ModifierGroup) => (
        <View key={group.id} style={styles.modGroup}>
          <View style={styles.modGroupHeader}>
            <Text style={styles.modGroupName}>{group.name}</Text>
            <Text style={styles.modGroupHint}>
              {group.minSelections > 0 ? 'Required · ' : ''}
              {group.maxSelections === 1 ? 'Pick 1' : `Up to ${group.maxSelections}`}
            </Text>
          </View>
          {group.options.map(opt => {
            const selected = (pending[group.id] ?? []).includes(opt.id);
            const adj = parseFloat(opt.priceAdjustment ?? '0');
            return (
              <TouchableOpacity
                key={opt.id}
                style={[styles.modOption, selected && styles.modOptionActive]}
                onPress={() => onToggle(group.id, opt.id, group.maxSelections)}
                activeOpacity={0.75}
              >
                <View style={[styles.modCheck, selected && styles.modCheckActive,
                  group.maxSelections === 1 && { borderRadius: 9 },
                ]}>
                  {selected && <Ionicons name="checkmark" size={11} color="#fff" />}
                </View>
                <Text style={styles.modOptionName}>{opt.name}</Text>
                {adj !== 0 && (
                  <Text style={[styles.modAdj, adj < 0 && { color: QuinckleColors.success }]}>
                    {adj > 0 ? '+' : ''}₹{Math.abs(adj).toFixed(0)}
                  </Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      ))}

      <TouchableOpacity style={styles.modConfirmBtn} onPress={onConfirm} activeOpacity={0.85}>
        <Text style={styles.modConfirmText}>Add to order</Text>
      </TouchableOpacity>
    </BottomSheet>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  visible: boolean;
  onClose: () => void;
  tableNum: string;
  menuItems: MenuItem[];
  menuCategories: string[];
  isMenuLoading: boolean;
  cart: Record<string, number>;
  cartNotes: Record<string, string>;
  cartModifiers: Record<string, { groupId: string; optionId: string }[]>;
  cartTotal: number;
  onAddToCart: (itemId: string, modifiers?: { groupId: string; optionId: string }[]) => void;
  onRemoveFromCart: (itemId: string) => void;
  onNoteChange: (itemId: string, note: string) => void;
  onPlaceOrder: () => void;
}

export function OrderMenuSheet({
  visible, onClose, tableNum,
  menuItems, menuCategories, isMenuLoading,
  cart, cartNotes, cartModifiers, cartTotal,
  onAddToCart, onRemoveFromCart, onNoteChange, onPlaceOrder,
}: Props) {
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');

  // Modifier state — internal
  const [modifierItem, setModifierItem] = useState<MenuItem | null>(null);
  const [pendingMods, setPendingMods] = useState<Record<string, string[]>>({});

  const filteredItems = useMemo(() => {
    return menuItems.filter(item => {
      const matchSearch = item.name.toLowerCase().includes(search.toLowerCase());
      const matchCat = activeCategory === 'All' || item.category === activeCategory;
      return matchSearch && matchCat;
    });
  }, [menuItems, search, activeCategory]);

  const cartCount = Object.values(cart).reduce((a, b) => a + b, 0);

  const handleAddPress = (item: MenuItem) => {
    if ((item.modifierGroups?.length ?? 0) > 0) {
      const init: Record<string, string[]> = {};
      item.modifierGroups!.forEach(g => { init[g.id] = []; });
      setPendingMods(init);
      setModifierItem(item);
    } else {
      onAddToCart(item.id);
    }
  };

  const handleToggleMod = (groupId: string, optionId: string, max: number) => {
    setPendingMods(prev => {
      const cur = prev[groupId] ?? [];
      if (cur.includes(optionId)) return { ...prev, [groupId]: cur.filter(id => id !== optionId) };
      if (max === 1) return { ...prev, [groupId]: [optionId] };
      if (cur.length >= max) return prev;
      return { ...prev, [groupId]: [...cur, optionId] };
    });
  };

  const handleConfirmMods = () => {
    if (!modifierItem) return;
    const flat: { groupId: string; optionId: string }[] = [];
    Object.entries(pendingMods).forEach(([groupId, opts]) => {
      opts.forEach(optionId => flat.push({ groupId, optionId }));
    });
    onAddToCart(modifierItem.id, flat);
    setModifierItem(null);
  };

  const getModSummary = (itemId: string, item: MenuItem): string | null => {
    const mods = cartModifiers[itemId];
    if (!mods?.length) return null;
    return mods.map(({ groupId, optionId }) => {
      const g = item.modifierGroups?.find(g => g.id === groupId);
      return g?.options.find(o => o.id === optionId)?.name;
    }).filter(Boolean).join(', ') || null;
  };

  const renderItem = ({ item }: { item: MenuItem }) => (
    <MenuItemRow
      item={item}
      qty={cart[item.id] ?? 0}
      note={cartNotes[item.id] ?? ''}
      modSummary={getModSummary(item.id, item)}
      onAdd={() => handleAddPress(item)}
      onRemove={() => onRemoveFromCart(item.id)}
      onNoteChange={text => onNoteChange(item.id, text)}
    />
  );

  const renderSkeleton = () => (
    <View>
      {Array.from({ length: 7 }).map((_, i) => <MenuItemSkeleton key={i} />)}
    </View>
  );

  return (
    <>
      <BottomSheet
        visible={visible}
        onClose={onClose}
        maxHeightRatio={0.88}
        disableInternalScroll
      >
        {/* ── Inner layout: header / list / footer ── */}
        <View style={styles.inner}>

          {/* Title row */}
          <View style={styles.titleRow}>
            <Text style={styles.titleText}>Add Items — T{tableNum}</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={8}>
              <Ionicons name="close" size={18} color={QuinckleColors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Search bar */}
          <View style={styles.searchBar}>
            <Ionicons name="search" size={15} color={QuinckleColors.textMuted} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search menu…"
              placeholderTextColor={QuinckleColors.textMuted}
              value={search}
              onChangeText={setSearch}
              returnKeyType="search"
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch('')} hitSlop={8}>
                <Ionicons name="close-circle" size={15} color={QuinckleColors.textMuted} />
              </TouchableOpacity>
            )}
          </View>

          {/* Category chips */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsScroll}
            style={styles.chipsRow}
          >
            {menuCategories.map(cat => (
              <TouchableOpacity
                key={cat}
                style={[styles.chip, activeCategory === cat && styles.chipActive]}
                onPress={() => setActiveCategory(cat)}
                activeOpacity={0.75}
              >
                <Text style={[styles.chipText, activeCategory === cat && styles.chipTextActive]}>
                  {cat}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Divider */}
          <View style={styles.divider} />

          {/* Items list */}
          {isMenuLoading ? (
            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              {renderSkeleton()}
              <View style={{ height: Spacing.huge }} />
            </ScrollView>
          ) : filteredItems.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="search-outline" size={28} color={QuinckleColors.textMuted} />
              <Text style={styles.emptyText}>
                {menuItems.length === 0 ? 'No menu items available.' : 'No items match your search.'}
              </Text>
            </View>
          ) : (
            <FlatList
              data={filteredItems}
              keyExtractor={item => item.id}
              renderItem={renderItem}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: cartCount > 0 ? 90 : Spacing.xxl }}
            />
          )}

          {/* Footer */}
          {cartCount > 0 && (
            <View style={styles.footer}>
              <View style={styles.footerSummary}>
                <Text style={styles.footerCount}>{cartCount} item{cartCount !== 1 ? 's' : ''}</Text>
                <Text style={styles.footerTotal}>₹{cartTotal.toFixed(0)}</Text>
              </View>
              <TouchableOpacity
                style={styles.placeBtn}
                onPress={onPlaceOrder}
                activeOpacity={0.85}
              >
                <Text style={styles.placeBtnText}>Place Order</Text>
                <Ionicons name="arrow-forward" size={16} color="#fff" />
              </TouchableOpacity>
            </View>
          )}
        </View>
      </BottomSheet>

      {/* Modifier sheet — renders on top */}
      <ModifierSheet
        item={modifierItem}
        pending={pendingMods}
        onToggle={handleToggleMod}
        onConfirm={handleConfirmMods}
        onCancel={() => setModifierItem(null)}
      />
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  inner: {
    flex: 1,
  },

  // Title
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.md,
  },
  titleText: {
    ...Typography.subtitle,
    color: QuinckleColors.textPrimary,
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: QuinckleColors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Search
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: Spacing.xl,
    marginBottom: Spacing.md,
    backgroundColor: QuinckleColors.surfaceElevated,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    paddingHorizontal: Spacing.md,
    height: 42,
    gap: Spacing.sm,
  },
  searchInput: {
    flex: 1,
    color: QuinckleColors.textPrimary,
    fontSize: 14,
  },

  // Category chips
  chipsRow: { flexGrow: 0, marginBottom: Spacing.sm },
  chipsScroll: { paddingHorizontal: Spacing.xl, gap: Spacing.sm },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
    borderRadius: Radius.pill,
    backgroundColor: QuinckleColors.surfaceElevated,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
  },
  chipActive: {
    backgroundColor: QuinckleColors.primarySoft,
    borderColor: QuinckleColors.primarySoftBorder,
  },
  chipText: { ...Typography.micro, color: QuinckleColors.textSecondary, fontWeight: '600' },
  chipTextActive: { color: QuinckleColors.primary, fontWeight: '700' },

  divider: { height: StyleSheet.hairlineWidth, backgroundColor: QuinckleColors.borderSubtle, marginBottom: 2 },

  // Item row
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: QuinckleColors.borderSubtle,
    minHeight: 88,
    flexWrap: 'wrap',
  },
  itemImg: {
    width: 72,
    height: 72,
    borderRadius: Radius.md,
    backgroundColor: QuinckleColors.surfaceElevated,
    flexShrink: 0,
  },
  itemImgPlaceholder: {
    width: 72,
    height: 72,
    borderRadius: Radius.md,
    backgroundColor: QuinckleColors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  itemInfo: {
    flex: 1,
    paddingHorizontal: Spacing.md,
    gap: 4,
  },
  itemName: {
    ...Typography.body,
    color: QuinckleColors.textPrimary,
    fontWeight: '600',
  },
  itemMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  categoryChip: {
    backgroundColor: QuinckleColors.surfaceElevated,
    borderRadius: Radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 2,
    maxWidth: 120,
  },
  categoryChipText: {
    fontSize: 10,
    fontWeight: '600',
    color: QuinckleColors.textTertiary,
  },
  vegDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  customisable: {
    fontSize: 10,
    fontWeight: '600',
    color: QuinckleColors.primary,
  },
  itemPrice: {
    fontSize: 16,
    fontWeight: '700',
    color: QuinckleColors.primary,
    letterSpacing: -0.3,
  },
  modSummary: {
    fontSize: 11,
    color: QuinckleColors.textMuted,
    fontStyle: 'italic',
  },
  noteInput: {
    backgroundColor: QuinckleColors.surfaceElevated,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
    color: QuinckleColors.textPrimary,
    fontSize: 12,
    marginTop: 4,
  },

  // Qty / Add controls
  qtyControl: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: QuinckleColors.primarySoft,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: QuinckleColors.primarySoftBorder,
    overflow: 'hidden',
    flexShrink: 0,
  },
  qtyBtn: {
    width: 32,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyText: {
    ...Typography.body,
    color: QuinckleColors.primary,
    fontWeight: '700',
    minWidth: 20,
    textAlign: 'center',
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: QuinckleColors.primarySoft,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: QuinckleColors.primarySoftBorder,
    paddingHorizontal: Spacing.md,
    height: 36,
    flexShrink: 0,
  },
  addBtnText: {
    ...Typography.micro,
    color: QuinckleColors.primary,
    fontWeight: '700',
  },

  // Empty state
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.huge,
  },
  emptyText: { ...Typography.caption, color: QuinckleColors.textMuted },

  // Footer
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: QuinckleColors.surface,
    borderTopWidth: 1,
    borderTopColor: QuinckleColors.border,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  footerSummary: { flex: 1 },
  footerCount: { ...Typography.micro, color: QuinckleColors.textSecondary },
  footerTotal: { ...Typography.subtitle, color: QuinckleColors.textPrimary, marginTop: 2 },
  placeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: QuinckleColors.primary,
    paddingHorizontal: Spacing.xl,
    paddingVertical: 13,
    borderRadius: Radius.md,
  },
  placeBtnText: { ...Typography.bodyStrong, color: '#fff' },

  // Modifier sheet
  modGroup: { paddingHorizontal: Spacing.xl, marginBottom: Spacing.lg },
  modGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  modGroupName: { ...Typography.caption, color: QuinckleColors.textPrimary, fontWeight: '700' },
  modGroupHint: { ...Typography.micro, color: QuinckleColors.textMuted },
  modOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    marginBottom: 4,
    backgroundColor: QuinckleColors.surfaceElevated,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
  },
  modOptionActive: {
    backgroundColor: QuinckleColors.primarySoft,
    borderColor: QuinckleColors.primarySoftBorder,
  },
  modCheck: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: QuinckleColors.borderStrong,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modCheckActive: {
    borderColor: QuinckleColors.primary,
    backgroundColor: QuinckleColors.primary,
  },
  modOptionName: { ...Typography.body, color: QuinckleColors.textPrimary, flex: 1 },
  modAdj: { ...Typography.caption, color: QuinckleColors.textSecondary },
  modConfirmBtn: {
    marginHorizontal: Spacing.xl,
    marginTop: Spacing.sm,
    marginBottom: Spacing.md,
    backgroundColor: QuinckleColors.primary,
    borderRadius: Radius.lg,
    paddingVertical: Spacing.lg,
    alignItems: 'center',
  },
  modConfirmText: { ...Typography.bodyStrong, color: '#fff' },
});
