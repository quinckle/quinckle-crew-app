/**
 * Menu Activity preview — the latest few changes and a "See all" button that
 * opens the full Menu Activity screen (paging, tabs, Done by, dates).
 *
 * Used on the Manage menu Activity tab (whole menu) and inside the item and
 * combo editors (that dish only).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { QuinckleColors, Radius, Spacing, Typography } from '@/constants/Colors';
import { adminHistory, type MenuChange } from '@/services/menuAdmin';
import { ActivityRow, FirstSeenRow, activityStyles } from '@/components/menu-admin/menuActivityShared';

export function MenuActivityPreview({
  filter,
  title,
  count = 5,
  framed = true,
}: {
  filter: { itemId?: string; comboId?: string };
  /** The dish's name, shown on the full screen when scoped to one. */
  title?: string;
  count?: number;
  /** Bordered card (inside an editor) vs. bare (a full tab). */
  framed?: boolean;
}) {
  const { itemId, comboId } = filter;
  const whole = !itemId && !comboId;
  const [rows, setRows] = useState<MenuChange[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await adminHistory.list({ itemId, comboId, limit: count });
      setRows(res.data);
      setTotal(res.total ?? null);
      setCreatedAt(res.createdAt ?? null);
    } catch (e: any) {
      setError(e?.message ?? 'Could not load menu activity');
    }
  }, [itemId, comboId, count]);

  useEffect(() => {
    void load();
  }, [load]);

  const openAll = () =>
    router.push({
      pathname: '/(staff)/menu-activity',
      params: { ...(itemId ? { itemId } : {}), ...(comboId ? { comboId } : {}), ...(title ? { title } : {}) },
    } as any);

  const more = total != null ? total - (rows?.length ?? 0) : 0;
  const hasAdded = !!rows?.some((r) => r.action === 'CREATED' && (r.entityType === 'ITEM' || r.entityType === 'COMBO'));
  const showFirstSeen = !whole && !!createdAt && !!rows && more <= 0 && !hasAdded;

  return (
    <View style={framed ? styles.card : undefined}>
      <TouchableOpacity style={styles.head} onPress={openAll} activeOpacity={0.7}>
        <Ionicons name="pulse-outline" size={16} color={QuinckleColors.textSecondary} />
        <Text style={styles.heading}>Menu Activity</Text>
        {total != null && total > 0 && <Text style={styles.count}>{total}</Text>}
        <Text style={styles.seeAllTop}>See all</Text>
        <Ionicons name="chevron-forward" size={14} color={QuinckleColors.primary} />
      </TouchableOpacity>

      {!rows && !error && <ActivityIndicator style={{ marginVertical: Spacing.md }} color={QuinckleColors.primary} />}
      {error && (
        <TouchableOpacity onPress={load} activeOpacity={0.7}>
          <Text style={activityStyles.error}>{error} · Tap to retry</Text>
        </TouchableOpacity>
      )}
      {rows && rows.length === 0 && !showFirstSeen && <Text style={activityStyles.empty}>Nothing recorded yet.</Text>}

      {rows?.map((row, i) => (
        <ActivityRow key={row.id} row={row} showEntity={whole} first={i === 0} />
      ))}
      {showFirstSeen && <FirstSeenRow createdAt={createdAt!} />}

      {rows && rows.length > 0 && (
        <TouchableOpacity style={styles.seeAll} onPress={openAll} activeOpacity={0.8}>
          <Text style={styles.seeAllText}>{more > 0 ? `See all activity · ${more} more` : 'Open Menu Activity'}</Text>
          <Ionicons name="arrow-forward" size={15} color={QuinckleColors.primary} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: Spacing.lg,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    backgroundColor: QuinckleColors.surface,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: Spacing.xs },
  heading: { ...Typography.bodyStrong, color: QuinckleColors.textPrimary },
  count: {
    ...Typography.micro,
    color: QuinckleColors.textSecondary,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    borderRadius: Radius.pill,
    paddingHorizontal: 6,
    paddingVertical: 1,
    overflow: 'hidden',
  },
  seeAllTop: { ...Typography.caption, color: QuinckleColors.primary, marginLeft: 'auto' },
  seeAll: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: Spacing.sm,
    paddingVertical: 10,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: QuinckleColors.primarySoftBorder,
    backgroundColor: QuinckleColors.primarySoft,
  },
  seeAllText: { ...Typography.caption, color: QuinckleColors.primary, fontWeight: '600' },
});
