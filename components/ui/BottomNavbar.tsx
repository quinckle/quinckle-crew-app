import React from 'react';
import { StyleSheet, TouchableOpacity, View, SafeAreaView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { QuinckleColors } from '../../constants/Colors';

type NavItem = 'tables' | 'menu' | 'orders' | 'activity';

interface BottomNavbarProps {
  activeTab: NavItem;
  onTabChange: (tab: NavItem) => void;
}

export function BottomNavbar({ activeTab, onTabChange }: BottomNavbarProps) {
  return (
    <View style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.navContent}>
          <TouchableOpacity 
            style={styles.navBtn} 
            onPress={() => onTabChange('tables')}
            activeOpacity={0.7}
          >
            <Ionicons 
              name={activeTab === 'tables' ? "grid" : "grid-outline"} 
              size={24} 
              color={activeTab === 'tables' ? QuinckleColors.primary : QuinckleColors.textSecondary} 
            />
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.navBtn} 
            onPress={() => onTabChange('menu')}
            activeOpacity={0.7}
          >
            <Ionicons 
              name={activeTab === 'menu' ? "book" : "book-outline"} 
              size={24} 
              color={activeTab === 'menu' ? QuinckleColors.primary : QuinckleColors.textSecondary} 
            />
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.navBtn} 
            onPress={() => onTabChange('orders')}
            activeOpacity={0.7}
          >
            <Ionicons 
              name={activeTab === 'orders' ? "list" : "list-outline"} 
              size={24} 
              color={activeTab === 'orders' ? QuinckleColors.primary : QuinckleColors.textSecondary} 
            />
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.navBtn} 
            onPress={() => onTabChange('activity')}
            activeOpacity={0.7}
          >
            <Ionicons 
              name={activeTab === 'activity' ? "pulse" : "pulse-outline"} 
              size={24} 
              color={activeTab === 'activity' ? QuinckleColors.primary : QuinckleColors.textSecondary} 
            />
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#0A0A0A', // Deep solid black
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  safeArea: {
    width: '100%',
  },
  navContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    height: 64,
    paddingHorizontal: 20,
  },
  navBtn: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
