// Featured screen — staff-only.
// Uses standalone route page to automatically inherit the premium slide_from_right Expo Stack transition.

import React, { useCallback, useEffect, useState, useRef } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Image,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../../context/AuthContext';
import { restaurantApi } from '../../services/api';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';
import { FeaturedSkeleton } from '../../components/ui/FeaturedSkeleton';

export default function FeaturedScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { staffInfo } = useAuth();

  const [menuData, setMenuData] = useState<any[]>([]);
  const [highlightedSection, setHighlightedSection] = useState<{ title: string; subtitle?: string; itemIds: string[] } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const scrollY = useRef(new Animated.Value(0)).current;

  const load = useCallback(async () => {
    const rid = staffInfo?.restaurantId;
    if (!rid) return;
    try {
      const [menuRes, highlightRes] = await Promise.allSettled([
        restaurantApi.getMenu(rid),
        restaurantApi.getHighlighted(rid),
      ]);

      if (menuRes.status === 'fulfilled') {
        const categories: any[] = (menuRes.value as any)?.data ?? [];
        const items = categories.flatMap((cat: any) => cat.items ?? []);
        if (items.length > 0) {
          setMenuData(items.map((item: any) => ({
            id: item.id, name: item.name,
            price: parseFloat(item.price), category: item.category,
            available: item.isAvailable, image: item.imageUrl ?? undefined,
          })));
        }
      }

      if (highlightRes.status === 'fulfilled') {
        setHighlightedSection((highlightRes.value as any)?.data ?? null);
      }
    } catch (err) {
      console.error('[featured] load failed', err);
    } finally {
      setIsLoading(false);
    }
  }, [staffInfo?.restaurantId]);

  useEffect(() => {
    load();
  }, [load]);

  const renderHeader = () => (
    <View style={styles.heroContainer}>
      <Image
        source={require('../../assets/images/hero banner/featured screen/hero banner.webp')}
        style={styles.heroImage}
        resizeMode="cover"
      />
      <LinearGradient
        colors={['rgba(10, 10, 11, 0.1)', 'rgba(10, 10, 11, 0.85)', QuinckleColors.background]}
        locations={[0, 0.8, 1]}
        style={StyleSheet.absoluteFillObject}
      />

      <View style={styles.heroTextSection}>
        <Text style={styles.heroTitle}>{highlightedSection?.title ?? 'Featured'}</Text>
        <View style={styles.statsRow}>
          <View style={styles.statPill}>
            <Text style={styles.statPillText}>
              {highlightedSection ? `${highlightedSection.itemIds?.length ?? 0} Item${highlightedSection.itemIds?.length !== 1 ? 's' : ''}` : '0 Items'}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Sticky Top Header Overlay */}
      <View style={[styles.stickyHeader, { paddingTop: insets.top }]}>
        <Animated.View
          style={[
            styles.stickyHeaderBg,
            {
              opacity: scrollY.interpolate({
                inputRange: [0, 80],
                outputRange: [0, 1],
                extrapolate: 'clamp',
              }),
            },
          ]}
        />
        
        <View style={styles.stickyHeaderContent}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerActionBtn} activeOpacity={0.7}>
            <Ionicons name="chevron-back" size={22} color={QuinckleColors.textPrimary} />
          </TouchableOpacity>

          <Animated.View
            style={{
              opacity: scrollY.interpolate({
                inputRange: [60, 120],
                outputRange: [0, 1],
                extrapolate: 'clamp',
              }),
            }}
          >
            <Text style={styles.stickyHeaderTitleText}>{highlightedSection?.title ?? 'Featured'}</Text>
          </Animated.View>

          <View style={{ width: 38 }} />
        </View>
      </View>

      {isLoading ? (
        <Animated.ScrollView
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { y: scrollY } } }],
            { useNativeDriver: true }
          )}
          scrollEventThrottle={16}
          contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.xl }}
        >
          {renderHeader()}
          <FeaturedSkeleton />
        </Animated.ScrollView>
      ) : (
        <Animated.ScrollView
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { y: scrollY } } }],
            { useNativeDriver: true }
          )}
          scrollEventThrottle={16}
          contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.xl }}
          showsVerticalScrollIndicator={false}
        >
          {renderHeader()}
          <View style={{ paddingHorizontal: Spacing.md, gap: 12, marginTop: 16 }}>
            {!highlightedSection ? (
              <Text style={{ color: QuinckleColors.textTertiary, textAlign: 'center', marginTop: 40 }}>No featured section configured</Text>
            ) : (
              <View style={styles.comboListCard}>
                {/* Section header */}
                <View style={styles.featuredSectionHeader}>
                  <MaterialIcons name="star" size={16} color={QuinckleColors.primary} />
                  <Text style={styles.featuredSectionEyebrow}>FEATURED SECTION</Text>
                </View>
                <View style={styles.comboListBody}>
                  <Text style={styles.comboListName}>{highlightedSection.title}</Text>
                  {highlightedSection.subtitle ? (
                    <Text style={styles.comboListDesc}>{highlightedSection.subtitle}</Text>
                  ) : null}
                  <View style={styles.featuredItemsDivider} />
                  <Text style={styles.featuredItemsLabel}>{highlightedSection.itemIds?.length ?? 0} items in this section</Text>
                  {menuData.filter(m => highlightedSection.itemIds?.includes(m.id)).map(item => (
                    <View key={item.id} style={styles.featuredItemRow}>
                      {item.image
                        ? <Image source={{ uri: item.image }} style={styles.featuredItemThumb} />
                        : <View style={[styles.featuredItemThumb, { backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' }]}>
                          <Ionicons name="fast-food-outline" size={14} color={QuinckleColors.textTertiary} />
                        </View>}
                      <View style={{ flex: 1 }}>
                        <Text style={styles.featuredItemName} numberOfLines={1}>{item.name}</Text>
                        <Text style={styles.featuredItemPrice}>₹{item.price}</Text>
                      </View>
                      {!item.available && (
                        <View style={styles.featuredUnavailableBadge}>
                          <Text style={styles.featuredUnavailableText}>Off</Text>
                        </View>
                      )}
                    </View>
                  ))}
                </View>
              </View>
            )}
          </View>
        </Animated.ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: QuinckleColors.background },
  stickyHeader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    overflow: 'hidden',
  },
  stickyHeaderBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#141416',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: QuinckleColors.border,
  },
  stickyHeaderContent: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.md,
  },
  headerActionBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  stickyHeaderTitleText: {
    color: QuinckleColors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  heroContainer: {
    height: 220,
    width: '100%',
    position: 'relative',
    overflow: 'hidden',
  },
  heroImage: {
    width: '100%',
    height: '100%',
  },
  heroTextSection: {
    position: 'absolute',
    bottom: Spacing.md,
    left: Spacing.lg,
    gap: Spacing.xs,
    maxWidth: '65%',
  },
  heroTitle: {
    color: QuinckleColors.textPrimary,
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  statPill: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  statPillText: {
    color: QuinckleColors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
  },
  comboListCard: {
    backgroundColor: '#141416',
    borderRadius: Radius.lg,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: QuinckleColors.borderSubtle,
    marginBottom: Spacing.xs,
  },
  comboListBody: {
    padding: Spacing.md,
  },
  comboListName: {
    color: QuinckleColors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  comboListDesc: {
    color: QuinckleColors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 6,
  },
  featuredSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: Spacing.xs,
  },
  featuredSectionEyebrow: {
    color: QuinckleColors.primary,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  featuredItemsDivider: {
    height: 1,
    backgroundColor: QuinckleColors.borderSubtle,
    marginVertical: 14,
  },
  featuredItemsLabel: {
    color: QuinckleColors.textTertiary,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: Spacing.sm,
  },
  featuredItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: 8,
  },
  featuredItemThumb: {
    width: 44,
    height: 44,
    borderRadius: Radius.sm,
  },
  featuredItemName: {
    color: QuinckleColors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  featuredItemPrice: {
    color: QuinckleColors.textSecondary,
    fontSize: 13,
    marginTop: 2,
  },
  featuredUnavailableBadge: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  featuredUnavailableText: {
    color: '#EF4444',
    fontSize: 10,
    fontWeight: '700',
  },
});
