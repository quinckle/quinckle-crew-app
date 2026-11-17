/**
 * Menu Activity — the full log. Opened from "See all" on the Manage menu
 * Activity tab (whole menu) or inside an item / combo editor (that dish).
 *
 * Tabs per kind of change, Items / Combos / Add-ons on the whole-menu view,
 * "Done by" and date filters, and infinite scroll: the next page loads as you
 * reach the end. Every filter runs on the server, so paging stays exact.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { QuinckleColors, Radius, Spacing, Typography } from '@/constants/Colors';
import {
  adminHistory,
  type MenuActivityEntity,
  type MenuActivityKind,
  type MenuChange,
} from '@/services/menuAdmin';
import {
  ActivityRow,
  Chips,
  ENTITY_TABS,
  FirstSeenRow,
  KIND_TABS,
  activityStyles,
} from '@/components/menu-admin/menuActivityShared';
import {
  ALL_TIME,
  ActorSheet,
  DateSheet,
  FilterBar,
  dateRange,
  type ActorFilter,
  type DateFilter,
} from '@/components/menu-admin/ActivityFilters';

const PAGE = 30;

export default function MenuActivityScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ itemId?: string; comboId?: string; title?: string }>();
  const itemId = params.itemId || undefined;
  const comboId = params.comboId || undefined;
  const whole = !itemId && !comboId;

  const [kind, setKind] = useState<MenuActivityKind | null>(null);
  const [entity, setEntity] = useState<MenuActivityEntity | null>(null);
  const [actor, setActor] = useState<ActorFilter>(null);
  const [date, setDate] = useState<DateFilter>(ALL_TIME);
  const [sheet, setSheet] = useState<'actor' | 'date' | null>(null);

  const [rows, setRows] = useState<MenuChange[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Every filter change bumps this; a response for an older filter is dropped.
  const reqId = useRef(0);

  const query = useCallback(
    (c: string | null) => {
      const { from, to } = dateRange(date);
      return adminHistory.list({
        itemId,
        comboId,
        kind,
        entity: whole ? entity : null,
        actorType: actor?.actorType ?? null,
        actorId: actor?.actorType === 'SYSTEM' ? null : actor?.actorId ?? null,
        from,
        to,
        cursor: c,
        limit: PAGE,
      });
    },
    [itemId, comboId, kind, entity, whole, actor, date]
  );

  const loadFirst = useCallback(async () => {
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    setRows([]);
    setCursor(null);
    try {
      const res = await query(null);
      if (id !== reqId.current) return;
      setRows(res.data);
      setCursor(res.nextCursor ?? null);
      setTotal(res.total ?? null);
      setCreatedAt(res.createdAt ?? null);
    } catch (e: any) {
      if (id === reqId.current) setError(e?.message ?? 'Could not load menu activity');
    } finally {
      if (id === reqId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [query]);

  const loadMore = useCallback(async () => {
    if (loading || !cursor || error) return;
    const id = reqId.current;
    setLoading(true);
    try {
      const res = await query(cursor);
      if (id !== reqId.current) return;
      setRows((prev) => {
        const seen = new Set(prev.map((r) => r.id));
        return [...prev, ...res.data.filter((r) => !seen.has(r.id))];
      });
      setCursor(res.nextCursor ?? null);
    } catch (e: any) {
      if (id === reqId.current) setError(e?.message ?? 'Could not load more');
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  }, [loading, cursor, error, query]);

  useEffect(() => {
    void loadFirst();
  }, [loadFirst]);

  const clearFilters = () => {
    setActor(null);
    setDate(ALL_TIME);
  };

  const filtered = kind !== null || (whole && entity !== null) || !!actor || date.preset !== 'ALL';
  const hasAdded = rows.some((r) => r.action === 'CREATED' && (r.entityType === 'ITEM' || r.entityType === 'COMBO'));
  const showFirstSeen =
    !whole && !!createdAt && !cursor && !loading && !hasAdded && (kind === null || kind === 'ADDED') && !actor && date.preset === 'ALL';

  const header = (
    <View>
      <Chips tabs={KIND_TABS} value={kind} onChange={setKind} />
      {whole && <Chips tabs={ENTITY_TABS} value={entity} onChange={setEntity} small />}
      <FilterBar
        actor={actor}
        date={date}
        onActor={() => setSheet('actor')}
        onDate={() => setSheet('date')}
        onClear={clearFilters}
      />
      {total != null && !error && (
        <Text style={styles.total}>
          {total === 0 ? '' : `${total} change${total === 1 ? '' : 's'}${filtered ? ' match' : ''}`}
          {total > 0 && rows.length < total ? ` · showing ${rows.length}` : ''}
        </Text>
      )}
    </View>
  );

  const footer = (
    <View style={styles.footer}>
      {loading && <ActivityIndicator color={QuinckleColors.primary} />}
      {error && (
        <TouchableOpacity onPress={rows.length ? () => { setError(null); void loadMore(); } : loadFirst} activeOpacity={0.7}>
          <Text style={activityStyles.error}>{error} · Tap to retry</Text>
        </TouchableOpacity>
      )}
      {showFirstSeen && <FirstSeenRow createdAt={createdAt!} />}
      {!loading && !error && rows.length === 0 && !showFirstSeen && (
        <Text style={activityStyles.empty}>{filtered ? 'Nothing matches these filters.' : 'Nothing recorded yet.'}</Text>
      )}
      {!loading && !error && !cursor && rows.length > PAGE / 2 && <Text style={styles.end}>That is everything</Text>}
    </View>
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={22} color={QuinckleColors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Menu Activity</Text>
          <Text style={styles.sub} numberOfLines={1}>
            {whole ? 'Every menu change — who, what and when' : params.title ? params.title : comboId ? 'This combo' : 'This item'}
          </Text>
        </View>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(r) => r.id}
        renderItem={({ item, index }) => <ActivityRow row={item} activeKind={kind} showEntity={whole} first={index === 0} />}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + Spacing.xl }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void loadFirst();
            }}
            tintColor={QuinckleColors.primary}
          />
        }
      />

      <ActorSheet visible={sheet === 'actor'} value={actor} onClose={() => setSheet(null)} onPick={setActor} />
      <DateSheet visible={sheet === 'date'} value={date} onClose={() => setSheet(null)} onPick={setDate} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: QuinckleColors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: QuinckleColors.borderSubtle,
  },
  headerBtn: { width: 40, height: 40, borderRadius: Radius.pill, justifyContent: 'center', alignItems: 'center' },
  title: { ...Typography.bodyStrong, fontSize: 17, color: QuinckleColors.textPrimary },
  sub: { ...Typography.micro, color: QuinckleColors.textMuted, marginTop: 2 },
  body: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md },
  total: { ...Typography.micro, color: QuinckleColors.textMuted, paddingBottom: Spacing.xs },
  footer: { paddingVertical: Spacing.md, minHeight: 48 },
  end: { ...Typography.micro, color: QuinckleColors.textMuted, textAlign: 'center' },
});
