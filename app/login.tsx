// app/login.tsx
import { router } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { QuinckleColors } from '../constants/Colors';

export default function LoginScreen() {
  return (
    <View style={styles.container}>
      <View style={styles.brand}>
        <View style={styles.logoBadge}>
          <Ionicons name="restaurant" size={30} color="#fff" />
        </View>
        <Text style={styles.appName}>QuinckleCrew</Text>
        <Text style={styles.tagline}>Restaurant crew coordination</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.sectionLabel}>Select your role</Text>

        <TouchableOpacity
          style={[styles.roleRow, styles.roleRowStaff]}
          onPress={() => router.push('/credential?role=staff' as never)}
          activeOpacity={0.8}
        >
          <View style={styles.roleIconStaff}>
            <Ionicons name="people" size={20} color={QuinckleColors.primary} />
          </View>
          <View style={styles.roleInfo}>
            <Text style={styles.roleName}>Staff</Text>
            <Text style={styles.roleDesc}>Manage tables & serve guests</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={QuinckleColors.textSecondary} />
        </TouchableOpacity>

        <View style={styles.separator} />

        <TouchableOpacity
          style={[styles.roleRow, styles.roleRowCook]}
          onPress={() => router.push('/credential?role=cook' as never)}
          activeOpacity={0.8}
        >
          <View style={styles.roleIconCook}>
            <Ionicons name="flame" size={20} color="#fff" />
          </View>
          <View style={styles.roleInfo}>
            <Text style={styles.roleName}>Cook</Text>
            <Text style={styles.roleDesc}>Handle kitchen order tickets</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={QuinckleColors.textSecondary} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: QuinckleColors.background,
    paddingHorizontal: 20,
    gap: 28,
  },
  brand: { alignItems: 'center', gap: 8 },
  logoBadge: {
    width: 70,
    height: 70,
    borderRadius: 22,
    backgroundColor: QuinckleColors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 6,
    elevation: 8,
    shadowColor: QuinckleColors.primary,
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
  },
  appName: {
    fontSize: 32,
    fontWeight: '700',
    color: QuinckleColors.textPrimary,
    letterSpacing: -0.5,
  },
  tagline: { fontSize: 14, color: QuinckleColors.textSecondary },
  card: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    borderRadius: 20,
    padding: 16,
    gap: 4,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: QuinckleColors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  roleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 14,
  },
  roleRowStaff: { backgroundColor: 'rgba(243,93,59,0.07)' },
  roleRowCook: { backgroundColor: 'rgba(255,255,255,0.03)' },
  roleIconStaff: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: 'rgba(243,93,59,0.16)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  roleIconCook: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: QuinckleColors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  roleInfo: { flex: 1, gap: 2 },
  roleName: { fontSize: 16, fontWeight: '600', color: QuinckleColors.textPrimary },
  roleDesc: { fontSize: 12, color: QuinckleColors.textSecondary },
  separator: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginHorizontal: 2,
    marginVertical: 2,
  },
});
