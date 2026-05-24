// Cash collection screen — staff-only.
//
// Two sections:
//   1. Pending — orders the diner requested cash for, not yet collected.
//      Each row has a [Collect ₹X] button that flips Order.paymentStatus
//      to PAID_CASH and broadcasts cash_payment_collected.
//   2. Today's history — cash collected since IST-midnight.
//
// Session lifecycle is untouched: collecting cash never frees the table.

import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Linking,
  Alert,
} from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../context/AuthContext';
import { crewPayments, type PendingCashRequest, type CollectedCashRecord } from '../../services/api';
import { subscribeChannel } from '../../services/realtime';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';

type Row =
  | { kind: 'sectionHeader'; title: string; subtitle: string }
  | { kind: 'pending'; data: PendingCashRequest }
  | { kind: 'collected'; data: CollectedCashRecord }
  | { kind: 'empty'; message: string };

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.max(0, Math.floor(diffMs / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  return hrs === 1 ? '1 hr ago' : `${hrs} hrs ago`;
}

function timeOfDay(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata',
  });
}

export default function CashCollectionScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { staffInfo } = useAuth();

  const [pending, setPending] = useState<PendingCashRequest[]>([]);
  const [todayCollected, setTodayCollected] = useState<CollectedCashRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Orders currently being submitted — disables button + shows spinner so the
  // waiter can't double-tap and double-confirm.
  const [collectingIds, setCollectingIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      const data = await crewPayments.getCashRequests();
      setPending(data.pending);
      setTodayCollected(data.todayCollected);
    } catch (err) {
      console.error('[cash-collection] load failed', err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Live updates from Ably so the list stays fresh across crew devices
  useEffect(() => {
    const restaurantId = staffInfo?.restaurantId;
    if (!restaurantId) return;
    const off1 = subscribeChannel(`waiter:${restaurantId}`, 'cash_collection_requested', () => {
      void load();
    });
    const off2 = subscribeChannel(`waiter:${restaurantId}`, 'cash_payment_collected', () => {
      void load();
    });
    return () => { off1(); off2(); };
  }, [staffInfo?.restaurantId, load]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    void load();
  };

  const handleCollect = async (req: PendingCashRequest) => {
    const staffId = staffInfo?.id;
    if (!staffId) {
      Alert.alert('Not signed in', 'Please reopen the app and sign in again.');
      return;
    }
    // Optimistically remove from pending so the UI updates immediately
    setCollectingIds(prev => new Set(prev).add(req.orderId));
    try {
      await crewPayments.cashConfirm(req.orderId, staffId, req.amount);
      setPending(prev => prev.filter(p => p.orderId !== req.orderId));
      // Refresh to pull the newly-collected row into the history section
      void load();
    } catch (err: any) {
      Alert.alert('Could not record collection', err?.message ?? 'Please try again.');
    } finally {
      setCollectingIds(prev => {
        const next = new Set(prev);
        next.delete(req.orderId);
        return next;
      });
    }
  };

  const handleCallCustomer = (phone: string) => {
    Linking.openURL(`tel:${phone}`).catch(() => {});
  };

  // ── Flatten sections into rows for FlatList ────────────────────────────────
  const rows: Row[] = [
    { kind: 'sectionHeader', title: 'Pending', subtitle: `${pending.length} awaiting collection` },
    ...(pending.length === 0
      ? [{ kind: 'empty' as const, message: 'No cash requests right now. Diners paying by cash will appear here.' }]
      : pending.map(p => ({ kind: 'pending' as const, data: p }))),
    { kind: 'sectionHeader', title: 'Collected today', subtitle: `${todayCollected.length} order${todayCollected.length === 1 ? '' : 's'}` },
    ...(todayCollected.length === 0
      ? [{ kind: 'empty' as const, message: 'Nothing collected yet today.' }]
      : todayCollected.map(c => ({ kind: 'collected' as const, data: c }))),
  ];

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={22} color={QuinckleColors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Cash collection</Text>
          <Text style={styles.headerSubtitle}>
            {pending.length > 0
              ? `${pending.length} pending · ₹${pending.reduce((s, p) => s + p.amount, 0)} due`
              : 'All caught up'}
          </Text>
        </View>
        <TouchableOpacity onPress={handleRefresh} style={styles.iconBtn} activeOpacity={0.7}>
          <Ionicons name="refresh" size={20} color={QuinckleColors.textSecondary} />
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={QuinckleColors.primary} />
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row, i) => {
            if (row.kind === 'pending')   return `p-${row.data.orderId}`;
            if (row.kind === 'collected') return `c-${row.data.orderId}-${i}`;
            if (row.kind === 'sectionHeader') return `h-${row.title}`;
            return `e-${i}`;
          }}
          renderItem={({ item }) => {
            if (item.kind === 'sectionHeader') {
              return (
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>{item.title}</Text>
                  <Text style={styles.sectionSubtitle}>{item.subtitle}</Text>
                </View>
              );
            }
            if (item.kind === 'empty') {
              return <Text style={styles.emptyText}>{item.message}</Text>;
            }
            if (item.kind === 'pending') {
              const p = item.data;
              const busy = collectingIds.has(p.orderId);
              return (
                <View style={styles.pendingCard}>
                  <View style={styles.cardTopRow}>
                    <View style={styles.tablePill}>
                      <Ionicons name="restaurant-outline" size={12} color={QuinckleColors.primary} />
                      <Text style={styles.tablePillText}>Table {p.tableNumber || '—'}</Text>
                    </View>
                    <Text style={styles.timeAgo}>{timeAgo(p.requestedAt)}</Text>
                  </View>

                  <Text style={styles.customerName}>{p.customerName ?? 'Guest'}</Text>
                  <TouchableOpacity onPress={() => handleCallCustomer(p.customerPhone)} activeOpacity={0.7}>
                    <Text style={styles.customerPhone}>
                      <Ionicons name="call-outline" size={11} /> {p.customerPhone}
                    </Text>
                  </TouchableOpacity>

                  <View style={styles.cardBottomRow}>
                    <Text style={styles.amount}>₹{p.amount}</Text>
                    <TouchableOpacity
                      style={[styles.collectBtn, busy && styles.collectBtnDisabled]}
                      onPress={() => handleCollect(p)}
                      disabled={busy}
                      activeOpacity={0.85}
                    >
                      {busy ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <>
                          <Ionicons name="checkmark-circle" size={16} color="#fff" />
                          <Text style={styles.collectBtnText}>Collect ₹{p.amount}</Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              );
            }
            // collected
            const c = item.data;
            return (
              <View style={styles.collectedCard}>
                <View style={styles.cardTopRow}>
                  <View style={styles.collectedPill}>
                    <Ionicons name="checkmark" size={11} color={QuinckleColors.success} />
                    <Text style={styles.collectedPillText}>Table {c.tableNumber || '—'}</Text>
                  </View>
                  <Text style={styles.timeAgo}>{timeOfDay(c.collectedAt)}</Text>
                </View>
                <View style={styles.collectedBody}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.collectedCustomer}>{c.customerName ?? 'Guest'} · {c.customerPhone}</Text>
                    {c.collectedByName && (
                      <Text style={styles.collectedBy}>Collected by {c.collectedByName}</Text>
                    )}
                  </View>
                  <Text style={styles.collectedAmount}>₹{c.amount}</Text>
                </View>
              </View>
            );
          }}
          contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.xl }}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              tintColor={QuinckleColors.primary}
            />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: QuinckleColors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: QuinckleColors.border,
  },
  iconBtn: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: QuinckleColors.surface,
    borderWidth: 1, borderColor: QuinckleColors.border,
  },
  headerTitle: { color: QuinckleColors.textPrimary, fontSize: 18, fontWeight: '700' },
  headerSubtitle: { color: QuinckleColors.textSecondary, fontSize: 12, marginTop: 1 },

  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  sectionHeader: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xs,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    color: QuinckleColors.textPrimary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  sectionSubtitle: { color: QuinckleColors.textTertiary, fontSize: 11 },
  emptyText: {
    color: QuinckleColors.textTertiary,
    fontSize: 13,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    fontStyle: 'italic',
  },

  // Pending card
  pendingCard: {
    backgroundColor: QuinckleColors.surface,
    marginHorizontal: Spacing.md,
    marginVertical: Spacing.xs,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: QuinckleColors.primarySoftBorder,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  tablePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: QuinckleColors.primarySoft,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tablePillText: {
    color: QuinckleColors.primary,
    fontSize: 11,
    fontWeight: '700',
  },
  timeAgo: { color: QuinckleColors.textTertiary, fontSize: 11 },
  customerName: {
    color: QuinckleColors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  customerPhone: {
    color: QuinckleColors.textSecondary,
    fontSize: 13,
    marginBottom: Spacing.md,
  },
  cardBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  amount: {
    color: QuinckleColors.textPrimary,
    fontSize: 22,
    fontWeight: '700',
  },
  collectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: QuinckleColors.primary,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    borderRadius: 999,
    minWidth: 140,
    justifyContent: 'center',
  },
  collectBtnDisabled: { opacity: 0.6 },
  collectBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },

  // Collected card
  collectedCard: {
    backgroundColor: QuinckleColors.surfaceMuted,
    marginHorizontal: Spacing.md,
    marginVertical: Spacing.xs,
    borderRadius: Radius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: QuinckleColors.borderSubtle,
  },
  collectedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: QuinckleColors.successSoft,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  collectedPillText: {
    color: QuinckleColors.success,
    fontSize: 11,
    fontWeight: '600',
  },
  collectedBody: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  collectedCustomer: { color: QuinckleColors.textPrimary, fontSize: 13, fontWeight: '500' },
  collectedBy: { color: QuinckleColors.textTertiary, fontSize: 11, marginTop: 2 },
  collectedAmount: {
    color: QuinckleColors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});
