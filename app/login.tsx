// app/login.tsx
import { router } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { QuinckleColors } from '../constants/Colors';

export default function LoginScreen() {
  const handleRoleSelect = (role: 'staff' | 'cook') => {
    router.push(`/credential?role=${role}` as never);
  };

  return (
    <View style={styles.container}>
      <View style={styles.brandWrap}>
        <View style={styles.logoBadge}>
          <Ionicons name="restaurant" size={28} color={QuinckleColors.textPrimary} />
        </View>
        <Text style={styles.title}>QuinckleCrew</Text>
        <Text style={styles.subtitle}>Select your role to continue</Text>
      </View>

      <TouchableOpacity 
        style={[styles.button, styles.staffButton]} 
        onPress={() => handleRoleSelect('staff')}
        activeOpacity={0.85}
      >
        <Ionicons name="people" size={18} color={QuinckleColors.textPrimary} />
        <Text style={styles.buttonText}>Login as Staff</Text>
        <Ionicons name="arrow-forward" size={18} color={QuinckleColors.textPrimary} />
      </TouchableOpacity>

      <TouchableOpacity 
        style={[styles.button, styles.cookButton]} 
        onPress={() => handleRoleSelect('cook')}
        activeOpacity={0.85}
      >
        <Ionicons name="flame" size={18} color={QuinckleColors.primary} />
        <Text style={[styles.buttonText, styles.cookButtonText]}>Login as Cook</Text>
        <Ionicons name="arrow-forward" size={18} color={QuinckleColors.primary} />
      </TouchableOpacity>
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
  },
  brandWrap: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 36,
  },
  logoBadge: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: QuinckleColors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 36,
    fontWeight: 'bold',
    marginBottom: 10,
    color: QuinckleColors.primary,
  },
  subtitle: {
    fontSize: 16,
    color: QuinckleColors.textSecondary,
    marginBottom: 40,
    textAlign: 'center',
  },
  button: {
    width: '100%',
    padding: 18,
    borderRadius: 14,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 15,
  },
  staffButton: {
    backgroundColor: QuinckleColors.primary,
  },
  cookButton: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: QuinckleColors.primary,
  },
  buttonText: {
    color: QuinckleColors.textPrimary,
    fontSize: 17,
    fontWeight: '600',
  },
  cookButtonText: {
    color: QuinckleColors.primary,
  },
});