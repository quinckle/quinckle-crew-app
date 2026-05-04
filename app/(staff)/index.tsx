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
  }>({
    visible: false,
    title: '',
    message: '',
    actions: [],
  });

  const counts = useMemo(() => {
    const available = tables.filter((table) => table.status === 'available').length;
    const occupied = tables.filter((table) => table.status === 'occupied').length;
    const reserved = tables.filter((table) => table.status === 'reserved').length;
    return { available, occupied, reserved, all: tables.length };
  }, [tables]);

  const filteredTables = useMemo(() => {
    return tables.filter((table) => {
      const matchesFilter = activeFilter === 'all' ? true : table.status === activeFilter;
      const query = searchText.trim().toLowerCase();
      const matchesSearch =
        !query ||
        String(table.number).includes(query) ||
        table.location.toLowerCase().includes(query);
      return matchesFilter && matchesSearch;
    });
  }, [tables, activeFilter, searchText]);

  const closeDialog = () => {
    setDialog((prev) => ({ ...prev, visible: false }));
  };

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
        onPress: () => {
          closeDialog();
          action.onPress();
        },
      })),
    });
  };

  const handleTablePress = (tableNum: number, currentStatus: TableStatus) => {
    if (currentStatus === 'available') {
      showDialog('New Session', `Start a new session for Table ${tableNum}?`, [
        { label: 'Cancel', onPress: () => {} },
        {
          label: 'Start',
          onPress: () => {
            updateTableStatus(tableNum, 'occupied');
            router.push({
              pathname: '/(staff)/[tableId]',
              params: { tableId: String(tableNum) },
            });
          },
        },
      ]);
    } else {
      router.push({
        pathname: '/(staff)/[tableId]',
        params: { tableId: String(tableNum) },
      });
    }
  };

  const updateTableStatus = (tableNum: number, nextStatus: TableStatus) => {
    setTables((prev) => prev.map((table) => (table.number === tableNum ? { ...table, status: nextStatus } : table)));
  };

  const handleQuickAction = (tableNum: number, action: 'assign' | 'clean') => {
    if (action === 'assign') {
      handleTablePress(tableNum, 'available');
      return;
    }
    showDialog('Marked Clean', `Table ${tableNum} is ready for new guests.`, [{ label: 'OK', onPress: () => {} }]);
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

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <Text style={styles.topTitle}>QuinckleCrew: Live Tables</Text>
        <View style={styles.topIcons}>
          <TouchableOpacity onPress={() => showDialog('Search', 'Use the search bar below to find tables.', [{ label: 'OK', onPress: () => {} }])}>
            <Ionicons name="search" size={20} color={QuinckleColors.textPrimary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleLogout}>
            <Ionicons name="log-out-outline" size={20} color={QuinckleColors.textPrimary} />
          </TouchableOpacity>
        </View>
      </View>

      <Text style={styles.floorMeta}>
        The Grill Room | T: {counts.all} | C: {counts.occupied} | Avail: {counts.available}
      </Text>

      <View style={styles.filterRow}>
        {[
          { key: 'all', label: `All (${counts.all})` },
          { key: 'available', label: `Available (${counts.available})` },
          { key: 'occupied', label: `Occupied (${counts.occupied})` },
          { key: 'reserved', label: `Reserved (${counts.reserved})` },
        ].map((chip) => (
          <TouchableOpacity
            key={chip.key}
            style={[styles.chip, activeFilter === chip.key && styles.chipActive]}
            onPress={() => setActiveFilter(chip.key as 'all' | TableStatus)}
          >
            <Text style={[styles.chipText, activeFilter === chip.key && styles.chipTextActive]}>{chip.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={18} color={QuinckleColors.textSecondary} />
        <TextInput
          value={searchText}
          onChangeText={setSearchText}
          placeholder="Search Table Number..."
          placeholderTextColor={QuinckleColors.textSecondary}
          style={styles.searchInput}
        />
      </View>

      <FlatList
        data={filteredTables}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => {
          const statusMeta = getStatusMeta(item.status);
          return (
            <View style={styles.tableCard}>
              <View style={styles.cardTopRow}>
                <View>
                  <Text style={styles.tableTitle}>T{item.number}</Text>
                  <View style={styles.metaRow}>
                    <Ionicons name="location-outline" size={14} color={QuinckleColors.textSecondary} />
                    <Text style={styles.metaText}>{item.location}</Text>
                    <Ionicons name="people-outline" size={14} color={QuinckleColors.textSecondary} />
                    <Text style={styles.metaText}>{item.seats} Seats</Text>
                  </View>
                </View>
                <View style={[styles.statusPill, { backgroundColor: `${statusMeta.color}22` }]}>
                  <Text style={[styles.statusPillText, { color: statusMeta.color }]}>{statusMeta.label}</Text>
                </View>
              </View>

              <View style={styles.cardActions}>
                <TouchableOpacity style={styles.actionBtn} onPress={() => handleQuickAction(item.number, 'assign')}>
                  <Text style={styles.actionText}>ASSIGN GUEST</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionBtn} onPress={() => handleQuickAction(item.number, 'clean')}>
                  <Text style={styles.actionText}>MARK CLEAN</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Ionicons name="search-outline" size={26} color={QuinckleColors.textSecondary} />
            <Text style={styles.emptyText}>No tables match this filter.</Text>
          </View>
        }
      />

      {/* Legacy header kept for quick rollback during iteration */}
      <View style={styles.legacyHeaderHide}>
        <View>
          <Text style={styles.header}>Floor Overview</Text>
          <Text style={styles.subtitle}>Manage active dining sessions</Text>
        </View>
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <Ionicons name="log-out-outline" size={18} color={QuinckleColors.danger} />
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>

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
  container: { flex: 1, paddingHorizontal: 14, paddingTop: 52, backgroundColor: QuinckleColors.background },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  topTitle: { color: QuinckleColors.textPrimary, fontSize: 20, fontWeight: '700', flex: 1 },
  topIcons: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  floorMeta: {
    color: QuinckleColors.textPrimary,
    fontSize: 24,
    fontWeight: '500',
    marginBottom: 12,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  chip: {
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    backgroundColor: QuinckleColors.surface,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  chipActive: {
    borderColor: QuinckleColors.primary,
    backgroundColor: `${QuinckleColors.primary}22`,
  },
  chipText: { color: QuinckleColors.textSecondary, fontSize: 12, fontWeight: '500' },
  chipTextActive: { color: QuinckleColors.primary },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: QuinckleColors.surface,
    borderColor: QuinckleColors.border,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    color: QuinckleColors.textPrimary,
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  listContent: { paddingBottom: 92 },
  tableCard: {
    backgroundColor: QuinckleColors.surface,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  tableTitle: { fontSize: 28, fontWeight: '700', color: QuinckleColors.textPrimary },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  metaText: { color: QuinckleColors.textSecondary, fontSize: 12, marginRight: 6 },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusPillText: { fontWeight: '600', fontSize: 12 },
  cardActions: {
    borderTopWidth: 1,
    borderTopColor: QuinckleColors.border,
    paddingTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  actionBtn: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    paddingVertical: 10,
    alignItems: 'center',
  },
  actionText: { color: QuinckleColors.textPrimary, fontSize: 12, fontWeight: '600' },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
    gap: 6,
  },
  emptyText: { color: QuinckleColors.textSecondary },
  legacyHeaderHide: {
    height: 0,
    overflow: 'hidden',
  },
  header: { fontSize: 20, fontWeight: '700', color: QuinckleColors.textPrimary },
  subtitle: { color: QuinckleColors.textSecondary },
  logoutBtn: { flexDirection: 'row', alignItems: 'center' },
  logoutText: { color: QuinckleColors.danger, fontWeight: '600' },
});