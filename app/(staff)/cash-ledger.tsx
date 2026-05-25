import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuth } from '../../context/AuthContext';
import { crewPayments } from '../../services/api';
import { QuinckleColors, Radius, Spacing } from '../../constants/Colors';

export default function CashLedger() {
  const insets = useSafeAreaInsets();
  const { staffInfo } = useAuth();
  const [cashLedger, setCashLedger] = useState<any>(null);
  const [isLoadingLedger, setIsLoadingLedger] = useState(false);
  const [expandedDate, setExpandedDate] = useState<string | null>(null);

  useEffect(() => {
    if (staffInfo?.id) {
      setIsLoadingLedger(true);
      crewPayments.getCashLedger()
        .then(res => setCashLedger(res))
        .catch(() => {})
        .finally(() => setIsLoadingLedger(false));
    }
  }, [staffInfo?.id]);

  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      
      {/* Header bar */}
      <View style={styles.headerBar}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={22} color={QuinckleColors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Cash Ledger</Text>
        <View style={styles.btnPlaceholder} />
      </View>

      {/* Main List */}
      <FlatList
        data={cashLedger?.groups ?? []}
        keyExtractor={(item) => item.date}
        contentContainerStyle={styles.scrollContainer}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            {isLoadingLedger ? (
              <ActivityIndicator size="small" color={QuinckleColors.primary} />
            ) : (
              <>
                <Ionicons name="wallet-outline" size={32} color={QuinckleColors.textTertiary} />
                <Text style={styles.emptyText}>No cash collections logged yet.</Text>
              </>
            )}
          </View>
        }
        ListHeaderComponent={
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Total Shift Collections</Text>
            <Text style={styles.summaryValue}>₹{(cashLedger?.shiftTotal ?? 0).toLocaleString('en-IN')}</Text>
          </View>
        }
        renderItem={({ item }) => {
          const isExpanded = expandedDate === item.date;
          return (
            <View style={styles.ledgerCard}>
              <TouchableOpacity
                style={styles.ledgerHeader}
                onPress={() => setExpandedDate(isExpanded ? null : item.date)}
                activeOpacity={0.7}
              >
                <Text style={styles.ledgerDate}>{item.date}</Text>
                <View style={styles.ledgerHeaderRight}>
                  <Text style={styles.ledgerTotal}>₹{item.total.toLocaleString('en-IN')}</Text>
                  <Ionicons
                    name={isExpanded ? 'chevron-up' : 'chevron-down'}
                    size={14}
                    color={QuinckleColors.textTertiary}
                  />
                </View>
              </TouchableOpacity>

              {isExpanded && (
                <View style={styles.ledgerDetails}>
                  {item.items.map((subItem: any, idx: number) => (
                    <View key={subItem.id || idx} style={styles.ledgerRow}>
                      <View style={styles.ledgerRowLeft}>
                        <View style={styles.tableBadge}>
                          <Text style={styles.tableBadgeText}>{subItem.tableNo}</Text>
                        </View>
                        <Text style={styles.ledgerTime}>{subItem.time}</Text>
                      </View>
                      <Text style={styles.ledgerAmount}>₹{subItem.amount.toLocaleString('en-IN')}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          );
        }}
      />
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
    paddingBottom: Spacing.huge,
  },
  summaryCard: {
    backgroundColor: QuinckleColors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.xl,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    alignItems: 'center',
    marginBottom: Spacing.lg,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 6,
    elevation: 2,
  },
  summaryLabel: {
    color: QuinckleColors.textTertiary,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  summaryValue: {
    color: QuinckleColors.primary,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  ledgerCard: {
    backgroundColor: QuinckleColors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    marginBottom: Spacing.md,
    overflow: 'hidden',
  },
  ledgerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.lg,
  },
  ledgerDate: {
    color: QuinckleColors.textPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  ledgerHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  ledgerTotal: {
    color: QuinckleColors.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  ledgerDetails: {
    backgroundColor: QuinckleColors.surfaceMuted,
    borderTopWidth: 1,
    borderTopColor: QuinckleColors.border,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    gap: Spacing.md,
  },
  ledgerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  ledgerRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  tableBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    borderRadius: Radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  tableBadgeText: {
    color: QuinckleColors.textPrimary,
    fontSize: 11,
    fontWeight: '700',
  },
  ledgerTime: {
    color: QuinckleColors.textTertiary,
    fontSize: 12,
  },
  ledgerAmount: {
    color: QuinckleColors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
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
