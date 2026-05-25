import React, { useEffect, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';
import { crewActivity, type CrewActivityItem } from '../../services/api';

interface DisplayItem {
  id: string;
  message: string;
  date: string;
  time: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
}

// Map each ActivityLog.action to a human label + icon + color. Falls back to
// a generic gray-dot row for actions we haven't styled yet.
type ActionConfig = {
  label: (d: Record<string, any>, actor: string | null) => string;
  icon:  keyof typeof Ionicons.glyphMap;
  color: string;
};
const ACTION_MAP: Record<string, ActionConfig> = {
  ORDER_PLACED: {
    label: (d) => {
      const t = d?.tableNumber ? `Table ${d.tableNumber}` : 'Order';
      const total = d?.total ? ` · ₹${d.total}` : '';
      const method = d?.paymentMethod === 'CASH' ? ' · cash' : '';
      return `${t}${total}${method} placed`;
    },
    icon: 'receipt-outline', color: QuinckleColors.primary,
  },
  CASH_COLLECTED: {
    label: (d, actor) => {
      const t = d?.tableNumber ? `Table ${d.tableNumber}` : 'Table —';
      const collector = d?.collectedByName ?? actor ?? 'staff';
      return `${t} · ₹${d?.amount ?? '—'} collected by ${collector}`;
    },
    icon: 'cash-outline', color: '#10b981',
  },
  PAYMENT_CONFIRMED: {
    label: (d) => `Payment confirmed${d?.tableNumber ? ` · Table ${d.tableNumber}` : ''} · ₹${d?.total ?? d?.amount ?? '—'}`,
    icon: 'card-outline', color: QuinckleColors.success,
  },
  ORDER_READY: {
    label: (d) => `Order ready · Table ${d?.tableNumber ?? '—'}`,
    icon: 'restaurant-outline', color: QuinckleColors.warning,
  },
  ORDER_SERVED: {
    label: (d) => `Order served · Table ${d?.tableNumber ?? '—'}`,
    icon: 'checkmark-circle-outline', color: QuinckleColors.success,
  },
  ORDER_CANCELLED: {
    label: (d) => `Order cancelled · Table ${d?.tableNumber ?? '—'}`,
    icon: 'close-circle-outline', color: QuinckleColors.textTertiary,
  },
  SESSION_STARTED: {
    label: (d) => `Table ${d?.tableNumber ?? '—'} occupied`,
    icon: 'people-outline', color: QuinckleColors.success,
  },
  SESSION_ENDED: {
    label: (d) => `Table ${d?.tableNumber ?? '—'} freed`,
    icon: 'walk-outline', color: QuinckleColors.textTertiary,
  },
  STAFF_LOGIN: {
    label: (_, actor) => `${actor ?? 'Staff'} logged in`,
    icon: 'log-in-outline', color: QuinckleColors.primary,
  },
  STAFF_LOGOUT: {
    label: (_, actor) => `${actor ?? 'Staff'} logged out`,
    icon: 'log-out-outline', color: QuinckleColors.textTertiary,
  },
};

function fmtDate(iso: string): { date: string; time: string } {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  const isYest = d.toDateString() === yesterday.toDateString();
  const date = isToday ? 'Today' : isYest ? 'Yesterday'
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  return { date, time };
}

function mapToDisplay(item: CrewActivityItem): DisplayItem {
  const cfg = ACTION_MAP[item.action] ?? {
    label: () => item.action.replace(/_/g, ' ').toLowerCase(),
    icon: 'pulse-outline' as const,
    color: QuinckleColors.textTertiary,
  };
  const { date, time } = fmtDate(item.createdAt);
  return {
    id: item.id,
    message: cfg.label(item.details ?? {}, item.actor),
    date, time,
    icon: cfg.icon,
    iconColor: cfg.color,
  };
}

export default function ActivityLog() {
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<DisplayItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try {
      const res = await crewActivity.list({ limit: 100 });
      const rows = res?.data?.items ?? [];
      setItems(rows.map(mapToDisplay));
    } catch (err) {
      console.error('[activity-log] load failed', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { void load(); }, []);

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      
      {/* Header bar */}
      <View style={styles.headerBar}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={22} color={QuinckleColors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Activity Log</Text>
        <View style={styles.btnPlaceholder} />
      </View>

      {/* Activity Timeline List */}
      {loading ? (
        <View style={styles.emptyState}>
          <ActivityIndicator color={QuinckleColors.primary} />
        </View>
      ) : (
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.scrollContainer}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); void load(); }}
            tintColor={QuinckleColors.primary}
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="pulse-outline" size={32} color={QuinckleColors.textTertiary} />
            <Text style={styles.emptyText}>No recent activity logged.</Text>
          </View>
        }
        renderItem={({ item, index }) => {
          const isLast = index === items.length - 1;
          return (
            <View style={styles.timelineRow}>
              {/* Left Timeline Guide */}
              <View style={styles.guideCol}>
                <View style={[styles.iconWrap, { borderColor: item.iconColor }]}>
                  <Ionicons name={item.icon} size={16} color={item.iconColor} />
                </View>
                {!isLast && <View style={styles.connectorLine} />}
              </View>

              {/* Right Content Card */}
              <View style={styles.contentCard}>
                <Text style={styles.messageText}>{item.message}</Text>
                <View style={styles.metaRow}>
                  <Text style={styles.metaText}>{item.date}</Text>
                  <Text style={styles.metaDot}>·</Text>
                  <Text style={styles.metaText}>{item.time}</Text>
                </View>
              </View>
            </View>
          );
        }}
      />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: QuinckleColors.background,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: QuinckleColors.border,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: Radius.md,
    backgroundColor: QuinckleColors.surfaceMuted,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPlaceholder: {
    width: 38,
    height: 38,
  },
  headerTitle: {
    color: QuinckleColors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  scrollContainer: {
    padding: Spacing.lg,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.huge,
  },
  timelineRow: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  guideCol: {
    alignItems: 'center',
    width: 36,
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: QuinckleColors.surface,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 2,
    elevation: 2,
  },
  connectorLine: {
    width: 2,
    flex: 1,
    backgroundColor: QuinckleColors.border,
    marginVertical: -2,
    zIndex: 1,
  },
  contentCard: {
    flex: 1,
    backgroundColor: QuinckleColors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    padding: Spacing.lg,
    marginBottom: Spacing.xl,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowOffset: { width: 0, height: 1 },
    shadowRadius: 4,
    elevation: 1,
  },
  messageText: {
    color: QuinckleColors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  metaText: {
    color: QuinckleColors.textTertiary,
    fontSize: 11,
    fontWeight: '500',
  },
  metaDot: {
    color: QuinckleColors.textTertiary,
    fontSize: 11,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 64,
    gap: Spacing.md,
  },
  emptyText: {
    color: QuinckleColors.textTertiary,
    fontSize: 13,
    textAlign: 'center',
  },
});
