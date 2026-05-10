import React, { useState, useMemo } from 'react';
import { 
  StyleSheet, 
  Text, 
  View, 
  TouchableOpacity, 
  TextInput, 
  FlatList, 
  ScrollView,
  SafeAreaView 
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { QuinckleColors } from '../../constants/Colors';

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
    return MENU_DATA.filter(item => {
      const matchesSearch = item.name.toLowerCase().includes(searchText.toLowerCase());
      const matchesCategory = activeCategory === 'All' || item.category === activeCategory;
      return matchesSearch && matchesCategory;
    });
  }, [searchText, activeCategory]);

  const addToCart = (id: string) => {
    setCart(prev => ({ ...prev, [id]: (prev[id] || 0) + 1 }));
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
    const item = MENU_DATA.find(m => m.id === id);
    return sum + (item?.price || 0) * qty;
  }, 0);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backCircle}>
          <Ionicons name="chevron-back" size={20} color={QuinckleColors.textPrimary} />
        </TouchableOpacity>
        <View>
          <Text style={styles.headerTitle}>Take Order</Text>
          <Text style={styles.headerSubtitle}>Table T{tableId || '02'}</Text>
        </View>
      </View>

      {/* Search */}
      <View style={styles.searchContainer}>
        <Ionicons name="search" size={18} color="rgba(255,255,255,0.3)" />
        <TextInput
          style={styles.searchInput}
          placeholder="Search menu items..."
          placeholderTextColor="rgba(255,255,255,0.3)"
          value={searchText}
          onChangeText={setSearchText}
        />
      </View>

      {/* Categories */}
      <View style={styles.categoriesWrapper}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoriesScroll}>
          {CATEGORIES.map(cat => (
            <TouchableOpacity 
              key={cat} 
              style={[styles.categoryPill, activeCategory === cat && styles.categoryPillActive]}
              onPress={() => setActiveCategory(cat)}
            >
              <Text style={[styles.categoryText, activeCategory === cat && styles.categoryTextActive]}>
                {cat}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Menu List */}
      <FlatList
        data={filteredMenu}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <View style={styles.menuItemCard}>
            <View style={styles.itemInfo}>
              <Text style={styles.itemName}>{item.name}</Text>
              <Text style={styles.itemPrice}>₹{item.price}</Text>
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
              <TouchableOpacity onPress={() => addToCart(item.id)} style={styles.addBtn}>
                <Ionicons name="add" size={18} color={QuinckleColors.primary} />
                <Text style={styles.addBtnText}>ADD</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      />

      {/* Cart Summary Footer */}
      {cartCount > 0 && (
        <View style={[styles.cartFooter, { paddingBottom: insets.bottom + 16 }]}>
          <TouchableOpacity 
            style={styles.confirmBtn}
            onPress={() => router.back()}
            activeOpacity={0.9}
          >
            <View>
              <Text style={styles.cartCountText}>{cartCount} items</Text>
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
    backgroundColor: '#050505',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  backCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  headerTitle: {
    color: QuinckleColors.textPrimary,
    fontSize: 20,
    fontWeight: '800',
  },
  headerSubtitle: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
    fontWeight: '600',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    marginHorizontal: 16,
    marginVertical: 12,
    paddingHorizontal: 12,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  searchInput: {
    flex: 1,
    color: '#fff',
    marginLeft: 10,
    fontSize: 14,
  },
  categoriesWrapper: {
    marginBottom: 8,
  },
  categoriesScroll: {
    paddingHorizontal: 16,
    gap: 8,
  },
  categoryPill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  categoryPillActive: {
    backgroundColor: QuinckleColors.primary,
  },
  categoryText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    fontWeight: '600',
  },
  categoryTextActive: {
    color: '#fff',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 100,
  },
  menuItemCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  itemInfo: {
    flex: 1,
    gap: 4,
  },
  itemName: {
    color: QuinckleColors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  itemPrice: {
    color: QuinckleColors.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(243,93,59,0.1)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(243,93,59,0.2)',
    gap: 4,
  },
  addBtnText: {
    color: QuinckleColors.primary,
    fontSize: 12,
    fontWeight: '800',
  },
  qtyContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: QuinckleColors.primary,
    borderRadius: 10,
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
    fontWeight: '800',
  },
  cartFooter: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#0A0A0A',
    paddingTop: 16,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  confirmBtn: {
    backgroundColor: QuinckleColors.primary,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 16,
    shadowColor: QuinckleColors.primary,
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  cartCountText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  cartTotalText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
  },
  cartAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cartActionText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
  },
});
