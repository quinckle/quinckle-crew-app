// app/(staff)/index.tsx
import React, { useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../../context/AuthContext';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { QuinckleColors } from '../../constants/Colors';
import { ThemedDialog } from '../../components/ui/themed-dialog';

type TableStatus = 'available' | 'occupied' | 'reserved';

const INITIAL_TABLES = [
  { id: '1', number: 1, status: 'available' as TableStatus, location: 'Window', seats: 2 },
  { id: '2', number: 2, status: 'occupied' as TableStatus, location: 'Center', seats: 4 },
  { id: '3', number: 3, status: 'available' as TableStatus, location: 'Patio', seats: 6 },
  { id: '4', number: 4, status: 'reserved' as TableStatus, location: 'Bar', seats: 2 },
  { id: '5', number: 5, status: 'available' as TableStatus, location: 'Private', seats: 4 },
];

export default function StaffDashboard() {
  const { logout } = useAuth();
  const [tables, setTables] = useState(INITIAL_TABLES);
  const [activeFilter, setActiveFilter] = useState<'all' | TableStatus>('all');
  const [searchText, setSearchText] = useState('');
  const [dialog, setDialog] = useState<{
    visible: boolean;
    title: string;
    message: string;
    actions: Array<{ label: string; onPress: () => void; variant?: 'default' | 'danger' }>;
  }>({ visible: false, title: '', message: '', actions: [] });

  const counts = useMemo(() => ({
    available: tables.filter((t) => t.status === 'available').length,
    occupied: tables.filter((t) => t.status === 'occupied').length,
    reserved: tables.filter((t) => t.status === 'reserved').length,
    all: tables.length,
  }), [tables]);

  const filteredTables = useMemo(() => tables.filter((table) => {
    const matchesFilter = activeFilter === 'all' || table.status === activeFilter;
    const query = searchText.trim().toLowerCase();
    const matchesSearch =
      !query || String(table.number).includes(query) || table.location.toLowerCase().includes(query);
    return matchesFilter && matchesSearch;
  }), [tables, activeFilter, searchText]);

  const closeDialog = () => setDialog((prev) => ({ ...prev, visible: false }));

  const showDialog = (
    title: string,
    message: string,
    actions: Array<{ label: string; onPress: () => void; variant?: 'default' | 'danger' }>,
  ) => {
    setDialog({
      visible: true,
      title,
      message,
      actions: actions.map((action) => ({
        ...action,
        onPress: () => { closeDialog(); action.onPress(); },
      })),
    });
  };

  const updateTableStatus = (tableNum: number, nextStatus: TableStatus) => {
    setTables((prev) =>
      prev.map((table) => (table.number === tableNum ? { ...table, status: nextStatus } : table)),
    );
  };

  const handleTablePress = (tableNum: number, currentStatus: TableStatus) => {
    if (currentStatus === 'available') {
      showDialog('New Session', `Start a new session for Table ${tableNum}?`, [
        { label: 'Cancel', onPress: () => {} },
        {
          label: 'Start',
          onPress: () => {
            updateTableStatus(tableNum, 'occupied');
            router.push({ pathname: '/(staff)/[tableId]', params: { tableId: String(tableNum) } });
          },
        },
      ]);
    } else {
      router.push({ pathname: '/(staff)/[tableId]', params: { tableId: String(tableNum) } });
    }
  };

  const handleQuickAction = (tableNum: number, action: 'assign' | 'clean') => {
    if (action === 'assign') { handleTablePress(tableNum, 'available'); return; }
    showDialog('Marked Clean', `Table ${tableNum} is ready for new guests.`, [
      { label: 'OK', onPress: () => {} },
    ]);
    updateTableStatus(tableNum, 'available');
  };

  const getStatusMeta = (status: TableStatus) => {
    if (status === 'occupied') return { label: 'Occupied', color: QuinckleColors.primary };
    if (status === 'reserved') return { label: 'Reserved', color: QuinckleColors.warning };
    return { label: 'Available', color: QuinckleColors.success };
  };

  const handleLogout = () => {
    logout();
    router.replace('/login');
  };

  const FILTER_CHIPS = [
    { key: 'all', label: `All (${counts.all})` },
    { key: 'available', label: `Available (${counts.available})` },
    { key: 'occupied', label: `Occupied (${counts.occupied})` },
    { key: 'reserved', label: `Reserved (${counts.reserved})` },
  ] as const;

  return (
    <View style={styles.container}>
      {/* Top bar */}
      <View style={styles.topBar}>
        <Text style={styles.topTitle}>QuinckleCrew: Live Tables</Text>
        <View style={styles.topIcons}>
          <TouchableOpacity
            onPress={() =>
              showDialog('Logout', 'Are you sure you want to log out?', [
                { label: 'Cancel', onPress: () => {} },
                { label: 'Logout', variant: 'danger', onPress: handleLogout },
              ])
            }
          >
            <Ionicons name="log-out-outline" size={20} color={QuinckleColors.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Summary card */}
      <View style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>The Grill Room</Text>
        <View style={styles.summaryStatsRow}>
          <View style={styles.statPill}>
            <Ionicons name="grid-outline" size={12} color={QuinckleColors.textSecondary} />
            <Text style={styles.statText}>Tables: {counts.all}</Text>
          </View>
          <View style={styles.statPill}>
            <Ionicons name="restaurant-outline" size={12} color={QuinckleColors.primary} />
            <Text style={styles.statText}>Occupied: {counts.occupied}</Text>
          </View>
          <View style={styles.statPill}>
            <Ionicons name="checkmark-circle-outline" size={12} color={QuinckleColors.success} />
            <Text style={styles.statText}>Free: {counts.available}</Text>
          </View>
        </View>
      </View>

      {/* Filter chips */}
      <View style={styles.filterRow}>
        {FILTER_CHIPS.map((chip) => (
          <TouchableOpacity
            key={chip.key}
            style={[styles.chip, activeFilter === chip.key && styles.chipActive]}
            onPress={() => setActiveFilter(chip.key as 'all' | TableStatus)}
          >
            <Text style={[styles.chipText, activeFilter === chip.key && styles.chipTextActive]}>
              {chip.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={16} color={QuinckleColors.textSecondary} />
        <TextInput
          value={searchText}
          onChangeText={setSearchText}
          placeholder="Search by table number or location…"
          placeholderTextColor={QuinckleColors.textSecondary}
          style={styles.searchInput}
        />
        {searchText.length > 0 && (
          <TouchableOpacity onPress={() => setSearchText('')}>
            <Ionicons name="close-circle" size={16} color={QuinckleColors.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Table list */}
      <FlatList
        data={filteredTables}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          const statusMeta = getStatusMeta(item.status);
          return (
            <TouchableOpacity
              style={styles.tableCard}
              onPress={() => handleTablePress(item.number, item.status)}
              activeOpacity={0.88}
            >
              <View style={styles.cardTopRow}>
                <View>
                  <Text style={styles.tableTitle}>T{item.number}</Text>
                  <View style={styles.metaRow}>
                    <Ionicons name="location-outline" size={13} color={QuinckleColors.textSecondary} />
                    <Text style={styles.metaText}>{item.location}</Text>
                    <Ionicons name="people-outline" size={13} color={QuinckleColors.textSecondary} />
                    <Text style={styles.metaText}>{item.seats} seats</Text>
                  </View>
                </View>
                <View style={[styles.statusPill, { backgroundColor: `${statusMeta.color}18` }]}>
                  <View style={[styles.statusDot, { backgroundColor: statusMeta.color }]} />
                  <Text style={[styles.statusPillText, { color: statusMeta.color }]}>
                    {statusMeta.label}
                  </Text>
                </View>
              </View>

              <View style={styles.cardActions}>
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={() => handleQuickAction(item.number, 'assign')}
                >
                  <Ionicons name="person-add-outline" size={13} color={QuinckleColors.textSecondary} />
                  <Text style={styles.actionText}>Assign Guest</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.actionBtn}
                  onPress={() => handleQuickAction(item.number, 'clean')}
                >
                  <Ionicons name="sparkles-outline" size={13} color={QuinckleColors.textSecondary} />
                  <Text style={styles.actionText}>Mark Clean</Text>
                </TouchableOpacity>
              </View>
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="search-outline" size={28} color={QuinckleColors.textSecondary} />
            <Text style={styles.emptyText}>No tables match this filter.</Text>
          </View>
        }
      />

      <ThemedDialog
        visible={dialog.visible}
        title={dialog.title}
        message={dialog.message}
        actions={dialog.actions}
        onClose={closeDialog}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: 52,
    backgroundColor: QuinckleColors.background,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  topTitle: { color: QuinckleColors.textPrimary, fontSize: 17, fontWeight: '700', flex: 1 },
  topIcons: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  summaryCard: {
    backgroundColor: 'rgba(243,93,59,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(243,93,59,0.14)',
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  summaryTitle: {
    color: QuinckleColors.textPrimary,
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 10,
    letterSpacing: -0.3,
  },
  summaryStatsRow: { flexDirection: 'row', gap: 8 },
  statPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 999,
    paddingVertical: 7,
    paddingHorizontal: 6,
  },
  statText: { color: QuinckleColors.textPrimary, fontSize: 11, fontWeight: '600' },
  filterRow: { flexDirection: 'row', gap: 7, marginBottom: 12 },
  chip: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  chipActive: {
    borderColor: 'rgba(243,93,59,0.45)',
    backgroundColor: 'rgba(243,93,59,0.13)',
  },
  chipText: { color: QuinckleColors.textSecondary, fontSize: 12, fontWeight: '500' },
  chipTextActive: { color: QuinckleColors.primary, fontWeight: '600' },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    marginBottom: 12,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    color: QuinckleColors.textPrimary,
    paddingVertical: 10,
    fontSize: 14,
  },
  listContent: { paddingBottom: 30 },
  tableCard: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  tableTitle: { fontSize: 26, fontWeight: '700', color: QuinckleColors.textPrimary, letterSpacing: -0.5 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  metaText: { color: QuinckleColors.textSecondary, fontSize: 12, marginRight: 4 },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusPillText: { fontWeight: '600', fontSize: 12 },
  cardActions: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.07)',
    paddingTop: 10,
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingVertical: 9,
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  actionText: { color: QuinckleColors.textSecondary, fontSize: 12, fontWeight: '600' },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 44, gap: 8 },
  emptyText: { color: QuinckleColors.textSecondary, fontSize: 14 },
});
