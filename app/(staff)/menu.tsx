import React, { useMemo, useState } from 'react';
import {
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';

type MenuItem = {
  id: string;
  name: string;
  price: number;
  category: string;
};

const MENU_DATA: MenuItem[] = [
  { id: '1', name: 'Chicken Biryani', price: 250, category: 'Mains' },
  { id: '2', name: 'Butter Chicken', price: 320, category: 'Mains' },
  { id: '3', name: 'Garlic Naan', price: 50, category: 'Sides' },
  { id: '4', name: 'Paneer Tikka', price: 220, category: 'Appetizers' },
  { id: '5', name: 'Cold Coffee', price: 120, category: 'Beverages' },
  { id: '6', name: 'Lemon Soda', price: 80, category: 'Beverages' },
  { id: '7', name: 'Dal Makhani', price: 180, category: 'Mains' },
  { id: '8', name: 'Hara Bhara Kabab', price: 190, category: 'Appetizers' },
];

const CATEGORIES = ['All', 'Appetizers', 'Mains', 'Sides', 'Beverages', 'Desserts'];

export default function OrderMenu() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { tableId } = useLocalSearchParams();
  const [searchText, setSearchText] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const [cart, setCart] = useState<Record<string, number>>({});

  const filteredMenu = useMemo(() => {
    return MENU_DATA.filter((item) => {
      const matchesSearch = item.name.toLowerCase().includes(searchText.toLowerCase());
      const matchesCategory = activeCategory === 'All' || item.category === activeCategory;
      return matchesSearch && matchesCategory;
    });
  }, [searchText, activeCategory]);

  const addToCart = (id: string) => {
    setCart((prev) => ({ ...prev, [id]: (prev[id] || 0) + 1 }));
  };

  const removeFromCart = (id: string) => {
    if (!cart[id]) return;
    const newCart = { ...cart };
    if (newCart[id] === 1) delete newCart[id];
    else newCart[id] -= 1;
    setCart(newCart);
  };

  const cartCount = Object.values(cart).reduce((a, b) => a + b, 0);
  const cartTotal = Object.entries(cart).reduce((sum, [id, qty]) => {
    const item = MENU_DATA.find((m) => m.id === id);
    return sum + (item?.price || 0) * qty;
  }, 0);

  return (
    <View style={[styles.container, { paddingTop: insets.top + Spacing.sm }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={20} color={QuinckleColors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Take Order</Text>
          <Text style={styles.headerSubtitle}>Table T{String(tableId || '02').padStart(2, '0')}</Text>
        </View>
      </View>

      <View style={styles.searchContainer}>
        <Ionicons name="search" size={15} color={QuinckleColors.textTertiary} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search menu items…"
          placeholderTextColor={QuinckleColors.textTertiary}
          value={searchText}
          onChangeText={setSearchText}
        />
        {searchText.length > 0 && (
          <TouchableOpacity onPress={() => setSearchText('')}>
            <Ionicons name="close-circle" size={16} color={QuinckleColors.textTertiary} />
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipScroll}
        style={styles.chipRow}
      >
        {CATEGORIES.map((cat) => (
          <TouchableOpacity
            key={cat}
            style={[styles.chip, activeCategory === cat && styles.chipActive]}
            onPress={() => setActiveCategory(cat)}
          >
            <Text style={[styles.chipText, activeCategory === cat && styles.chipTextActive]}>{cat}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <FlatList
        data={filteredMenu}
        keyExtractor={(item) => item.id}
        contentContainerStyle={[styles.listContent, { paddingBottom: cartCount > 0 ? 130 : Spacing.xxl }]}
        renderItem={({ item }) => (
          <View style={styles.menuItemCard}>
            <View style={styles.itemInfo}>
              <Text style={styles.itemName}>{item.name}</Text>
              <View style={styles.itemMeta}>
                <Text style={styles.itemCategory}>{item.category}</Text>
                <Text style={styles.itemDot}>·</Text>
                <Text style={styles.itemPrice}>₹{item.price}</Text>
              </View>
            </View>

            {cart[item.id] ? (
              <View style={styles.qtyContainer}>
                <TouchableOpacity onPress={() => removeFromCart(item.id)} style={styles.qtyBtn}>
                  <Ionicons name="remove" size={16} color="#fff" />
                </TouchableOpacity>
                <Text style={styles.qtyText}>{cart[item.id]}</Text>
                <TouchableOpacity onPress={() => addToCart(item.id)} style={styles.qtyBtn}>
                  <Ionicons name="add" size={16} color="#fff" />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity onPress={() => addToCart(item.id)} style={styles.addBtn} activeOpacity={0.85}>
                <Ionicons name="add" size={16} color={QuinckleColors.primary} />
                <Text style={styles.addBtnText}>Add</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="search-outline" size={28} color={QuinckleColors.textTertiary} />
            <Text style={styles.emptyText}>No items match your search.</Text>
          </View>
        }
      />

      {cartCount > 0 && (
        <View style={[styles.cartFooter, { paddingBottom: insets.bottom + Spacing.lg }]}>
          <TouchableOpacity
            style={styles.confirmBtn}
            onPress={() => router.back()}
            activeOpacity={0.85}
          >
            <View>
              <Text style={styles.cartCountText}>
                {cartCount} {cartCount === 1 ? 'item' : 'items'}
              </Text>
              <Text style={styles.cartTotalText}>₹{cartTotal}</Text>
            </View>
            <View style={styles.cartAction}>
              <Text style={styles.cartActionText}>Confirm Order</Text>
              <Ionicons name="arrow-forward" size={18} color="#fff" />
            </View>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: QuinckleColors.background,
    paddingHorizontal: Spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginBottom: Spacing.lg,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    backgroundColor: QuinckleColors.surfaceMuted,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: QuinckleColors.textPrimary,
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    color: QuinckleColors.textTertiary,
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
  },

  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: QuinckleColors.surfaceMuted,
    paddingHorizontal: Spacing.md,
    height: 44,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  searchInput: {
    flex: 1,
    color: QuinckleColors.textPrimary,
    fontSize: 14,
  },

  chipRow: {
    marginBottom: Spacing.md,
    flexGrow: 0,
  },
  chipScroll: {
    gap: Spacing.sm,
    paddingRight: Spacing.lg,
  },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
    borderRadius: Radius.pill,
    backgroundColor: QuinckleColors.surfaceMuted,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
  },
  chipActive: {
    backgroundColor: QuinckleColors.primarySoft,
    borderColor: QuinckleColors.primarySoftBorder,
  },
  chipText: {
    color: QuinckleColors.textSecondary,
    fontSize: 13,
    fontWeight: '500',
  },
  chipTextActive: {
    color: QuinckleColors.primary,
    fontWeight: '600',
  },

  listContent: {
    gap: Spacing.sm,
  },
  menuItemCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: QuinckleColors.surface,
    borderRadius: Radius.md,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
  },
  itemInfo: {
    flex: 1,
  },
  itemName: {
    color: QuinckleColors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
  },
  itemMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  itemCategory: {
    color: QuinckleColors.textTertiary,
    fontSize: 12,
    fontWeight: '500',
  },
  itemDot: {
    color: QuinckleColors.textMuted,
    fontSize: 11,
  },
  itemPrice: {
    color: QuinckleColors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },

  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: QuinckleColors.primarySoft,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: QuinckleColors.primarySoftBorder,
    gap: 4,
  },
  addBtnText: {
    color: QuinckleColors.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  qtyContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: QuinckleColors.primary,
    borderRadius: Radius.sm,
    padding: 4,
  },
  qtyBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qtyText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    minWidth: 14,
    textAlign: 'center',
  },

  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.huge,
    gap: Spacing.md,
  },
  emptyText: {
    color: QuinckleColors.textTertiary,
    fontSize: 14,
  },

  cartFooter: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: QuinckleColors.background,
    paddingTop: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderTopWidth: 1,
    borderTopColor: QuinckleColors.border,
  },
  confirmBtn: {
    backgroundColor: QuinckleColors.primary,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.xl,
    paddingVertical: 14,
    borderRadius: Radius.md,
  },
  cartCountText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  cartTotalText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    marginTop: 1,
  },
  cartAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cartActionText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
