// Combos screen — staff-only.
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
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../../context/AuthContext';
import { restaurantApi } from '../../services/api';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';
import { CombosSkeleton } from '../../components/ui/CombosSkeleton';

export default function CombosScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { staffInfo } = useAuth();

  const [combos, setCombos] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const scrollY = useRef(new Animated.Value(0)).current;

  const load = useCallback(async () => {
    const rid = staffInfo?.restaurantId;
    if (!rid) return;
    try {
      const res = await restaurantApi.getCombos(rid);
      const data = res?.data ?? [];
      setCombos(data.filter((c: any) => c.isActive));
    } catch (err) {
      console.error('[combos] load failed', err);
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
        source={require('../../assets/images/hero banner/combo screen/hero banner.webp')}
        style={styles.heroImage}
        resizeMode="cover"
      />
      {/* Dark overlay to fade image into deep background */}
      <LinearGradient
        colors={['rgba(10, 10, 11, 0.1)', 'rgba(10, 10, 11, 0.85)', QuinckleColors.background]}
        locations={[0, 0.8, 1]}
        style={StyleSheet.absoluteFillObject}
      />

      {/* Floating Header Content */}
      <View style={styles.heroTextSection}>
        <Text style={styles.heroTitle}>Combos</Text>
        <View style={styles.statsRow}>
          <View style={styles.statPill}>
            <Text style={styles.statPillText}>{combos.length} Deal{combos.length !== 1 ? 's' : ''}</Text>
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
            <Text style={styles.stickyHeaderTitleText}>Combos</Text>
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
          <CombosSkeleton />
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
            {combos.length === 0 ? (
              <Text style={{ color: QuinckleColors.textTertiary, textAlign: 'center', marginTop: 40 }}>No combos available</Text>
            ) : combos.map(combo => {
              const orig = parseFloat(combo.originalPrice);
              const price = parseFloat(combo.price);
              const savings = orig > price ? Math.round(((orig - price) / orig) * 100) : 0;
              const detailItems: any[] = combo.itemDetails
                ? (typeof combo.itemDetails === 'string' ? JSON.parse(combo.itemDetails) : combo.itemDetails)
                : [];
              return (
                <View key={combo.id} style={styles.comboListCard}>
                  {combo.imageUrl && <Image source={{ uri: combo.imageUrl }} style={styles.comboListImg} />}
                  <View style={styles.comboListBody}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <Text style={styles.comboListName}>{combo.title}</Text>
                      {savings > 0 && <View style={styles.comboBadge}><Text style={styles.comboBadgeText}>{savings}% off</Text></View>}
                    </View>
                    {combo.description ? <Text style={styles.comboListDesc}>{combo.description}</Text> : null}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
                      <Text style={styles.comboCardPrice}>₹{price.toFixed(0)}</Text>
                      {savings > 0 && <Text style={styles.comboCardOrig}>₹{orig.toFixed(0)}</Text>}
                    </View>
                    {detailItems.length > 0 && (
                      <View style={styles.comboItemsBlock}>
                        <Text style={styles.comboItemsLabel}>Includes</Text>
                        {detailItems.map((i: any, idx: number) => (
                          <View key={idx} style={styles.comboItemEntry}>
                            <View style={styles.comboItemDot} />
                            <Text style={styles.comboItemList}>{(Number(i.quantity) || 1) > 1 ? `${Number(i.quantity)}× ` : ''}{i.name ?? i.menuItemName ?? 'Item'}</Text>
                            {(i.comboPrice || i.price) ? (
                              <Text style={styles.comboItemPrice}>₹{parseFloat(i.comboPrice ?? i.price ?? 0).toFixed(0)}</Text>
                            ) : null}
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                </View>
              );
            })}
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
  comboListImg: {
    width: '100%',
    height: 180,
    backgroundColor: 'rgba(255,255,255,0.06)',
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
  comboBadge: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  comboBadgeText: {
    color: '#F59E0B',
    fontSize: 10,
    fontWeight: '700',
  },
  comboListDesc: {
    color: QuinckleColors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 6,
  },
  comboCardPrice: {
    color: QuinckleColors.textPrimary,
    fontSize: 18,
    fontWeight: '800',
  },
  comboCardOrig: {
    color: QuinckleColors.textTertiary,
    fontSize: 14,
    textDecorationLine: 'line-through',
  },
  comboItemsBlock: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: QuinckleColors.borderSubtle,
    paddingTop: 12,
  },
  comboItemsLabel: {
    color: QuinckleColors.textTertiary,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 6,
  },
  comboItemEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginVertical: 4,
  },
  comboItemDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: QuinckleColors.primary,
  },
  comboItemList: {
    color: QuinckleColors.textPrimary,
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
  },
  comboItemPrice: {
    color: QuinckleColors.textSecondary,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
});
