import React, { useMemo, useState } from 'react';
import { FlatList, Image, StyleSheet, Text, TextInput, TouchableOpacity, View, Platform } from 'react-native';
import Constants from 'expo-constants';
import { useAuth } from '../../context/AuthContext';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { QuinckleColors } from '../../constants/Colors';
import { ThemedDialog } from '../../components/ui/themed-dialog';
import { BottomNavbar } from '../../components/ui/BottomNavbar';
import { Modal, ScrollView } from 'react-native';

type NavItem = 'tables' | 'menu' | 'orders' | 'activity' | 'profile' | 'cash_ledger';
type TableStatus = 'available' | 'occupied' | 'reserved' | 'offline' | 'paid';

type Table = {
  id: string;
  number: number;
  status: TableStatus;
  seats: number;
  billAmount?: number;
  since?: string;
  location?: string;
};

const MENU_DATA_INITIAL = [
  { id: '1', name: 'Chicken Biryani', price: 250, category: 'Mains', available: true, image: 'https://images.unsplash.com/photo-1563379091339-03b21bc4a4f8?q=80&w=200&h=200&auto=format&fit=crop' },
  { id: '2', name: 'Butter Chicken', price: 320, category: 'Mains', available: true, image: 'https://images.unsplash.com/photo-1603894584202-93826e796a39?q=80&w=200&h=200&auto=format&fit=crop' },
  { id: '3', name: 'Paneer Tikka', price: 220, category: 'Appetizers', available: true, image: 'https://images.unsplash.com/photo-1567188040759-fb8a883dc6d8?q=80&w=200&h=200&auto=format&fit=crop' },
  { id: '4', name: 'Garlic Naan', price: 60, category: 'Mains', available: true, image: 'https://images.unsplash.com/photo-1533777857889-4be7c70b33f7?q=80&w=200&h=200&auto=format&fit=crop' },
  { id: '5', name: 'Cold Coffee', price: 120, category: 'Beverages', available: true, image: 'https://images.unsplash.com/photo-1517701604599-bb29b565090c?q=80&w=200&h=200&auto=format&fit=crop' },
  { id: '6', name: 'Chocolate Brownie', price: 180, category: 'Desserts', available: false, image: 'https://images.unsplash.com/photo-1606313564200-e75d5e30476c?q=80&w=200&h=200&auto=format&fit=crop' },
  { id: '7', name: 'Lemon Soda', price: 80, category: 'Beverages', available: true, image: 'https://images.unsplash.com/photo-1513558161293-cdaf765ed2fd?q=80&w=200&h=200&auto=format&fit=crop' },
  { id: '8', name: 'Mutton Seekh', price: 350, category: 'Appetizers', available: true, image: 'https://images.unsplash.com/photo-1601050690597-df056fb4ce7a?q=80&w=200&h=200&auto=format&fit=crop' },
  { id: '9', name: 'Special Salad', price: 150, category: 'Appetizers', available: true },
];

const READY_ORDERS_MOCK = [
  { 
    id: 'o1', 
    tableNo: 'T02', 
    items: [
      { id: 'i1', name: 'Chicken Biryani', qty: 2, orderedAt: '14:05', status: 'ready' }
    ] 
  },
  { 
    id: 'o2', 
    tableNo: 'T05', 
    items: [
      { id: 'i2', name: 'Cold Coffee', qty: 1, orderedAt: '14:15', status: 'ready' },
      { id: 'i3', name: 'Lemon Soda', qty: 1, orderedAt: '14:16', status: 'ready' }
    ] 
  },
  { 
    id: 'o3', 
    tableNo: 'T01', 
    items: [
      { id: 'i4', name: 'Paneer Tikka', qty: 1, orderedAt: '14:20', status: 'ready' }
    ] 
  },
];

const ACTIVITY_DATA = [
  { id: '1', type: 'payment', message: 'Collected cash of ₹2,050 from Table T01', date: '10 May', time: '14:20', icon: 'cash-outline', color: '#22c55e' },
  { id: '2', type: 'status', message: 'Marked Table T03 as free', date: '10 May', time: '14:15', icon: 'checkmark-circle-outline', color: '#3B82F6' },
  { id: '3', type: 'session', message: 'Started new session at Table T02', date: '10 May', time: '14:05', icon: 'play-outline', color: '#F35D3B' },
  { id: '4', type: 'menu', message: 'Marked "Chocolate Brownie" as out of stock', date: '09 May', time: '13:50', icon: 'alert-circle-outline', color: '#ef4444' },
  { id: '5', type: 'payment', message: 'Collected cash of ₹1,280 from Table T05', date: '09 May', time: '13:30', icon: 'cash-outline', color: '#22c55e' },
  { id: '6', type: 'status', message: 'Marked Table T11 as offline', date: '09 May', time: '13:10', icon: 'power-outline', color: 'rgba(255,255,255,0.4)' },
];

const CASH_COLLECTIONS_MOCK = [
  { id: 'c1', tableNo: 'T01', amount: 2050, time: '14:20', date: '10 May' },
  { id: 'c2', tableNo: 'T05', amount: 1280, time: '13:30', date: '09 May' },
  { id: 'c3', tableNo: 'T03', amount: 3420, time: '12:45', date: '09 May' },
  { id: 'c4', tableNo: 'T11', amount: 890, time: '11:15', date: '09 May' },
];

const INITIAL_TABLES: Table[] = [
  { id: '1', number: 1, status: 'occupied', seats: 4, billAmount: 2050, since: '14:15', location: 'Main Hall' },
  { id: '2', number: 2, status: 'occupied', seats: 2, billAmount: 1280, since: '14:40', location: 'Window' },
  { id: '3', number: 3, status: 'paid', seats: 2, billAmount: 420, location: 'Bar Side' },
  { id: '4', number: 4, status: 'occupied', seats: 4, billAmount: 3420, since: '13:30', location: 'Corner' },
  { id: '5', number: 5, status: 'available', seats: 2, location: 'Terrace' },
  { id: '6', number: 6, status: 'offline', seats: 4, location: 'Garden' },
  { id: '7', number: 7, status: 'available', seats: 6, location: 'Main Hall' },
  { id: '8', number: 8, status: 'occupied', seats: 2, since: '15:00', location: 'Window' },
  { id: '9', number: 9, status: 'available', seats: 4, location: 'Garden' },
  { id: '10', number: 10, status: 'available', seats: 8, location: 'Main Hall' },
  { id: '11', number: 11, status: 'offline', seats: 4, location: 'Main Hall' },
  { id: '12', number: 12, status: 'available', seats: 4, location: 'Window' },
];

export default function StaffDashboard() {
  const insets = useSafeAreaInsets();
  const { logout } = useAuth();
  const [activeTab, setActiveTab] = useState<NavItem>('orders');
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [filterVisible, setFilterVisible] = useState(false);
  const [tables, setTables] = useState<Table[]>(INITIAL_TABLES);
  const [menuData, setMenuData] = useState(MENU_DATA_INITIAL);
  const [activeFilter, setActiveFilter] = useState<'all' | TableStatus | string>('all');
  const [searchText, setSearchText] = useState('');
  const [isOnline, setIsOnline] = useState(true);
  const [dialog, setDialog] = useState<{
    visible: boolean;
    title: string;
    message: string;
    actions: Array<{ label: string; onPress: () => void; variant?: 'default' | 'danger' }>;
  }>({ visible: false, title: '', message: '', actions: [] });

  const counts = useMemo(() => ({
    available: tables.filter((t) => t.status === 'available').length,
    occupied: tables.filter((t) => t.status === 'occupied').length,
    paid: tables.filter((t) => t.status === 'paid').length,
    reserved: tables.filter((t) => t.status === 'reserved').length,
    offline: tables.filter((t) => t.status === 'offline').length,
    all: tables.length,
  }), [tables]);

  const filteredTables = useMemo(() => tables.filter((table) => {
    const matchesFilter = activeFilter === 'all' || table.status === activeFilter;
    const query = searchText.trim().toLowerCase();
    const matchesSearch =
      !query || String(table.number).includes(query) || (table.location && table.location.toLowerCase().includes(query));
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
    if (currentStatus === 'offline') {
      showDialog(
        'Table Offline',
        `Table T${String(tableNum).padStart(2, '0')} is currently offline. Make it available?`,
        [
          { label: 'Cancel', onPress: () => {} },
          { 
            label: 'Make Available', 
            onPress: () => updateTableStatus(tableNum, 'available'),
          },
        ]
      );
      return;
    }

    if (currentStatus === 'paid') {
      showDialog(
        'Table Paid',
        `Bill settled for Table T${String(tableNum).padStart(2, '0')}. Free up table now?`,
        [
          { label: 'Not Yet', onPress: () => {} },
          { 
            label: 'Clean & Free Table', 
            onPress: () => updateTableStatus(tableNum, 'available'),
          },
        ]
      );
      return;
    }

    if (currentStatus === 'available') {
      showDialog('New Session', `Start a new session for Table ${tableNum}?`, [
        { label: 'Cancel', onPress: () => { } },
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

  const handleLongPress = (tableId: string, status: TableStatus) => {
    const table = tables.find(t => t.id === tableId);
    if (!table) return;
    const tableNum = table.number;
    if (status === 'available') {
      showDialog(
        'Manage Table',
        `Mark Table T${String(tableNum).padStart(2, '0')} as offline? It will be hidden from new guest assignments.`,
        [
          { label: 'Cancel', onPress: () => {} },
          { 
            label: 'Mark Offline', 
            variant: 'danger',
            onPress: () => updateTableStatus(tableNum, 'offline'),
          },
        ]
      );
    } else if (status === 'offline') {
      showDialog(
        'Manage Table',
        `Make Table T${String(tableNum).padStart(2, '0')} available for guests?`,
        [
          { label: 'Cancel', onPress: () => {} },
          { 
            label: 'Make Available', 
            onPress: () => updateTableStatus(tableNum, 'available'),
          },
        ]
      );
    }
  };

  const getStatusMeta = (status: TableStatus) => {
    if (status === 'occupied') return { label: 'Occupied', color: '#F35D3B' };
    if (status === 'paid') return { label: 'Paid', color: '#3B82F6' };
    if (status === 'reserved') return { label: 'Reserved', color: QuinckleColors.warning };
    if (status === 'offline') return { label: 'Offline', color: 'rgba(255,255,255,0.4)' };
    return { label: 'Available', color: '#22c55e' };
  };

  const handleLogout = () => {
    logout();
    router.replace('/login');
  };

  const FILTER_CHIPS = [
    { key: 'all', label: `All (${counts.all})` },
    { key: 'available', label: `Available (${counts.available})` },
    { key: 'occupied', label: `Occupied (${counts.occupied})` },
    { key: 'paid', label: `Paid (${counts.paid})` },
    { key: 'reserved', label: `Reserved (${counts.reserved})` },
  ] as const;

  return (
    <View style={[styles.container, { paddingTop: insets.top + 6 }]}>
      {/* Header */}
      {activeTab !== 'profile' && activeTab !== 'cash_ledger' && (
        <View style={styles.topBar}>
          <View style={styles.brandGroup}>
            <Text style={styles.brandTitle}>The Grill Room</Text>
            <View style={[styles.onlineBadge, !isOnline && styles.offlineBadge]}>
              <Text style={styles.onlineText}>{isOnline ? 'Online' : 'Offline'}</Text>
            </View>
          </View>

          <View style={styles.rightActions}>
            <TouchableOpacity 
              style={styles.userIconContainer} 
              onPress={() => setActiveTab('profile')}
              activeOpacity={0.7}
            >
              <Image 
                source={{ uri: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?q=80&w=200&h=200&auto=format&fit=crop' }} 
                style={styles.headerUserImage} 
              />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Main Content */}
      {activeTab === 'tables' ? (
        <>
          {/* Combined Controls Row */}
          <View style={styles.controlsRow}>
            <View style={styles.searchBox}>
              <Ionicons name="search" size={14} color={QuinckleColors.textSecondary} />
              <TextInput
                value={searchText}
                onChangeText={setSearchText}
                placeholder="Search…"
                placeholderTextColor={QuinckleColors.textSecondary}
                style={styles.searchInput}
              />
            </View>

            <TouchableOpacity 
              style={styles.filterDropdown}
              onPress={() => setFilterVisible(true)}
              activeOpacity={0.7}
            >
              <Text style={styles.filterValueText}>
                {FILTER_CHIPS.find(c => c.key === activeFilter)?.label.split(' ')[0]}
              </Text>
              <Ionicons name="chevron-down" size={14} color={QuinckleColors.primary} />
            </TouchableOpacity>
          </View>

          <Modal
            visible={filterVisible}
            transparent
            animationType="fade"
            onRequestClose={() => setFilterVisible(false)}
          >
            <TouchableOpacity 
              style={styles.modalOverlay} 
              activeOpacity={1} 
              onPress={() => setFilterVisible(false)}
            >
              <View style={styles.dropdownMenu}>
                <Text style={styles.menuLabel}>Filter Tables</Text>
                {FILTER_CHIPS.map((chip) => (
                  <TouchableOpacity
                    key={chip.key}
                    style={[styles.menuItem, activeFilter === chip.key && styles.menuItemActive]}
                    onPress={() => {
                      setActiveFilter(chip.key as 'all' | TableStatus);
                      setFilterVisible(false);
                    }}
                  >
                    <Text style={[styles.menuItemText, activeFilter === chip.key && styles.menuItemTextActive]}>
                      {chip.label}
                    </Text>
                    {activeFilter === chip.key && (
                      <Ionicons name="checkmark" size={16} color={QuinckleColors.primary} />
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            </TouchableOpacity>
          </Modal>

          <FlatList
            key="grid-view"
            data={filteredTables}
            keyExtractor={(item) => item.id}
            numColumns={2}
            columnWrapperStyle={styles.columnWrapper}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => {
              const statusMeta = getStatusMeta(item.status);
              return (
                <TouchableOpacity
                  style={[styles.tableCard, item.status === 'offline' && styles.offlineCard]}
                  onPress={() => handleTablePress(item.number, item.status)}
                  onLongPress={() => handleLongPress(item.id, item.status)}
                  activeOpacity={0.88}
                  delayLongPress={500}
                >
                  <View style={styles.cardHeader}>
                    <View>
                      <Text style={styles.tableTitle}>T{String(item.number).padStart(2, '0')}</Text>
                      <View style={styles.seatsRow}>
                        <Ionicons name="people-outline" size={11} color="rgba(255,255,255,0.4)" />
                        <Text style={styles.seatsText}>{item.seats} seats</Text>
                      </View>
                    </View>
                    <View style={styles.statusIndicatorGroup}>
                      <View style={[styles.statusDot, { backgroundColor: statusMeta.color }]} />
                      <Text style={[styles.statusLabel, { color: statusMeta.color }]}>{statusMeta.label}</Text>
                    </View>
                  </View>

                  <View style={styles.cardBottomRow}>
                    <View style={styles.cardMain}>
                      {item.status === 'occupied' ? (
                        <View>
                          <Text style={styles.billAmount}>₹{item.billAmount || '___'}</Text>
                          <Text style={styles.billSubtitle}>since {item.since}</Text>
                        </View>
                      ) : item.status === 'available' ? (
                        <View style={styles.actionPrompt}>
                          <Ionicons name="add" size={14} color="rgba(255,255,255,0.4)" />
                          <Text style={styles.actionPromptText}>Start session</Text>
                        </View>
                      ) : (
                        <Text style={styles.actionPromptText}>Marked offline</Text>
                      )}
                    </View>
                    <Ionicons 
                      name="arrow-forward-outline" 
                      size={14} 
                      color="rgba(255,255,255,0.2)" 
                      style={{ transform: [{ rotate: '-45deg' }], marginTop: 4 }} 
                    />
                  </View>
                </TouchableOpacity>
              );
            }}
          />
        </>
      ) : activeTab === 'menu' ? (
        <View style={styles.tabContent}>
          <View style={styles.menuSearchContainer}>
            <Ionicons name="search" size={18} color="rgba(255,255,255,0.3)" />
            <TextInput
              style={styles.menuSearchInput}
              placeholder="Search items to toggle availability..."
              placeholderTextColor="rgba(255,255,255,0.3)"
              value={searchText}
              onChangeText={setSearchText}
            />
          </View>

          <View style={styles.menuCategories}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.menuCatScroll}>
              {['All', 'Appetizers', 'Mains', 'Beverages', 'Desserts'].map(cat => (
                <TouchableOpacity 
                  key={cat} 
                  style={[styles.menuCatPill, activeFilter === cat && styles.menuCatPillActive]}
                  onPress={() => setActiveFilter(cat)}
                >
                  <Text style={[styles.menuCatText, activeFilter === cat && styles.menuCatTextActive]}>{cat}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          <FlatList
            data={menuData.filter(item => 
              (activeFilter === 'All' || item.category === activeFilter) &&
              (item.name.toLowerCase().includes(searchText.toLowerCase()))
            )}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.menuListContent}
            renderItem={({ item }) => (
              <View style={styles.menuItemRow}>
                <View style={styles.menuItemLeft}>
                  {item.image ? (
                    <Image source={{ uri: item.image }} style={[styles.menuItemImage, !item.available && { opacity: 0.4 }]} />
                  ) : (
                    <View style={[styles.menuItemImagePlaceholder, !item.available && { opacity: 0.4 }]}>
                      <Ionicons name="fast-food-outline" size={20} color="rgba(255,255,255,0.2)" />
                    </View>
                  )}
                  <View style={styles.menuItemInfo}>
                    <Text style={[styles.menuItemName, !item.available && styles.dimmedText]}>{item.name}</Text>
                    <Text style={styles.menuItemPrice}>₹{item.price}</Text>
                  </View>
                </View>
                <TouchableOpacity 
                  onPress={() => {
                    setMenuData(prev => prev.map(m => m.id === item.id ? { ...m, available: !m.available } : m));
                  }}
                  style={[styles.toggleBase, item.available ? styles.toggleOn : styles.toggleOff]}
                >
                  <View style={[styles.toggleCircle, item.available ? styles.toggleCircleOn : styles.toggleCircleOff]} />
                </TouchableOpacity>
              </View>
            )}
          />
        </View>
      ) : activeTab === 'orders' ? (
        <View style={styles.tabContent}>
          <FlatList
            data={READY_ORDERS_MOCK}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.ordersListContent}
            renderItem={({ item }) => (
              <View style={styles.tableOrderCard}>
                <View style={styles.tableOrderHeader}>
                  <View style={styles.tableOrderBadge}>
                    <Text style={styles.tableOrderBadgeText}>{item.tableNo}</Text>
                  </View>
                  <Text style={styles.tableOrderReadyCount}>{item.items.length} items ready</Text>
                </View>
                <View style={styles.nestedOrdersList}>
                  {item.items.map(orderItem => (
                    <TouchableOpacity 
                      key={orderItem.id} 
                      style={styles.nestedOrderItem}
                      onPress={() => {
                        showDialog('Serve Item', `Mark ${orderItem.name} as served?`, [
                          { label: 'Cancel', onPress: () => {} },
                          { label: 'Mark Served', onPress: () => {} },
                        ]);
                      }}
                    >
                      <View style={styles.nestedOrderLeft}>
                        <Text style={styles.nestedOrderQty}>{orderItem.qty}x</Text>
                        <View>
                          <Text style={styles.nestedOrderName}>{orderItem.name}</Text>
                          <Text style={styles.nestedOrderTime}>{orderItem.orderedAt}</Text>
                        </View>
                      </View>
                      <View style={styles.serviceCircleSmall}>
                        <Ionicons name="ellipse-outline" size={20} color={QuinckleColors.primary} />
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}
            ListHeaderComponent={
              <View style={styles.activityHeader}>
                <Text style={styles.activityTitle}>Kitchen Pickup</Text>
              </View>
            }
          />
        </View>
      ) : activeTab === 'activity' ? (
        <View style={styles.tabContent}>
          <FlatList
            data={ACTIVITY_DATA}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.activityListContent}
            renderItem={({ item }) => (
              <View style={styles.activityItem}>
                <View style={styles.activityInfo}>
                  <Text style={styles.activityMessage}>{item.message}</Text>
                  <View style={styles.activityTimeCol}>
                    <Text style={styles.activityDate}>{item.date}</Text>
                    <Text style={styles.activityTime}>{item.time}</Text>
                  </View>
                </View>
              </View>
            )}
            ListHeaderComponent={
              <View style={styles.activityHeader}>
                <Text style={styles.activityTitle}>Recent Updates</Text>
              </View>
            }
          />
        </View>
      ) : activeTab === 'profile' ? (
        <ScrollView style={styles.tabContent} contentContainerStyle={styles.profileContent}>
          {/* Back Navigation */}
          <TouchableOpacity 
            style={styles.profileBackBtn} 
            onPress={() => setActiveTab('tables')}
          >
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>

          {/* Profile Photo */}
          <View style={styles.profileHeader}>
            <TouchableOpacity style={styles.profileImageContainer} activeOpacity={0.9}>
              <Image 
                source={{ uri: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?q=80&w=200&h=200&auto=format&fit=crop' }} 
                style={styles.profileImage} 
              />
              <View style={styles.uploadBadge}>
                <Ionicons name="camera" size={14} color="#fff" />
              </View>
            </TouchableOpacity>
            <Text style={styles.profileName}>Koustab Chakraborty</Text>
            <Text style={styles.profilePhone}>+91 98765 43210</Text>
          </View>

          {/* Duty Status Toggle */}
          <View style={styles.dutyStatusCard}>
            <View style={styles.dutyInfo}>
              <Text style={styles.dutyLabel}>Duty Status</Text>
              <Text style={styles.dutySubtext}>{isOnline ? 'You are currently receiving orders' : 'You are currently off-duty'}</Text>
            </View>
            <TouchableOpacity 
              onPress={() => setIsOnline(!isOnline)}
              style={[styles.toggleBase, isOnline ? styles.toggleOn : styles.toggleOff]}
            >
              <View style={[styles.toggleCircle, isOnline ? styles.toggleCircleOn : styles.toggleCircleOff]} />
            </TouchableOpacity>
          </View>

          {/* Linked Venue Info */}
          <View style={styles.venueLinkCard}>
            <View style={styles.venueIconContainer}>
              <Image 
                source={{ uri: 'https://images.unsplash.com/photo-1544148103-0773bf10d330?q=80&w=100&h=100&auto=format&fit=crop' }} 
                style={styles.venueLogo} 
              />
            </View>
            <View style={styles.venueInfo}>
              <Text style={styles.venueLabel}>Linked Restaurant</Text>
              <Text style={styles.venueName}>The Grill Room</Text>
              <Text style={styles.venueId}>ID: QNK-7782-GR</Text>
            </View>
          </View>

          {/* Action Grid */}
          <View style={styles.profileActionGrid}>
            <TouchableOpacity 
              style={[styles.profileActionBtn, styles.fullWidthAction]}
              onPress={() => setActiveTab('cash_ledger')}
            >
              <View style={styles.cashActionContent}>
                <View style={styles.profileActionIcon}>
                  <Ionicons name="wallet-outline" size={22} color="#fff" />
                </View>
                <View>
                  <Text style={styles.profileActionText}>Total Cash Collected</Text>
                  <Text style={styles.cashValue}>₹48,250</Text>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.2)" />
            </TouchableOpacity>
          </View>

          <View style={styles.profileFooter}>
            <Text style={styles.adminContactText}>Contact your registered restaurant administration to update profile details or schedules.</Text>
          </View>

          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
            <Text style={styles.logoutBtnText}>Logout Session</Text>
          </TouchableOpacity>
        </ScrollView>
      ) : activeTab === 'cash_ledger' ? (
        <View style={styles.tabContent}>
          <View style={styles.ledgerHeader}>
            <TouchableOpacity 
              style={styles.ledgerBackBtn} 
              onPress={() => setActiveTab('profile')}
            >
              <Ionicons name="arrow-back" size={24} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.ledgerTitle}>Cash Ledger</Text>
            <View style={{ width: 44 }} />
          </View>

          <FlatList
            data={[
              { date: '10 May', total: 2050, items: [{ id: 'c1', tableNo: 'T01', amount: 2050, time: '14:20' }] },
              { date: '09 May', total: 5590, items: [
                { id: 'c2', tableNo: 'T05', amount: 1280, time: '13:30' },
                { id: 'c3', tableNo: 'T03', amount: 3420, time: '12:45' },
                { id: 'c4', tableNo: 'T11', amount: 890, time: '11:15' }
              ]}
            ]}
            keyExtractor={item => item.date}
            contentContainerStyle={styles.ledgerListContent}
            ListHeaderComponent={
              <View style={styles.appleSummaryHeader}>
                <Text style={styles.appleSummaryLabel}>Shift Total</Text>
                <Text style={styles.appleSummaryValue}>₹48,250</Text>
                <View style={[styles.appleDivider, { marginTop: 32, marginBottom: 10 }]} />
              </View>
            }
            renderItem={({ item }) => {
              const isExpanded = expandedDate === item.date;
              return (
                <View style={styles.appleLedgerGroup}>
                  <TouchableOpacity 
                    style={styles.appleLedgerHeader}
                    onPress={() => setExpandedDate(isExpanded ? null : item.date)}
                    activeOpacity={0.6}
                  >
                    <Text style={styles.appleLedgerDate}>{item.date}</Text>
                    <View style={styles.appleLedgerRight}>
                      <Text style={styles.appleLedgerTotal}>₹{item.total.toLocaleString()}</Text>
                      <Ionicons 
                        name={isExpanded ? "chevron-down" : "chevron-forward"} 
                        size={14} 
                        color="rgba(255,255,255,0.2)" 
                        style={{ marginLeft: 8 }}
                      />
                    </View>
                  </TouchableOpacity>
                  
                  {isExpanded && (
                    <View style={styles.appleExpandedSection}>
                      {item.items.map((subItem, idx) => (
                        <View key={subItem.id} style={[
                          styles.appleSubRow,
                          idx !== item.items.length - 1 && styles.appleSubRowDivider
                        ]}>
                          <View style={styles.appleSubLeft}>
                            <Text style={styles.appleSubTable}>{subItem.tableNo}</Text>
                            <Text style={styles.appleSubTime}>{subItem.time}</Text>
                          </View>
                          <Text style={styles.appleSubAmount}>₹{subItem.amount.toLocaleString()}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                  {!isExpanded && <View style={styles.appleDivider} />}
                </View>
              );
            }}
          />
        </View>
      ) : null}

      {activeTab !== 'profile' && activeTab !== 'cash_ledger' && (
        <BottomNavbar activeTab={activeTab as any} onTabChange={setActiveTab as any} />
      )}

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
    backgroundColor: QuinckleColors.background,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
    paddingVertical: 8,
  },
  brandGroup: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 2,
  },
  brandTitle: {
    color: QuinckleColors.textPrimary,
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  onlineBadge: {
    backgroundColor: 'rgba(34,197,94,0.1)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.2)',
  },
  offlineBadge: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderColor: 'rgba(255,255,255,0.1)',
  },
  onlineText: {
    color: '#22c55e',
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  dutyStatusCard: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 20,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  dutyInfo: {
    flex: 1,
  },
  dutyLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 4,
  },
  dutySubtext: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
  },
  rightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  headerBackBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 16,
  },
  userIconContainer: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1.5,
    borderColor: QuinckleColors.primary,
    padding: 1.5,
  },
  headerUserImage: {
    width: '100%',
    height: '100%',
    borderRadius: 15,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  searchBox: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    gap: 6,
  },
  searchInput: {
    flex: 1,
    color: QuinckleColors.textPrimary,
    paddingVertical: 8,
    fontSize: 13,
  },
  filterDropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 6,
    minWidth: 80,
    justifyContent: 'center',
  },
  filterValueText: {
    color: QuinckleColors.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  dropdownMenu: {
    width: '85%',
    backgroundColor: '#161616',
    borderRadius: 20,
    padding: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  menuLabel: {
    color: QuinckleColors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 16,
    paddingVertical: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
  },
  menuItemActive: {
    backgroundColor: 'rgba(243,93,59,0.08)',
  },
  menuItemText: {
    color: QuinckleColors.textSecondary,
    fontSize: 15,
    fontWeight: '500',
  },
  menuItemTextActive: {
    color: QuinckleColors.primary,
    fontWeight: '700',
  },
  listContent: { 
    paddingBottom: 100,
    gap: 12,
  },
  columnWrapper: {
    justifyContent: 'space-between',
    gap: 12,
  },
  tableCard: {
    flex: 1,
    backgroundColor: '#0A0A0A',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: 16,
    padding: 16,
    maxWidth: '48.5%',
    minHeight: 140,
    justifyContent: 'space-between',
  },
  offlineCard: {
    opacity: 0.6,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  tableTitle: { 
    fontSize: 20, 
    fontWeight: '800', 
    color: QuinckleColors.textPrimary, 
    letterSpacing: -0.5,
  },
  seatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  seatsText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 11,
    fontWeight: '600',
  },
  statusIndicatorGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusLabel: {
    fontSize: 10,
    fontWeight: '700',
  },
  cardMain: {
    flex: 1,
  },
  cardBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: 10,
  },
  billAmount: {
    color: QuinckleColors.textPrimary,
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  billSubtitle: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 10,
    fontWeight: '600',
    marginTop: 1,
  },
  actionPrompt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  actionPromptText: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
    fontWeight: '600',
  },
  emptyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: 44, gap: 8 },
  emptyText: { color: QuinckleColors.textSecondary, fontSize: 14 },
  centerView: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
    paddingBottom: 100,
    gap: 16,
  },
  viewTitle: {
    color: QuinckleColors.textPrimary,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  viewSubtitle: {
    color: QuinckleColors.textSecondary,
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  tabContent: {
    flex: 1,
  },
  menuSearchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    marginHorizontal: 16,
    marginBottom: 16,
    paddingHorizontal: 12,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  menuSearchInput: {
    flex: 1,
    color: '#fff',
    marginLeft: 10,
    fontSize: 14,
  },
  menuCategories: {
    marginBottom: 16,
  },
  menuCatScroll: {
    paddingHorizontal: 16,
    gap: 8,
  },
  menuCatPill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  menuCatPillActive: {
    backgroundColor: QuinckleColors.primary,
  },
  menuCatText: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    fontWeight: '600',
  },
  menuCatTextActive: {
    color: '#fff',
  },
  menuListContent: {
    paddingHorizontal: 16,
    paddingBottom: 100,
  },
  menuItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 14,
  },
  menuItemImage: {
    width: 50,
    height: 50,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  menuItemImagePlaceholder: {
    width: 50,
    height: 50,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.1)',
  },
  menuItemInfo: {
    flex: 1,
    gap: 2,
  },
  menuItemName: {
    color: QuinckleColors.textPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  menuItemPrice: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 14,
  },
  toggleBase: {
    width: 44,
    height: 24,
    borderRadius: 12,
    padding: 2,
    justifyContent: 'center',
  },
  toggleOn: {
    backgroundColor: '#22c55e',
  },
  toggleOff: {
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  toggleCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#fff',
  },
  toggleCircleOn: {
    alignSelf: 'flex-end',
  },
  toggleCircleOff: {
    alignSelf: 'flex-start',
  },
  dimmedText: {
    opacity: 0.4,
  },
  activityListContent: {
    paddingHorizontal: 16,
    paddingBottom: 100,
  },
  activityHeader: {
    paddingVertical: 16,
    marginBottom: 8,
  },
  activityTitle: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  activityItem: {
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  activityInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
  },
  activityMessage: {
    flex: 1,
    color: QuinckleColors.textPrimary,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },
  activityTimeCol: {
    alignItems: 'flex-end',
    gap: 2,
  },
  activityDate: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  activityTime: {
    color: 'rgba(255,255,255,0.2)',
    fontSize: 12,
    fontWeight: '600',
  },
  profileContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 60,
  },
  profileBackBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    marginBottom: 20,
  },
  profileHeader: {
    alignItems: 'center',
    marginBottom: 32,
  },
  profileImageContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    marginBottom: 16,
    position: 'relative',
  },
  profileImage: {
    width: '100%',
    height: '100%',
    borderRadius: 50,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  uploadBadge: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: QuinckleColors.primary,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: QuinckleColors.background,
  },
  profileName: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  profilePhone: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 4,
  },
  venueLinkCard: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    overflow: 'hidden',
  },
  venueIconContainer: {
    width: 80,
    height: 90,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
    borderRightWidth: 1,
    borderRightColor: 'rgba(255,255,255,0.1)',
  },
  venueLogo: {
    width: '100%',
    height: '100%',
  },
  venueInfo: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  venueLabel: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  venueName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  venueId: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
    marginTop: 2,
  },
  profileActionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  profileActionBtn: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 16,
    padding: 16,
    flex: 1,
    minWidth: '45%',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  fullWidthAction: {
    minWidth: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cashActionContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  profileActionIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  profileActionText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  cashValue: {
    color: '#22c55e',
    fontSize: 18,
    fontWeight: '800',
    marginTop: 2,
  },
  logoutBtn: {
    marginTop: 40,
    paddingVertical: 18,
    alignItems: 'center',
  },
  logoutBtnText: {
    color: '#ef4444',
    fontSize: 15,
    fontWeight: '700',
  },
  profileFooter: {
    marginTop: 32,
    paddingHorizontal: 10,
    marginBottom: 20,
  },
  adminContactText: {
    color: 'rgba(255,255,255,0.2)',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
    fontWeight: '500',
  },
  tableOrderCard: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderRadius: 20,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },
  tableOrderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  tableOrderBadge: {
    backgroundColor: QuinckleColors.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  tableOrderBadgeText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
  },
  tableOrderReadyCount: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  nestedOrdersList: {
    gap: 12,
  },
  nestedOrderItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.02)',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)',
  },
  nestedOrderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  nestedOrderQty: {
    color: QuinckleColors.primary,
    fontSize: 14,
    fontWeight: '800',
  },
  nestedOrderName: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  nestedOrderTime: {
    color: 'rgba(255,255,255,0.2)',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  serviceCircleSmall: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ledgerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 20,
  },
  ledgerBackBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
  },
  ledgerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  ledgerListContent: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  appleLedgerGroup: {
    backgroundColor: 'transparent',
  },
  appleLedgerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 20,
    paddingHorizontal: 4,
  },
  appleLedgerDate: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  appleLedgerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  appleLedgerTotal: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 17,
    fontWeight: '500',
  },
  appleExpandedSection: {
    paddingLeft: 12,
    marginBottom: 8,
  },
  appleSubRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    paddingRight: 4,
  },
  appleSubRowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  appleSubLeft: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  appleSubTable: {
    color: QuinckleColors.primary,
    fontSize: 15,
    fontWeight: '700',
  },
  appleSubTime: {
    color: 'rgba(255,255,255,0.2)',
    fontSize: 13,
    fontWeight: '500',
  },
  appleSubAmount: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  appleDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.05)',
    width: '100%',
  },
  appleSummaryHeader: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  appleSummaryLabel: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  appleSummaryValue: {
    color: '#fff',
    fontSize: 42,
    fontWeight: '800',
    letterSpacing: -1,
  },
  ledgerSummary: {
    marginTop: 32,
    backgroundColor: 'rgba(34,197,94,0.05)',
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.1)',
  },
  summaryLabel: {
    color: 'rgba(34,197,94,0.6)',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 2,
    marginBottom: 8,
  },
  summaryValue: {
    color: '#22c55e',
    fontSize: 32,
    fontWeight: '900',
  },
});
