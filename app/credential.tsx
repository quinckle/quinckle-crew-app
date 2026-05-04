import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { QuinckleColors } from '../constants/Colors';
import { useAuth } from '../context/AuthContext';

type Role = 'staff' | 'cook';

export default function CredentialScreen() {
  const { role: rawRole } = useLocalSearchParams<{ role?: string }>();
  const role = rawRole === 'staff' || rawRole === 'cook' ? rawRole : null;
  const { login } = useAuth();

  const [restaurantId, setRestaurantId] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [otp, setOtp] = useState('');
  const [error, setError] = useState('');

  const roleLabel = useMemo(() => (role === 'staff' ? 'Staff' : 'Cook'), [role]);

  const handleContinue = () => {
    if (!role) {
      router.replace('/login');
      return;
    }

    if (!restaurantId.trim() || !identifier.trim() || !otp.trim()) {
      setError('Please fill all required fields.');
      return;
    }

    setError('');
    login(role);
    router.replace(role === 'staff' ? '/(staff)' : '/(cook)');
  };

  if (!role) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>Invalid Role</Text>
        <Text style={styles.subtitle}>Please select role again.</Text>
        <TouchableOpacity style={[styles.primaryButton, styles.primarySolid]} onPress={() => router.replace('/login')}>
          <Text style={styles.primaryButtonText}>Back to Role Selection</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color={QuinckleColors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.header}>Restaurant Sign In</Text>
        <View style={{ width: 22 }} />
      </View>

      <Text style={styles.title}>{roleLabel} Access</Text>
      <Text style={styles.subtitle}>Verify restaurant identity to continue.</Text>

      <View style={styles.formCard}>
        <Text style={styles.label}>Restaurant ID / Code</Text>
        <TextInput
          value={restaurantId}
          onChangeText={setRestaurantId}
          placeholder="e.g. GRILL-001"
          placeholderTextColor={QuinckleColors.textSecondary}
          style={styles.input}
        />

        <Text style={styles.label}>Email or Phone</Text>
        <TextInput
          value={identifier}
          onChangeText={setIdentifier}
          placeholder="e.g. manager@restaurant.com"
          placeholderTextColor={QuinckleColors.textSecondary}
          style={styles.input}
          keyboardType="email-address"
          autoCapitalize="none"
        />

        <Text style={styles.label}>OTP</Text>
        <TextInput
          value={otp}
          onChangeText={setOtp}
          placeholder="Enter OTP"
          placeholderTextColor={QuinckleColors.textSecondary}
          style={styles.input}
          keyboardType="number-pad"
        />

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <TouchableOpacity style={[styles.primaryButton, styles.primarySolid]} onPress={handleContinue}>
          <Text style={styles.primaryButtonText}>Continue as {roleLabel}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: QuinckleColors.background,
    paddingHorizontal: 16,
    paddingTop: 52,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  header: {
    color: QuinckleColors.textPrimary,
    fontSize: 18,
    fontWeight: '700',
  },
  title: {
    color: QuinckleColors.textPrimary,
    fontSize: 28,
    fontWeight: '700',
    marginTop: 20,
  },
  subtitle: {
    color: QuinckleColors.textSecondary,
    marginTop: 6,
    marginBottom: 16,
  },
  formCard: {
    backgroundColor: `${QuinckleColors.surface}D9`,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    borderRadius: 16,
    padding: 14,
  },
  label: {
    color: QuinckleColors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 8,
    marginTop: 8,
  },
  input: {
    backgroundColor: QuinckleColors.surfaceHover,
    borderWidth: 1,
    borderColor: QuinckleColors.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    color: QuinckleColors.textPrimary,
  },
  errorText: {
    color: QuinckleColors.danger,
    marginTop: 10,
    fontSize: 12,
    fontWeight: '600',
  },
  primaryButton: {
    marginTop: 14,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primarySolid: {
    backgroundColor: QuinckleColors.primary,
  },
  primaryButtonText: {
    color: QuinckleColors.textPrimary,
    fontWeight: '700',
    fontSize: 14,
  },
});

